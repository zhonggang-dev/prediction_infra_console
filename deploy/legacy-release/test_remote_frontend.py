#!/usr/bin/env python3
"""Mock-IO tests for the legacy 13000 remote deployment runner."""

from __future__ import annotations

from contextlib import contextmanager
import fcntl
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


OPS = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("remote_frontend", OPS / "remote_frontend.py")
assert spec and spec.loader
remote = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remote)


class FakeIO(remote.RemoteIO):
    def __init__(self, root: Path, metadata: dict[str, object], lock_path: Path):
        self.root = root
        self.metadata = metadata
        self.lock_path = lock_path
        self.current_image = metadata["legacy_identity"]["image"]
        self.legacy = dict(metadata["legacy_identity"])
        self.v2 = dict(metadata["protected_v2_identity"])
        self.candidate_labels = remote.expected_labels(metadata)
        self.lock_seen = False
        self.handshake_path: Path | None = None
        self.http_failures = 0
        self.restart_fail = False
        self.startup_states = []
        self.rollback_states = []
        self.pending_states = []
        self.restart_images = []
        self.http_images = []
        self.page_status: dict[str, int] = {}

    def docker_inspect(self, name):
        if name == remote.LEGACY_CONTAINER and self.pending_states:
            self._assert_lock()
            self.legacy = self.pending_states.pop(0)
        identity = self.legacy if name == remote.LEGACY_CONTAINER else self.v2
        if identity is None:
            raise subprocess.CalledProcessError(1, ["docker", "inspect", name], stderr=f"Error: No such container: {name}")
        return {"Id": identity["id"], "Image": identity["image"], "RestartCount": identity["restart_count"], "State": {"StartedAt": identity["started_at"], "Status": identity["status"], "Running": identity["running"]}}

    def docker_image(self, ref):
        if ref == remote.LEGACY_TAG:
            return self.current_image, {"Id": self.current_image, "Config": {"Labels": self.candidate_labels if self.current_image == self.metadata["image_sha256"] else {}}}
        if ref == remote.V2_TAG:
            return self.v2["image"], {"Id": self.v2["image"], "Config": {"Labels": {}}}
        if ref == self.metadata["image_sha256"]:
            return ref, {"Id": ref, "Config": {"Labels": self.candidate_labels}}
        raise AssertionError(f"unexpected image ref {ref}")

    def systemd_state(self, unit):
        assert unit == remote.LEGACY_UNIT
        return "active"

    def backend_sha(self, backend):
        return backend["binary_sha256"]

    def http_text(self, url):
        self._assert_lock()
        assert self.legacy is not None and self.legacy["running"] and self.legacy["image"] == self.current_image
        self.http_images.append(self.legacy["image"])
        assert url.startswith(self.metadata["legacy_http_base_url"])
        if self.http_failures:
            self.http_failures -= 1
            return 503, "starting"
        for path, status in self.page_status.items():
            if url.endswith(path):
                return status, "error"
        if self.handshake_path is not None:
            self.handshake_path.write_text(self.metadata["merge_sha"] + "\n", encoding="utf-8")
        return 200, "运行监控 官方盈亏"

    def http_json(self, url):
        self._assert_lock()
        account = "wallet-6" if "wallet-6" in url else "wallet-7"
        return 200, {"data": {"wallet_address": self.metadata["wallet_pnl_expected"][account], "points": [{"timestamp": 1, "trade_pnl": "0"}, {"timestamp": 2, "trade_pnl": "1"}]}}

    def _assert_lock(self):
        with self.lock_path.open("a+") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                self.lock_seen = True

    def tag(self, image, ref):
        assert ref == remote.LEGACY_TAG
        self.current_image = image

    def restart(self, unit):
        assert unit == remote.LEGACY_UNIT
        self.restart_images.append(self.current_image)
        if self.restart_fail and self.current_image == self.metadata["image_sha256"]:
            raise RuntimeError("simulated restart failure")
        if self.current_image == self.metadata["image_sha256"]:
            if self.startup_states:
                self.pending_states = list(self.startup_states)
            else:
                self.legacy = self.candidate_identity()
        else:
            if self.rollback_states:
                self.pending_states = list(self.rollback_states)
            else:
                self.pending_states = []
                self.legacy = dict(self.metadata["legacy_identity"])

    def candidate_identity(self):
        return {"id": "f" * 64, "image": self.metadata["image_sha256"], "started_at": "2026-10-26T02:00:00Z", "restart_count": 0, "status": "running", "running": True}


