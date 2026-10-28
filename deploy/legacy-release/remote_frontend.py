#!/usr/bin/env python3
"""Remote runner for the reviewed legacy Console 13000 release (source: legacy-console/ on main).

This file is the side-effecting adapter.  It is intentionally separate from
``deploy_frontend.py``: that module remains an offline guard, while this
runner performs the real Docker/systemd/proc/HTTP operations only after a
metadata-backed compare-and-swap check.  The caller must provide complete
release metadata; no baseline identity or credential is hard-coded here.
"""

from __future__ import annotations

import argparse
from contextlib import contextmanager
import datetime as dt
import fcntl
import hashlib
import ipaddress
import json
from pathlib import Path
import os
import re
import subprocess
import time
from typing import Any, Iterator
from urllib.request import Request, urlopen
from urllib.parse import urlsplit


ROOT = Path("/opt/prediction-console")
LOCK_PATH = ROOT / ".deploy.lock"
LEGACY_UNIT = "prediction-console.service"
LEGACY_CONTAINER = "prediction-console"
LEGACY_TAG = "prediction-console:current"
V2_CONTAINER = "prediction-console-v2"
V2_TAG = "prediction-console-v2:current"
LEGACY_PORT = 13000
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA64 = re.compile(r"^[0-9a-f]{64}$")
IMAGE_ID = re.compile(r"^sha256:[0-9a-f]{64}$")


class ReleaseInputError(ValueError):
    """Metadata or an observed runtime fact is unsafe to consume."""


class ContainerMissing(RuntimeError):
    """Docker has not created the named container yet (or has removed it)."""


def emit(phase: str, **facts: Any) -> None:
    print(json.dumps({"phase": phase, **facts}, ensure_ascii=False, sort_keys=True), flush=True)


def sha(value: Any, field: str, pattern: re.Pattern[str]) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ReleaseInputError(f"{field} must be lowercase hexadecimal")
    return value


def no_secret_keys(value: Any, path: str = "metadata") -> None:
    forbidden = ("token", "password", "secret", "credential", "dsn", "private_key", "api_key", "passphrase", "authorization")
    if isinstance(value, dict):
        for key, child in value.items():
            if any(word in str(key).lower() for word in forbidden):
                raise ReleaseInputError(f"{path} contains a credential field")
            no_secret_keys(child, f"{path}.{key}")
    elif isinstance(value, list):
        for index, child in enumerate(value):
            no_secret_keys(child, f"{path}[{index}]")


def safe_release(value: Any, field: str = "release") -> str:
    if not isinstance(value, str) or not value.startswith(str(ROOT / "releases") + "/"):
        raise ReleaseInputError(f"{field} must be under {ROOT / 'releases'}")
    resolved = Path(value).resolve()
    try:
        relative = resolved.relative_to((ROOT / "releases").resolve())
    except ValueError as error:
        raise ReleaseInputError(f"{field} is outside the release root") from error
    if len(relative.parts) != 1 or any(char not in "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-" for char in relative.name):
        raise ReleaseInputError(f"{field} must name one safe release directory")
    return str(resolved)


def identity(value: Any, field: str, *, pointer: bool) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReleaseInputError(f"{field} must be an object")
    for key in ("id", "image", "started_at", "restart_count", "status", "running"):
        if key not in value or value[key] in (None, ""):
            raise ReleaseInputError(f"{field}.{key} is required")
    if pointer:
        if not isinstance(value.get("pointer"), str) or not isinstance(value.get("pointer_target"), str):
            raise ReleaseInputError(f"{field} pointer facts are required")
        if Path(value["pointer"]).resolve() != (ROOT / "current").resolve() or not value["pointer_target"].startswith(str((ROOT / "releases").resolve()) + "/"):
            raise ReleaseInputError(f"{field} pointer is outside the legacy current/release paths")
    if not isinstance(value.get("image"), str) or not IMAGE_ID.fullmatch(value["image"]):
        raise ReleaseInputError(f"{field}.image must be a complete immutable image ID")
    return value


