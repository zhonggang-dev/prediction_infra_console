#!/usr/bin/env python3
"""Offline tests for the legacy 13000 release guards."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


OPS = Path(__file__).resolve().parent


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, OPS / f"{name}.py")
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


frontend = load("deploy_frontend")


def frontend_metadata() -> dict[str, object]:
    return {
        "release": "/opt/prediction-console/releases/candidate",
        "merge_sha": "b" * 40,
        "source_branch": "main",
        "image_sha256": "sha256:" + "c" * 64,
        "expected_backend_binary_sha": "a" * 64,
        "legacy_identity": {"id": "legacy-id", "image": "sha256:" + "1" * 64, "started_at": "2026-10-26T00:00:00Z"},
        "protected_v2_identity": {"id": "v2-id", "image": "sha256:" + "2" * 64, "started_at": "2026-10-26T00:00:00Z"},
        "unit": "prediction-console.service",
        "image_ref": "prediction-console:current",
    }


class FrontendGuardTests(unittest.TestCase):
    def test_legacy_target_and_protected_v2_identity_are_strict(self):
        metadata = frontend_metadata()
        labels = {"org.opencontainers.image.source-branch": "main", "org.opencontainers.image.revision": metadata["merge_sha"], "com.unipai.release-profile": "legacy", "com.unipai.backend-binary-sha256": metadata["expected_backend_binary_sha"]}
        frontend.validate_image_attestation(metadata, labels)
        with self.assertRaises(frontend.ReleaseInputError):
            frontend.validate_image_attestation(metadata, {**labels, "com.unipai.release-profile": "v2"})
        observed = {"legacy_identity": metadata["legacy_identity"], "protected_v2_identity": metadata["protected_v2_identity"], "current_image_sha256": metadata["image_sha256"], "backend_binary_sha": metadata["expected_backend_binary_sha"], "image_labels": labels}
        self.assertEqual(frontend.validate_preflight(metadata, observed)["port"], 13000)
        with self.assertRaises(frontend.ReleaseInputError):
            frontend.validate_preflight(metadata, {**observed, "protected_v2_identity": {"id": "changed", "image": "v2-image", "started_at": "2026-10-26T00:00:00Z"}})

    def test_metadata_no_longer_needs_the_legacy_source_commit(self):
        metadata = frontend_metadata()
        self.assertNotIn("legacy_source_commit", metadata)
        self.assertEqual(frontend.validate_metadata(metadata), metadata)
        for key in ("merge_sha", "image_sha256", "expected_backend_binary_sha"):
            with self.assertRaises(frontend.ReleaseInputError):
                frontend.validate_metadata({k: v for k, v in metadata.items() if k != key})

    def test_ui_handshake_and_rollback_ownership_are_cas_guarded(self):
        metadata = frontend_metadata()
        with tempfile.TemporaryDirectory() as directory:
            release = Path(directory)
            with self.assertRaises(TimeoutError):
                frontend.validate_ui_handshake(release, metadata["merge_sha"])
            (release / "UI_VERIFIED").write_text(metadata["merge_sha"] + "\n", encoding="utf-8")
            self.assertEqual(frontend.validate_ui_handshake(release, metadata["merge_sha"]), "UI_VERIFIED")
        observed = {"legacy_identity": metadata["legacy_identity"], "protected_v2_identity": metadata["protected_v2_identity"], "current_image_sha256": metadata["image_sha256"]}
        frontend.rollback_if_owned(observed, metadata)
        with self.assertRaises(RuntimeError):
            frontend.rollback_if_owned({**observed, "protected_v2_identity": {"id": "third-party"}}, metadata)


if __name__ == "__main__":
    unittest.main()
