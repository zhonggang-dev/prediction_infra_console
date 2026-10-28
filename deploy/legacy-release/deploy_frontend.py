#!/usr/bin/env python3
"""Offline guards for the legacy 13000 frontend release (source: legacy-console/).

Pure checks on metadata, image labels, the UI handshake and rollback ownership.
It never touches Docker or systemd; remote_frontend.py does the real release.
Usage: deploy_frontend.py --metadata-json <file> --observed-json <file>
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import fcntl
import hashlib
import json
from pathlib import Path
import re
from typing import Any, Callable, Iterator


ROOT = Path("/opt/prediction-console")
LOCK_PATH = ROOT / ".deploy.lock"
LEGACY_UNIT = "prediction-console.service"
LEGACY_IMAGE = "prediction-console:current"
PROTECTED_V2 = "prediction-console-v2"
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")


class ReleaseInputError(ValueError):
    pass


def _sha(value: Any, label: str, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ReleaseInputError(f"{label} must be lowercase hexadecimal")
    return value


def _assert_no_secrets(value: Any) -> None:
    forbidden = ("token", "password", "secret", "credential", "dsn", "private_key", "api_key", "passphrase")
    if isinstance(value, dict):
        for key, child in value.items():
            if any(word in str(key).lower() for word in forbidden):
                raise ReleaseInputError("frontend release metadata contains credentials")
            _assert_no_secrets(child)
    elif isinstance(value, list):
        for child in value:
            _assert_no_secrets(child)


def validate_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    required = ("release", "merge_sha", "source_branch", "image_sha256", "expected_backend_binary_sha", "legacy_identity", "protected_v2_identity")
    missing = [key for key in required if key not in metadata]
    if missing:
        raise ReleaseInputError("metadata missing " + ",".join(missing))
    _assert_no_secrets(metadata)
    if metadata["source_branch"] != "main":
        raise ReleaseInputError("legacy frontend source_branch must be main")
    _sha(metadata["merge_sha"], "merge_sha", SHA40)
    if not isinstance(metadata["image_sha256"], str) or not IMAGE_ID.fullmatch(metadata["image_sha256"]):
        raise ReleaseInputError("image_sha256 must be a complete immutable image ID")
    _sha(metadata["expected_backend_binary_sha"], "expected_backend_binary_sha", SHA64)
    release = Path(str(metadata["release"]))
    if not str(release.resolve()).startswith(str((ROOT / "releases").resolve()) + "/"):
        raise ReleaseInputError("legacy release must be under /opt/prediction-console/releases")
    if not isinstance(metadata["legacy_identity"], dict) or not all(metadata["legacy_identity"].get(key) for key in ("id", "image", "started_at")):
        raise ReleaseInputError("legacy_identity is incomplete")
    protected = metadata["protected_v2_identity"]
    if not isinstance(protected, dict) or not all(protected.get(key) for key in ("id", "image", "started_at")):
        raise ReleaseInputError("protected_v2_identity is incomplete")
    if metadata.get("unit", LEGACY_UNIT) != LEGACY_UNIT or metadata.get("image_ref", LEGACY_IMAGE) != LEGACY_IMAGE:
        raise ReleaseInputError("legacy release target is not prediction-console")
    return metadata


def validate_image_attestation(metadata: dict[str, Any], labels: dict[str, Any]) -> None:
    validate_metadata(metadata)
    if labels.get("org.opencontainers.image.source-branch") != "main":
        raise ReleaseInputError("image source branch label is not main")
    if labels.get("org.opencontainers.image.revision") != metadata["merge_sha"]:
        raise ReleaseInputError("image revision label does not match merge_sha")
    if labels.get("com.unipai.release-profile") != "legacy":
        raise ReleaseInputError("image release profile is not legacy")
    if labels.get("com.unipai.backend-binary-sha256") != metadata["expected_backend_binary_sha"]:
        raise ReleaseInputError("image backend hash does not match metadata")


def validate_preflight(metadata: dict[str, Any], observed: dict[str, Any]) -> dict[str, Any]:
    validate_metadata(metadata)
    if observed.get("legacy_identity") != metadata["legacy_identity"]:
        raise ReleaseInputError("legacy 13000 identity changed")
    if observed.get("protected_v2_identity") != metadata["protected_v2_identity"]:
        raise ReleaseInputError("protected prediction-console-v2 identity changed")
    if observed.get("current_image_sha256") != metadata["image_sha256"]:
        raise ReleaseInputError("legacy image digest does not match metadata")
    if observed.get("backend_binary_sha") != metadata["expected_backend_binary_sha"]:
        raise ReleaseInputError("frontend is paired with an unexpected backend binary")
    validate_image_attestation(metadata, observed.get("image_labels") or {})
    return {"legacy": metadata["legacy_identity"], "protected_v2": metadata["protected_v2_identity"], "port": 13000}


def validate_ui_handshake(release: Path, merge_sha: str) -> str:
    verified = release / "UI_VERIFIED"
    rejected = release / "UI_REJECTED"
    if rejected.exists() or rejected.is_symlink():
        raise ReleaseInputError("UI_REJECTED handshake exists")
    if verified.is_symlink() or not verified.is_file() or verified.read_text(encoding="utf-8").strip() != merge_sha:
        raise TimeoutError("UI_VERIFIED handshake is not present for this merge")
    return "UI_VERIFIED"


@contextmanager
def deploy_lock(path: Path = LOCK_PATH) -> Iterator[None]:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+") as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("frontend deployment lock is already held") from error
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def rollback_if_owned(observed: dict[str, Any], metadata: dict[str, Any]) -> None:
    validate_metadata(metadata)
    if observed.get("legacy_identity") != metadata["legacy_identity"]:
        raise RuntimeError("legacy rollback ownership CAS failed")
    if observed.get("protected_v2_identity") != metadata["protected_v2_identity"]:
        raise RuntimeError("rollback refuses to touch a changed V2 identity")
    if observed.get("current_image_sha256") != metadata["image_sha256"]:
        raise RuntimeError("legacy image changed outside this deployment")


def run_locked_release(
    metadata: dict[str, Any],
    preflight_observed: dict[str, Any],
    candidate_observed: dict[str, Any],
    rollback: Callable[[], None],
    *,
    lock_path: Path = LOCK_PATH,
) -> str:
    """Hold the legacy lock through UI handshake and an ownership-safe rollback."""
    with deploy_lock(lock_path):
        validate_preflight(metadata, preflight_observed)
        try:
            return validate_ui_handshake(Path(str(metadata["release"])), metadata["merge_sha"])
        except Exception:
            rollback_if_owned(candidate_observed, metadata)
            rollback()
            raise


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-json", required=True)
    parser.add_argument("--observed-json", required=True)
    args = parser.parse_args(argv)
    metadata = json.loads(Path(args.metadata_json).read_text(encoding="utf-8"))
    observed = json.loads(Path(args.observed_json).read_text(encoding="utf-8"))
    validate_preflight(metadata, observed)
    print(json.dumps({"phase": "legacy_frontend_preflight_ok", "unit": LEGACY_UNIT, "port": 13000, "protected": PROTECTED_V2}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