def validate_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    required = (
        "release", "merge_sha", "source_branch", "source_archive_sha256",
        "image_sha256", "backend_identity", "legacy_identity", "protected_v2_identity", "legacy_http_base_url",
    )
    missing = [key for key in required if key not in metadata]
    if missing:
        raise ReleaseInputError("metadata missing " + ",".join(missing))
    no_secret_keys(metadata)
    if metadata["source_branch"] != "main":
        raise ReleaseInputError("source_branch must be main")
    sha(metadata["merge_sha"], "merge_sha", SHA40)
    sha(metadata["source_archive_sha256"], "source_archive_sha256", SHA64)
    if not isinstance(metadata["image_sha256"], str) or not IMAGE_ID.fullmatch(metadata["image_sha256"]):
        raise ReleaseInputError("image_sha256 must be a complete immutable image ID")
    safe_release(metadata["release"])
    identity(metadata["legacy_identity"], "legacy_identity", pointer=True)
    identity(metadata["protected_v2_identity"], "protected_v2_identity", pointer=False)
    backend = metadata["backend_identity"]
    if not isinstance(backend, dict) or type(backend.get("pid")) is not int or backend["pid"] <= 1 or not isinstance(backend.get("binary_path"), str):
        raise ReleaseInputError("backend_identity pid/binary_path are required")
    sha(backend.get("binary_sha256"), "backend_identity.binary_sha256", SHA64)
    # Optional: only releases that touch the official wallet PnL card need the wallet probes.
    expected_accounts = metadata.get("wallet_pnl_expected")
    if expected_accounts is not None:
        if not isinstance(expected_accounts, dict) or set(expected_accounts) != {"wallet-6", "wallet-7"}:
            raise ReleaseInputError("wallet_pnl_expected must contain wallet-6 and wallet-7")
        for account, address in expected_accounts.items():
            if not isinstance(address, str) or not re.fullmatch(r"0x[0-9a-fA-F]{40}", address):
                raise ReleaseInputError(f"wallet_pnl_expected.{account} is not an address")
    smoke_paths(metadata)
    timeout = metadata.get("ui_timeout_seconds", 900)
    interval = metadata.get("ui_poll_seconds", 5)
    if type(timeout) is not int or not 1 <= timeout <= 1800 or type(interval) is not int or not 1 <= interval <= 60:
        raise ReleaseInputError("UI timeout/poll values are outside safe bounds")
    startup_timeout = metadata.get("startup_timeout_seconds", 60)
    if type(startup_timeout) is not int or not 1 <= startup_timeout <= 300:
        raise ReleaseInputError("startup_timeout_seconds is outside safe bounds")
    base_url = urlsplit(str(metadata["legacy_http_base_url"]))
    try:
        private_host = ipaddress.ip_address(base_url.hostname or "")
    except ValueError as error:
        raise ReleaseInputError("legacy_http_base_url must use a private IP address") from error
    if base_url.scheme != "http" or not private_host.is_private or base_url.port != LEGACY_PORT or base_url.path not in ("", "/") or base_url.username or base_url.password or base_url.query or base_url.fragment:
        raise ReleaseInputError("legacy_http_base_url must be a private HTTP origin on port 13000")
    if metadata.get("unit", LEGACY_UNIT) != LEGACY_UNIT or metadata.get("container", LEGACY_CONTAINER) != LEGACY_CONTAINER or metadata.get("image_ref", LEGACY_TAG) != LEGACY_TAG:
        raise ReleaseInputError("legacy target is not prediction-console on port 13000")
    return metadata


DEFAULT_SMOKE_PATHS = ("/live", "/backtest-platform", "/dataset-rotation")


def smoke_paths(metadata: dict[str, Any]) -> list[str]:
    """Pages that must answer HTTP 200 after the swap (metadata `smoke_pages`, default: the three main pages)."""
    paths = metadata.get("smoke_pages", list(DEFAULT_SMOKE_PATHS))
    if not isinstance(paths, list) or not 1 <= len(paths) <= 10:
        raise ReleaseInputError("smoke_pages must be a list of 1 to 10 paths")
    for path in paths:
        if not isinstance(path, str) or not re.fullmatch(r"/[A-Za-z0-9._/-]{0,98}", path) or ".." in path or "//" in path:
            raise ReleaseInputError("smoke_pages entries must be plain absolute paths such as /live")
    return paths