class FakeClock:
    def __init__(self):
        self.now = 0

    def monotonic(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


@contextmanager
def fixture():
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        release_root = root / "releases"
        old_release = release_root / "bfc6513-old"
        old_release.mkdir(parents=True)
        current = root / "current"
        current.symlink_to(old_release)
        previous_root = remote.ROOT
        remote.ROOT = root
        try:
            metadata = {
                "release": str(release_root / "candidate"), "merge_sha": "a" * 40, "source_branch": "main",
                "source_archive_sha256": "b" * 64, "image_sha256": "sha256:" + "d" * 64,
                "backend_identity": {"pid": 42, "binary_path": "/usr/local/bin/backend", "binary_sha256": "e" * 64},
                "legacy_identity": {"id": "1" * 64, "image": "sha256:" + "2" * 64, "started_at": "2026-10-26T00:00:00Z", "restart_count": 0, "status": "running", "running": True, "pointer": str(current), "pointer_target": str(old_release.resolve())},
                "protected_v2_identity": {"id": "3" * 64, "image": "sha256:" + "4" * 64, "started_at": "2026-10-26T00:00:00Z", "restart_count": 0, "status": "running", "running": True},
                "wallet_pnl_expected": {"wallet-6": "0x" + "6" * 40, "wallet-7": "0x" + "7" * 40},
                "legacy_http_base_url": "http://172.21.20.221:13000",
                "ui_timeout_seconds": 2, "ui_poll_seconds": 1,
            }
            lock = root / "deploy.lock"
            yield root, metadata, lock
        finally:
            remote.ROOT = previous_root


class RemoteFrontendTests(unittest.TestCase):
    def test_preflight_rejects_unknown_candidate_label_and_protected_v2_change(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            observed = remote.runtime_observed(fake, metadata)
            remote.validate_preflight(metadata, observed)
            fake.candidate_labels = {**fake.candidate_labels, "com.unipai.release-profile": "v2"}
            observed = remote.runtime_observed(fake, metadata)
            with self.assertRaises(RuntimeError):
                remote.validate_preflight(metadata, observed)
            fake.candidate_labels = remote.expected_labels(metadata)
            fake.v2["id"] = "9" * 64
            with self.assertRaises(RuntimeError):
                remote.validate_preflight(metadata, remote.runtime_observed(fake, metadata))

    def test_deploy_holds_lock_through_http_and_handshake(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            fake.handshake_path = root / "releases" / "candidate" / "UI_VERIFIED"
            remote.deploy(metadata, fake, lock_path=lock)
            self.assertTrue(fake.lock_seen)
            self.assertEqual(fake.current_image, metadata["image_sha256"])
            self.assertEqual((root / "current").resolve(), (root / "releases" / "candidate").resolve())

    def test_deploy_retries_startup_http_and_rolls_back_when_restart_fails(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            fake.handshake_path = root / "releases" / "candidate" / "UI_VERIFIED"
            fake.http_failures = 2
            metadata["startup_timeout_seconds"] = 3
            remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.current_image, metadata["image_sha256"])

        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            fake.restart_fail = True
            with self.assertRaises(RuntimeError):
                remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.current_image, metadata["legacy_identity"]["image"])
            self.assertEqual((root / "current").resolve(), (root / "releases" / "bfc6513-old").resolve())

    def test_deploy_waits_for_missing_container_then_new_running_candidate(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            ready = fake.candidate_identity()
            fake.startup_states = [None, {**ready, "status": "created", "running": False}, ready]
            fake.handshake_path = root / "releases" / "candidate" / "UI_VERIFIED"
            metadata["startup_timeout_seconds"] = 5
            clock = FakeClock()
            with patch.object(remote.time, "monotonic", clock.monotonic), patch.object(remote.time, "sleep", clock.sleep):
                remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.legacy["id"], ready["id"])
            self.assertEqual(fake.restart_images, [metadata["image_sha256"]])
            self.assertEqual(set(fake.http_images), {metadata["image_sha256"]})  # 页面请求只打到候选镜像
            self.assertEqual(clock.now, 2)
            self.assertTrue(fake.lock_seen)

    def test_delayed_old_container_is_not_accepted_as_new_candidate(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            old = dict(fake.legacy)
            ready = fake.candidate_identity()
            fake.startup_states = [old, {**old, "status": "exited", "running": False}, None, ready]
            fake.handshake_path = root / "releases" / "candidate" / "UI_VERIFIED"
            metadata["startup_timeout_seconds"] = 5
            clock = FakeClock()
            with patch.object(remote.time, "monotonic", clock.monotonic), patch.object(remote.time, "sleep", clock.sleep):
                remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(clock.now, 3)
            self.assertEqual(set(fake.http_images), {metadata["image_sha256"]})  # 页面请求只打到候选镜像
            self.assertNotEqual(fake.legacy["id"], old["id"])

    def test_startup_rejects_unknown_image_or_replacement_of_old_container(self):
        for unknown_image in ("sha256:" + "9" * 64, "sha256:" + "2" * 64):
            with self.subTest(image=unknown_image), fixture() as (root, metadata, lock):
                fake = FakeIO(root, metadata, lock)
                foreign = {**fake.candidate_identity(), "id": "8" * 64, "image": unknown_image}
                fake.startup_states = [foreign]
                with self.assertRaises(RuntimeError):
                    remote.deploy(metadata, fake, lock_path=lock)
                # No recovery mutation is allowed over an unowned container.
                self.assertEqual(fake.legacy, foreign)
                self.assertEqual(fake.current_image, metadata["image_sha256"])
                self.assertEqual(fake.restart_images, [metadata["image_sha256"]])
                self.assertEqual(fake.http_images, [])

    def test_startup_timeout_rolls_back_and_waits_for_restored_container_and_http(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            old = dict(fake.legacy)
            fake.startup_states = [None]
            fake.rollback_states = [None, {**old, "status": "created", "running": False}, old]
            fake.http_failures = 2
            metadata["startup_timeout_seconds"] = 3
            clock = FakeClock()
            with patch.object(remote.time, "monotonic", clock.monotonic), patch.object(remote.time, "sleep", clock.sleep):
                with self.assertRaisesRegex(TimeoutError, "container did not become running"):
                    remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.restart_images, [metadata["image_sha256"], old["image"]])
            self.assertEqual(fake.legacy, old)
            self.assertEqual(fake.http_images, [old["image"]] * 3)
            self.assertEqual((root / "current").resolve(), Path(old["pointer_target"]))
            self.assertEqual(clock.now, 7)
            self.assertTrue(fake.lock_seen)

    def test_nonrunning_known_candidate_can_be_rolled_back_after_timeout(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            old = dict(fake.legacy)
            fake.startup_states = [{**fake.candidate_identity(), "status": "created", "running": False}]
            fake.rollback_states = [None, old]
            metadata["startup_timeout_seconds"] = 2
            clock = FakeClock()
            with patch.object(remote.time, "monotonic", clock.monotonic), patch.object(remote.time, "sleep", clock.sleep):
                with self.assertRaises(TimeoutError):
                    remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.legacy, old)
            self.assertEqual(fake.current_image, old["image"])
            self.assertEqual(fake.restart_images, [metadata["image_sha256"], old["image"]])

    def test_ui_timeout_recovery_waits_past_candidate_container_and_missing_state(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            old = dict(fake.legacy)
            fake.rollback_states = [fake.candidate_identity(), None, old]
            metadata["startup_timeout_seconds"] = 4
            clock = FakeClock()
            with patch.object(remote.time, "monotonic", clock.monotonic), patch.object(remote.time, "sleep", clock.sleep):
                with self.assertRaisesRegex(TimeoutError, "UI_VERIFIED"):
                    remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(set(fake.http_images[:-1]), {metadata["image_sha256"]})
            self.assertEqual(fake.http_images[-1], old["image"])  # 回滚后最后一次探测的是恢复的旧镜像
            self.assertEqual(fake.legacy, old)
            self.assertEqual(clock.now, 4)

    def test_nonmissing_docker_failure_is_not_treated_as_async_startup(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            failure = subprocess.CalledProcessError(1, ["docker", "inspect"], stderr="permission denied")
            with patch.object(fake, "docker_inspect", side_effect=failure):
                with self.assertRaises(subprocess.CalledProcessError):
                    remote.runtime_observed(fake, metadata, allow_legacy_missing=True)

    def test_failed_unit_is_an_observed_state_for_rollback(self):
        io = remote.RemoteIO()
        with patch.object(io, "run", return_value="failed") as run:
            self.assertEqual(io.systemd_state(remote.LEGACY_UNIT), "failed")
        run.assert_called_once_with("systemctl", "is-active", remote.LEGACY_UNIT, check=False)

    def test_rollback_cas_rejects_third_party_before_tag_change(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            fake.current_image = "sha256:" + "9" * 64
            with self.assertRaises(RuntimeError):
                remote.rollback(fake, metadata, {"candidate_identity": metadata["legacy_identity"]}, metadata["legacy_identity"])
            self.assertEqual(fake.current_image, "sha256:" + "9" * 64)

    def test_rollback_cas_rejects_protected_tag_change_before_mutation(self):
        with fixture() as (root, metadata, lock):
            fake = FakeIO(root, metadata, lock)
            baseline = remote.runtime_observed(fake, metadata)
            fake.current_image = metadata["image_sha256"]
            fake.legacy = fake.candidate_identity()
            remote.atomic_pointer(metadata["legacy_identity"]["pointer"], metadata["release"])
            inspect_image = fake.docker_image

            def changed_v2_tag(ref):
                if ref == remote.V2_TAG:
                    return "sha256:" + "9" * 64, {}
                return inspect_image(ref)

            with patch.object(fake, "docker_image", side_effect=changed_v2_tag):
                with self.assertRaisesRegex(RuntimeError, "prediction-console-v2:current changed"):
                    remote.rollback(fake, metadata, {"candidate_identity": fake.legacy}, baseline)
            self.assertEqual(fake.current_image, metadata["image_sha256"])
            self.assertEqual((root / "current").resolve(), Path(metadata["release"]).resolve())
            self.assertEqual(fake.restart_images, [])

    def test_release_without_wallet_probes_or_legacy_source_commit_deploys(self):
        # 不碰官方盈亏卡片的发布：元数据里没有 wallet_pnl_expected，也没有（已取消的）legacy_source_commit
        with fixture() as (root, metadata, lock):
            metadata.pop("wallet_pnl_expected")
            self.assertNotIn("legacy_source_commit", metadata)
            fake = FakeIO(root, metadata, lock)
            fake.handshake_path = root / "releases" / "candidate" / "UI_VERIFIED"
            remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.current_image, metadata["image_sha256"])
            self.assertNotIn("com.unipai.legacy-source-commit", remote.expected_labels(metadata))
            deployment = (root / "releases" / "candidate" / "DEPLOYMENT.json").read_text(encoding="utf-8")
            self.assertNotIn("legacy_source_commit", deployment)

    def test_smoke_page_failure_rolls_back(self):
        with fixture() as (root, metadata, lock):
            metadata["smoke_pages"] = ["/live", "/backtest-platform"]
            fake = FakeIO(root, metadata, lock)
            fake.page_status = {"/backtest-platform": 500}
            with self.assertRaisesRegex(RuntimeError, "/backtest-platform returned HTTP 500"):
                remote.deploy(metadata, fake, lock_path=lock)
            self.assertEqual(fake.current_image, metadata["legacy_identity"]["image"])
            self.assertEqual((root / "current").resolve(), (root / "releases" / "bfc6513-old").resolve())

    def test_smoke_pages_default_to_the_three_main_pages_and_reject_unsafe_paths(self):
        with fixture() as (_, metadata, _):
            self.assertEqual(remote.smoke_paths(metadata), ["/live", "/backtest-platform", "/dataset-rotation"])
            for bad in (["live"], ["/a/../b"], ["//evil.example"], ["/live?x=1"], ["http://x/live"], [], ["/x"] * 11, "/live"):
                with self.subTest(bad=bad), self.assertRaises(remote.ReleaseInputError):
                    remote.validate_metadata({**metadata, "smoke_pages": bad})

    def test_wallet_probe_metadata_is_still_validated_when_present(self):
        with fixture() as (_, metadata, _):
            with self.assertRaises(remote.ReleaseInputError):
                remote.validate_metadata({**metadata, "wallet_pnl_expected": {"wallet-6": "0x" + "6" * 40}})

    def test_cli_has_a_single_explicit_path_and_no_hidden_modes(self):
        # 只能在服务器上运行：--metadata-json + 恰好一个 --preflight / --deploy；不存在转发 / 本地包装 / 隐藏参数
        for argv in (
            [],
            ["--metadata-json", "m.json"],
            ["--metadata-json", "m.json", "--preflight", "--deploy"],
            ["--metadata-json", "m.json", "--preflight", "--via-ssh"],
            ["--remote-metadata", "e30=", "--preflight"],
        ):
            with self.subTest(argv=argv), self.assertRaises(SystemExit) as raised:
                remote.main(argv)
            self.assertEqual(raised.exception.code, 2)
        for name in ("local_main", "base64", "shlex"):
            self.assertFalse(hasattr(remote, name), name)

    def test_metadata_cannot_target_v2_or_contain_credentials(self):
        with fixture() as (_, metadata, _):
            with self.assertRaises(remote.ReleaseInputError):
                remote.validate_metadata({**metadata, "image_ref": "prediction-console-v2:current"})
            with self.assertRaises(remote.ReleaseInputError):
                remote.validate_metadata({**metadata, "api_key": "do-not-accept"})


if __name__ == "__main__":
    unittest.main()