def sha_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class RemoteIO:
    """Small real-IO adapter; tests replace this class with a fake."""

    def run(self, *args: str, check: bool = True) -> str:
        result = subprocess.run(args, check=check, capture_output=True, text=True, timeout=60)
        return result.stdout.strip()

    def docker_inspect(self, name: str) -> dict[str, Any]:
        return json.loads(self.run("docker", "inspect", name))[0]

    def docker_image(self, ref: str) -> tuple[str, dict[str, Any]]:
        payload = json.loads(self.run("docker", "image", "inspect", ref, "--format", "{{json .}}"))
        return payload["Id"], payload

    def systemd_state(self, unit: str) -> str:
        # Inactive/failed is an observed state, not an IO error that should
        # prevent the rollback adapter from restoring the known old image.
        return self.run("systemctl", "is-active", unit, check=False)

    def backend_sha(self, backend: dict[str, Any]) -> str:
        pid = str(backend["pid"])
        exe = os.readlink(f"/proc/{pid}/exe")
        if exe != backend["binary_path"]:
            raise RuntimeError("backend executable path changed")
        return sha_file(exe)

    def http_json(self, url: str) -> tuple[int, dict[str, Any]]:
        with urlopen(Request(url, headers={"accept": "application/json"}), timeout=12) as response:
            body = response.read(2 * 1024 * 1024)
            return response.status, json.loads(body)

    def http_text(self, url: str) -> tuple[int, str]:
        with urlopen(Request(url, headers={"accept": "text/html"}), timeout=12) as response:
            return response.status, response.read(4 * 1024 * 1024).decode("utf-8", "replace")

    def tag(self, image: str, ref: str) -> None:
        self.run("docker", "tag", image, ref)

    def restart(self, unit: str) -> None:
        self.run("systemctl", "restart", unit)


def container_facts(io: RemoteIO, name: str) -> dict[str, Any]:
    try:
        payload = io.docker_inspect(name)
    except subprocess.CalledProcessError as error:
        message = (error.stderr or "").lower()
        if error.returncode == 1 and ("no such object" in message or "no such container" in message):
            raise ContainerMissing(name) from error
        raise
    state = payload.get("State") or {}
    return {
        "id": payload.get("Id"), "image": payload.get("Image"), "started_at": state.get("StartedAt"),
        "restart_count": payload.get("RestartCount"), "status": state.get("Status"),
        "running": state.get("Running") is True,
    }


def pointer_target(pointer: str) -> str:
    path = Path(pointer)
    if path.is_symlink():
        return str(path.resolve())
    if path.exists():
        raise RuntimeError("current pointer is not a symlink")
    raise RuntimeError("current pointer is missing")


def runtime_observed(io: RemoteIO, metadata: dict[str, Any], *, allow_legacy_missing: bool = False) -> dict[str, Any]:
    try:
        legacy = container_facts(io, LEGACY_CONTAINER)
    except ContainerMissing:
        if not allow_legacy_missing:
            raise
        legacy = None
    v2 = container_facts(io, V2_CONTAINER)
    legacy_tag, labels_payload = io.docker_image(LEGACY_TAG)
    candidate_id, candidate_payload = io.docker_image(metadata["image_sha256"])
    v2_tag, _ = io.docker_image(V2_TAG)
    backend_sha = io.backend_sha(metadata["backend_identity"])
    return {
        "legacy_identity": ({**legacy, "pointer": str(metadata["legacy_identity"]["pointer"]), "pointer_target": pointer_target(metadata["legacy_identity"]["pointer"])} if legacy is not None else None),
        "protected_v2_identity": v2,
        "legacy_tag_image": legacy_tag,
        "protected_v2_tag_image": v2_tag,
        "current_pointer_target": pointer_target(metadata["legacy_identity"]["pointer"]),
        "backend_binary_sha256": backend_sha,
        "candidate_image": candidate_id,
        "candidate_labels": (candidate_payload.get("Config") or {}).get("Labels") or {},
        "legacy_tag_labels": (labels_payload.get("Config") or {}).get("Labels") or {},
        "systemd_state": io.systemd_state(LEGACY_UNIT),
    }


def expected_labels(metadata: dict[str, Any]) -> dict[str, str]:
    return {
        "org.opencontainers.image.revision": metadata["merge_sha"],
        "org.opencontainers.image.source-branch": "main",
        "com.unipai.release-profile": "legacy",
        "com.unipai.source-archive-sha256": metadata["source_archive_sha256"],
        "com.unipai.backend-binary-sha256": metadata["backend_identity"]["binary_sha256"],
    }


def compare_identity(expected: dict[str, Any], actual: dict[str, Any], label: str) -> None:
    for key in ("id", "image", "started_at", "restart_count", "status", "running"):
        if actual.get(key) != expected.get(key):
            raise RuntimeError(f"{label} identity changed: {key}")


def compare_instance(expected: dict[str, Any], actual: dict[str, Any], label: str) -> None:
    # A known container may move from running to exited during a failed start;
    # its instance still has to match before we are allowed to replace it.
    for key in ("id", "image", "started_at", "restart_count"):
        if actual.get(key) != expected.get(key):
            raise RuntimeError(f"{label} identity changed: {key}")


def validate_preflight(metadata: dict[str, Any], observed: dict[str, Any]) -> None:
    validate_metadata(metadata)
    compare_identity(metadata["legacy_identity"], observed["legacy_identity"], "legacy")
    compare_identity(metadata["protected_v2_identity"], observed["protected_v2_identity"], "protected V2")
    if observed.get("legacy_tag_image") != metadata["legacy_identity"]["image"]:
        raise RuntimeError("prediction-console:current does not point to recorded old image")
    validate_protected_backend(metadata, observed)
    if observed.get("current_pointer_target") != metadata["legacy_identity"]["pointer_target"]:
        raise RuntimeError("legacy current pointer changed")
    if observed.get("backend_binary_sha256") != metadata["backend_identity"]["binary_sha256"]:
        raise RuntimeError("backend process binary changed")
    if observed.get("systemd_state") != "active":
        raise RuntimeError("legacy systemd unit is not active")
    if observed.get("candidate_image") != metadata["image_sha256"]:
        raise RuntimeError("candidate immutable image digest does not match metadata")
    labels = observed.get("candidate_labels") or {}
    for key, expected in expected_labels(metadata).items():
        if labels.get(key) != expected:
            raise RuntimeError(f"candidate image label mismatch: {key}")


def validate_protected_backend(metadata: dict[str, Any], observed: dict[str, Any]) -> None:
    compare_identity(metadata["protected_v2_identity"], observed["protected_v2_identity"], "protected V2")
    if observed.get("protected_v2_tag_image") != metadata["protected_v2_identity"]["image"]:
        raise RuntimeError("prediction-console-v2:current changed")
    if observed.get("backend_binary_sha256") != metadata["backend_identity"]["binary_sha256"]:
        raise RuntimeError("backend process binary changed")


def write_release(metadata: dict[str, Any], observed: dict[str, Any]) -> Path:
    release = Path(safe_release(metadata["release"]))
    if release.exists() or release.is_symlink():
        raise RuntimeError("release directory already exists")
    release.mkdir(parents=True)
    payload = {
        "merge_sha": metadata["merge_sha"], "source_branch": "main",
        "source_archive_sha256": metadata["source_archive_sha256"], "image_sha256": metadata["image_sha256"],
        "backend_binary_sha256": metadata["backend_identity"]["binary_sha256"], "created_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "baseline": {"legacy_identity": metadata["legacy_identity"], "protected_v2_identity": metadata["protected_v2_identity"]},
    }
    (release / "DEPLOYMENT.json").write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return release


def atomic_pointer(pointer: str, target: str) -> None:
    path = Path(pointer)
    temp = path.with_name(f".{path.name}.next-{os.getpid()}")
    if temp.exists() or temp.is_symlink():
        raise RuntimeError("atomic pointer temporary path already exists")
    temp.symlink_to(target)
    os.replace(temp, path)


def wait_for_live(io: RemoteIO, metadata: dict[str, Any]) -> tuple[int, str]:
    base_url = str(metadata["legacy_http_base_url"]).rstrip("/")
    deadline = time.monotonic() + metadata.get("startup_timeout_seconds", 60)
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            status, html = io.http_text(f"{base_url}/live")
            if status == 200:
                return status, html
            last_error = RuntimeError(f"legacy /live returned HTTP {status}")
        except Exception as error:  # connection refusal during process startup is expected
            last_error = error
        time.sleep(min(2, metadata.get("ui_poll_seconds", 5)))
    raise TimeoutError(f"legacy /live did not become ready: {last_error}")


def wait_for_container(
    io: RemoteIO, metadata: dict[str, Any], expected_image: str,
    *, previous: dict[str, Any] | None = None, startup: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Wait for Docker's async create/start without accepting a stale container."""
    deadline = time.monotonic() + metadata.get("startup_timeout_seconds", 60)
    while time.monotonic() < deadline:
        try:
            current = container_facts(io, LEGACY_CONTAINER)
        except ContainerMissing:
            current = None
        if current is not None:
            if previous is not None and current.get("id") == previous.get("id"):
                compare_instance(previous, current, "previous legacy")
            elif current.get("image") != expected_image:
                raise RuntimeError("unexpected legacy container image during startup")
            else:
                if not current.get("id"):
                    raise RuntimeError("legacy container has no instance ID")
                # Remember only ownership while it is still starting.  This
                # is not a successful candidate identity until it is running.
                if startup is not None:
                    observed = startup.get("startup_identity")
                    owner = {"id": current["id"], "image": current["image"]}
                    if observed is not None and observed != owner:
                        raise RuntimeError("legacy startup container was replaced")
                    startup["startup_identity"] = owner
                if current.get("running") is True and current.get("status") == "running":
                    return current
        time.sleep(min(2, metadata.get("ui_poll_seconds", 5)))
    raise TimeoutError("expected legacy container did not become running")


def verify_ui(io: RemoteIO, metadata: dict[str, Any]) -> None:
    base_url = str(metadata["legacy_http_base_url"]).rstrip("/")
    status, html = wait_for_live(io, metadata)
    if status != 200:
        raise RuntimeError("legacy /live is not healthy")
    for path in smoke_paths(metadata):
        status, _ = io.http_text(f"{base_url}{path}")
        if status != 200:
            raise RuntimeError(f"legacy {path} returned HTTP {status}")
    expected_accounts = metadata.get("wallet_pnl_expected")
    if not expected_accounts:
        return
    if "官方盈亏" not in html or "运行监控" not in html:
        raise RuntimeError("legacy /live did not expose both tabs")
    for account, address in expected_accounts.items():
        status, payload = io.http_json(f"{base_url}/api/console/wallet-pnl?execution_account_id={account}&interval=1w&fidelity=3h")
        data = payload.get("data") if isinstance(payload, dict) else None
        points = data.get("points") if isinstance(data, dict) else None
        if status != 200 or not isinstance(data, dict) or not isinstance(data.get("wallet_address"), str) or data["wallet_address"].lower() != address.lower() or not isinstance(points, list) or len(points) < 2:
            raise RuntimeError(f"wallet PnL probe failed for {account}")


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


def rollback(io: RemoteIO, metadata: dict[str, Any], candidate: dict[str, Any], baseline: dict[str, Any]) -> None:
    current = runtime_observed(io, metadata, allow_legacy_missing=True)
    old_image = metadata["legacy_identity"]["image"]
    old_pointer = metadata["legacy_identity"]["pointer_target"]
    candidate_image = metadata["image_sha256"]
    candidate_pointer = safe_release(metadata["release"])
    if current.get("legacy_tag_image") not in {old_image, candidate_image} or current.get("current_pointer_target") not in {old_pointer, candidate_pointer}:
        raise RuntimeError("rollback CAS refused: legacy state is no longer owned")
    current_identity = current.get("legacy_identity")
    if current_identity is not None:
        if candidate.get("candidate_identity") is not None:
            compare_instance(candidate["candidate_identity"], current_identity, "candidate legacy")
        elif candidate.get("startup_identity") is not None:
            owner = {"id": current_identity["id"], "image": current_identity["image"]}
            if owner != candidate["startup_identity"]:
                raise RuntimeError("rollback CAS refused: startup container was replaced")
        else:
            compare_instance(baseline["legacy_identity"], current_identity, "baseline legacy")
    if current.get("protected_v2_identity") != metadata["protected_v2_identity"] or current.get("backend_binary_sha256") != metadata["backend_identity"]["binary_sha256"]:
        raise RuntimeError("rollback CAS refused: protected V2/backend changed")
    validate_protected_backend(metadata, current)
    if current.get("legacy_tag_image") == candidate_image:
        io.tag(old_image, LEGACY_TAG)
    if current.get("current_pointer_target") == candidate_pointer:
        atomic_pointer(metadata["legacy_identity"]["pointer"], old_pointer)
    needs_restart = current_identity is None or current_identity["id"] != baseline["legacy_identity"]["id"] or not current_identity.get("running")
    if needs_restart:
        io.restart(LEGACY_UNIT)
    restored = wait_for_container(io, metadata, old_image, previous=current_identity if needs_restart else None)
    wait_for_live(io, metadata)
    verified = runtime_observed(io, metadata)
    compare_identity(restored, verified["legacy_identity"], "restored legacy")
    if verified.get("legacy_tag_image") != old_image or verified.get("current_pointer_target") != old_pointer or verified.get("systemd_state") != "active":
        raise RuntimeError("legacy rollback did not restore the recorded image/pointer")
    validate_protected_backend(metadata, verified)
    emit("legacy_frontend_rollback_verified", container=restored)


def deploy(metadata: dict[str, Any], io: RemoteIO, *, lock_path: Path = LOCK_PATH) -> None:
    validate_metadata(metadata)
    with deploy_lock(lock_path):
        baseline = runtime_observed(io, metadata)
        validate_preflight(metadata, baseline)
        release = write_release(metadata, baseline)
        candidate = {"candidate_identity": None}
        try:
            io.tag(metadata["image_sha256"], LEGACY_TAG)
            atomic_pointer(metadata["legacy_identity"]["pointer"], str(release))
            emit("legacy_frontend_restart_requested", image=metadata["image_sha256"], release=str(release))
            io.restart(LEGACY_UNIT)
            candidate["candidate_identity"] = wait_for_container(io, metadata, metadata["image_sha256"], previous=baseline["legacy_identity"], startup=candidate)
            emit("legacy_frontend_container_ready", container=candidate["candidate_identity"])
            current = runtime_observed(io, metadata)
            if current.get("legacy_tag_image") != metadata["image_sha256"] or current.get("legacy_identity", {}).get("image") != metadata["image_sha256"] or current.get("current_pointer_target") != str(release):
                raise RuntimeError("new legacy image/pointer is not running")
            compare_identity(candidate["candidate_identity"], current["legacy_identity"], "candidate legacy")
            validate_protected_backend(metadata, current)
            verify_ui(io, metadata)
            emit("legacy_frontend_http_verified", image=metadata["image_sha256"])
            release_file = release / "UI_VERIFIED"
            deadline = time.monotonic() + metadata.get("ui_timeout_seconds", 900)
            emit("legacy_frontend_waiting_ui", release=str(release))
            while time.monotonic() < deadline:
                current = runtime_observed(io, metadata)
                if current.get("legacy_tag_image") != metadata["image_sha256"] or current.get("legacy_identity", {}).get("image") != metadata["image_sha256"] or current.get("current_pointer_target") != str(release):
                    raise RuntimeError("legacy image/pointer changed during UI wait")
                compare_identity(candidate["candidate_identity"], current["legacy_identity"], "candidate legacy")
                validate_protected_backend(metadata, current)
                if (release / "UI_REJECTED").exists() or (release / "UI_REJECTED").is_symlink():
                    raise RuntimeError("UI_REJECTED handshake exists")
                if not release_file.is_symlink() and release_file.is_file() and release_file.read_text(encoding="utf-8").strip() == metadata["merge_sha"]:
                    emit("legacy_frontend_verified", image=metadata["image_sha256"], container=current["legacy_identity"], release=str(release))
                    return
                time.sleep(metadata.get("ui_poll_seconds", 5))
            raise TimeoutError("UI_VERIFIED handshake timed out")
        except Exception as error:
            emit("legacy_frontend_rollback_started", error_type=type(error).__name__)
            rollback(io, metadata, candidate, baseline)
            raise


def load_metadata(path: str) -> dict[str, Any]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    """Run on the production host as root: --metadata-json <file> with exactly one of --preflight / --deploy."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--metadata-json", required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument("--preflight", action="store_true", help="read-only checks of the live state and the candidate image")
    mode.add_argument("--deploy", action="store_true", help="swap prediction-console:current, wait for the UI handshake, roll back on any failure")
    args = parser.parse_args(argv)
    try:
        metadata = load_metadata(args.metadata_json)
        validate_metadata(metadata)
        io = RemoteIO()
        if args.preflight:
            with deploy_lock():
                observed = runtime_observed(io, metadata)
                validate_preflight(metadata, observed)
                emit("legacy_frontend_preflight_ok", observed={"legacy": observed["legacy_identity"], "protected_v2": observed["protected_v2_identity"], "backend_binary_sha256": observed["backend_binary_sha256"], "candidate_image": observed["candidate_image"]})
            return 0
        deploy(metadata, io)
        return 0
    except Exception as error:
        emit("legacy_frontend_failed", error_type=type(error).__name__)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
