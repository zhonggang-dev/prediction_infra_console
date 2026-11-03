"""Offline failure-injection tests for paired port changes and role preservation."""
from contextlib import contextmanager
import copy
import fcntl
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('remote_swap', Path(__file__).with_name('remote_swap.py'))
r = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(r)


class Clock:
    now = 0
    def monotonic(self):
        return self.now
    def sleep(self, seconds):
        self.now += seconds


class FakeIO(r.RemoteIO):
    def __init__(self, metadata):
        self.metadata = metadata
        self.tags = {name: metadata['baseline'][name]['container']['image'] for name in r.NAMES}
        self.containers = {name: self.payload(metadata['baseline'][name]['container'], name, metadata['baseline'][name]['port']) for name in r.NAMES}
        self.serial = 0
        self.operations = []
        self.fail_start = None
        self.fail_after_create = False
        self.fail_page_once = False
        self.reject_ui = False
        self.verify_ui = True
        self.foreign_on_page = False
        self.backend_changed = False
        self.locks_seen = False
        self.labels = {'org.opencontainers.image.revision': metadata['merge_sha'], 'org.opencontainers.image.source-branch': 'main', 'org.opencontainers.image.source-archive-sha256': metadata['source_archive_sha256']}

    def payload(self, identity, name, port):
        return {'Id': identity['id'], 'Image': identity['image'], 'RestartCount': identity['restart_count'], 'State': {'StartedAt': identity['started_at'], 'Running': identity['running'], 'Status': identity['status']},
                'Config': {'Cmd': ['pnpm', 'start', '--port', str(port)] if name == r.NAMES[0] else ['pnpm', 'start:v2'],
                           'Env': ['PREDICTION_CONSOLE_V2_PORT=' + str(port)]}}

    def unit_contract(self, name):
        pass

    def backend(self, expected):
        if self.backend_changed:
            raise r.UnsafeRelease('backend changed')

    def container(self, name):
        return self.containers[name]

    def image(self, ref):
        image = self.tags[ref.removesuffix(':current')] if ref.endswith(':current') else ref
        return {'Id': image, 'Config': {'Labels': self.labels if image == self.metadata['image_sha256'] else {}}}

    def assert_locks(self):
        for name in r.NAMES:
            with (r.ROOTS[name] / '.deploy.lock').open('a+') as handle:
                try:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    continue
                raise AssertionError('mutation or HTTP check outside dual lock')
        self.locks_seen = True

    def stop(self, name):
        self.assert_locks()
        self.operations.append(('stop', name))
        self.containers[name] = None

    def start(self, name):
        self.assert_locks()
        self.operations.append(('start', name))
        if self.fail_start == name:
            self.fail_start = None
            raise RuntimeError('simulated service start failure')
        portkey = 'PREDICTION_CONSOLE_PORT' if name == r.NAMES[0] else 'PREDICTION_CONSOLE_V2_PORT'
        envpath = r.CONFIG[name][1]
        env = envpath.read_text() if envpath.exists() else ''
        entries = [line.split('=', 1)[1] for line in env.splitlines() if line.startswith(portkey + '=')]
        # Old units without an external port variable use baseline hardcoded port.
        port = int(entries[-1]) if entries else self.metadata['baseline'][name]['port']
        # Ensure start cannot succeed if the other role already owns that port.
        for other, payload in self.containers.items():
            if other != name and payload and r.container_port(payload) == port:
                raise RuntimeError('port collision')
        self.serial += 1
        identity = {'id': str(self.serial) * 64, 'image': self.tags[name], 'restart_count': 0, 'running': True, 'status': 'running', 'started_at': 'new-' + str(self.serial)}
        self.containers[name] = self.payload(identity, name, port)
        if self.fail_after_create:
            self.fail_after_create = False
            raise RuntimeError('failed after container creation')

    def reload(self):
        self.assert_locks()
        self.operations.append(('reload',))

    def tag(self, image, name):
        self.assert_locks()
        self.tags[name] = image

    def page(self, host, port, path):
        self.assert_locks()
        if self.fail_page_once:
            self.fail_page_once = False
            raise RuntimeError('transient HTTP startup failure')
        release = Path(self.metadata['release'])
        # Only write UI handshakes while checking the candidate, not rollback.
        if self.tags[r.NAMES[1]] == self.metadata['image_sha256']:
            if self.foreign_on_page:
                self.foreign_on_page = False
                self.containers[r.NAMES[1]]['Id'] = 'foreign-instance'
            if self.reject_ui:
                (release / 'UI_REJECTED').write_text('rejected')
            elif self.verify_ui:
                (release / 'UI_VERIFIED').write_text(self.metadata['merge_sha'])


@contextmanager
def fixture(*, swapped=False, missing_env=False):
    with tempfile.TemporaryDirectory() as directory:
        base = Path(directory).resolve()
        roots = {name: base / name for name in r.NAMES}
        configs = {name: (base / 'etc' / (name + '.service'), base / 'etc' / name / 'service.env') for name in r.NAMES}
        for name in r.NAMES:
            old = roots[name] / 'releases' / 'baseline'
            old.mkdir(parents=True)
            (roots[name] / 'current').symlink_to(old)
            configs[name][0].parent.mkdir(parents=True, exist_ok=True)
            configs[name][1].parent.mkdir(parents=True, exist_ok=True)
            configs[name][0].write_text('original-unit-' + name)
            if not missing_env:
                configs[name][1].write_text('BIND_ADDRESS=172.21.20.221\nEXAMPLE_PRIVATE_VALUE=preserve-not-log\n')
        release = roots[r.NAMES[1]] / 'releases' / 'candidate'
        release.mkdir()
        (release / 'PREVIEW_VERIFIED').write_text('a' * 40)
        m = {'operation_id': 'test-swap', 'host': '172.21.20.221', 'release': str(release), 'merge_sha': 'a' * 40, 'source_branch': 'main', 'source_archive_sha256': 'b' * 64,
             'image_sha256': 'sha256:' + 'c' * 64, 'backend_identity': {'pid': 42, 'binary_path': '/opt/backend/current/server', 'binary_sha256': 'd' * 64}, 'startup_timeout_seconds': 2, 'ui_timeout_seconds': 3, 'baseline': {}}
        for index, name in enumerate(r.NAMES):
            m['baseline'][name] = {'container': {'id': 'baseline-' + name, 'image': 'sha256:' + str(index + 1) * 64, 'started_at': 'old', 'restart_count': 0, 'running': True, 'status': 'running'},
                'port': r.PORTS[name] if swapped else 13000 + index, 'pointer_target': str(roots[name] / 'releases' / 'baseline'),
                'unit_sha256': r.sha_file(configs[name][0]), 'service_env_sha256': r.sha_file(configs[name][1]), 'unit_template_sha256': r.sha_file(r.SOURCE_UNITS / (name + '.service'))}
        if swapped:
            for name in r.NAMES:
                configs[name][1].write_bytes(r.patch_port(configs[name][1].read_bytes(), name, r.PORTS[name]))
                m['baseline'][name]['service_env_sha256'] = r.sha_file(configs[name][1])
        clock = Clock()
        with patch.object(r, 'ROOTS', roots), patch.object(r, 'CONFIG', configs), patch.object(r.time, 'monotonic', clock.monotonic), patch.object(r.time, 'sleep', clock.sleep), patch.object(r, 'emit'):
            yield m, FakeIO(m), base


class PairReleaseTests(unittest.TestCase):
    def test_swaps_both_roles_preserving_legacy_image_and_backend(self):
        with fixture() as (m, fake, base):
            r.deploy(fake, m)
            self.assertEqual({name: r.container_port(fake.container(name)) for name in r.NAMES}, r.PORTS)
            self.assertEqual(fake.tags[r.NAMES[0]], m['baseline'][r.NAMES[0]]['container']['image'])
            self.assertEqual(fake.tags[r.NAMES[1]], m['image_sha256'])
            self.assertTrue(fake.locks_seen)
            self.assertEqual(fake.operations[:2], [('stop', r.NAMES[1]), ('stop', r.NAMES[0])])
            for name in r.NAMES:
                self.assertIn(b'EXAMPLE_PRIVATE_VALUE=preserve-not-log', r.CONFIG[name][1].read_bytes())
            backup = base / r.NAMES[1] / 'port-swaps' / m['operation_id']
            self.assertEqual(backup.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in backup.iterdir()))

    def test_post_swap_v2_release_never_restarts_protected_legacy(self):
        with fixture(swapped=True) as (m, fake, _):
            original = copy.deepcopy(fake.container(r.NAMES[0]))
            r.deploy(fake, m)
            self.assertEqual(fake.container(r.NAMES[0]), original)
            self.assertNotIn(('stop', r.NAMES[0]), fake.operations)
            self.assertNotIn(('start', r.NAMES[0]), fake.operations)

    def test_either_start_failure_restores_both_original_ports_configs_and_images(self):
        for name in r.NAMES:
            with self.subTest(name=name), fixture() as (m, fake, _):
                fake.fail_start = name
                with self.assertRaisesRegex(RuntimeError, 'simulated'):
                    r.deploy(fake, m)
                self.assert_baseline(m, fake)

    def test_start_failure_after_container_creation_restores_both(self):
        with fixture() as (m, fake, _):
            fake.fail_after_create = True
            with self.assertRaisesRegex(RuntimeError, 'after container creation'):
                r.deploy(fake, m)
            self.assert_baseline(m, fake)

    def test_already_swapped_ui_failure_restores_v2_without_restarting_legacy(self):
        with fixture(swapped=True) as (m, fake, _):
            legacy = copy.deepcopy(fake.container(r.NAMES[0]))
            fake.reject_ui = True
            with self.assertRaises(r.UnsafeRelease):
                r.deploy(fake, m)
            self.assert_baseline(m, fake)
            self.assertEqual(fake.container(r.NAMES[0]), legacy)
            self.assertNotIn(('stop', r.NAMES[0]), fake.operations)

    def test_unknown_tag_pointer_or_config_after_start_blocks_rollback(self):
        for kind in ('tag', 'pointer', 'config'):
            with self.subTest(kind=kind), fixture() as (m, fake, _):
                original_page = fake.page
                changed = False
                def page(*args):
                    nonlocal changed
                    original_page(*args)
                    if changed:
                        return
                    changed = True
                    if kind == 'tag': fake.tags[r.NAMES[1]] = 'sha256:' + '9' * 64
                    if kind == 'pointer': r.atomic_pointer(r.NAMES[1], str(r.ROOTS[r.NAMES[1]] / 'releases' / 'foreign'))
                    if kind == 'config': r.CONFIG[r.NAMES[1]][1].write_text('foreign=setting')
                fake.page = page
                with self.assertRaisesRegex(r.UnsafeRelease, 'CAS refused'):
                    r.deploy(fake, m)
                self.assertEqual(len([op for op in fake.operations if op[0] == 'stop']), 2)

    def test_container_restart_during_ui_wait_is_not_accepted(self):
        with fixture() as (m, fake, _):
            original_page = fake.page
            def page(*args):
                original_page(*args)
                fake.containers[r.NAMES[1]]['RestartCount'] = 1
            fake.page = page
            with self.assertRaisesRegex(r.UnsafeRelease, 'unknown frontend container'):
                r.deploy(fake, m)
            self.assertEqual(len([op for op in fake.operations if op[0] == 'stop']), 2)

    def test_marker_symlink_is_rejected_without_mutation(self):
        with fixture() as (m, fake, base):
            target = base / 'marker'
            target.write_text(m['merge_sha'])
            (Path(m['release']) / 'UI_VERIFIED').symlink_to(target)
            with self.assertRaises(r.UnsafeRelease):
                r.deploy(fake, m)
            self.assertEqual(fake.operations, [])

    def test_ui_reject_and_timeout_restore_both(self):
        for reject in (True, False):
            with self.subTest(reject=reject), fixture() as (m, fake, _):
                fake.reject_ui = reject
                fake.verify_ui = False
                with self.assertRaises((r.UnsafeRelease, TimeoutError)):
                    r.deploy(fake, m)
                self.assert_baseline(m, fake)

    def test_rollback_removes_previously_absent_service_env(self):
        with fixture(missing_env=True) as (m, fake, _):
            fake.reject_ui = True
            with self.assertRaises(r.UnsafeRelease):
                r.deploy(fake, m)
            self.assert_baseline(m, fake)
            self.assertTrue(all(not r.CONFIG[name][1].exists() for name in r.NAMES))

    def test_transient_http_startup_is_retried(self):
        with fixture() as (m, fake, _):
            fake.fail_page_once = True
            r.deploy(fake, m)
            self.assertEqual(fake.tags[r.NAMES[1]], m['image_sha256'])

    def test_unknown_instance_during_ui_wait_refuses_rollback(self):
        with fixture() as (m, fake, _):
            fake.foreign_on_page = True
            with self.assertRaisesRegex(r.UnsafeRelease, 'unknown frontend container'):
                r.deploy(fake, m)
            self.assertEqual([op for op in fake.operations if op[0] == 'stop'], [('stop', r.NAMES[1]), ('stop', r.NAMES[0])])

    def test_preflight_refuses_image_pointer_instance_config_or_port_drift(self):
        variants = ('image', 'pointer', 'instance', 'config', 'port', 'backend')
        for kind in variants:
            with self.subTest(kind=kind), fixture() as (m, fake, _):
                if kind == 'image': fake.tags[r.NAMES[0]] = 'sha256:' + '9' * 64
                if kind == 'pointer': r.atomic_pointer(r.NAMES[0], str(r.ROOTS[r.NAMES[0]] / 'releases' / 'foreign'))
                if kind == 'instance': fake.containers[r.NAMES[0]]['Id'] = 'foreign'
                if kind == 'config': r.CONFIG[r.NAMES[0]][1].write_text('changed')
                if kind == 'port': fake.containers[r.NAMES[0]]['Config']['Cmd'][-1] = '13005'
                if kind == 'backend': fake.backend_changed = True
                with self.assertRaises(r.UnsafeRelease):
                    r.deploy(fake, m)
                self.assertEqual(fake.operations, [])

    def test_main_attestation_preview_and_fresh_ui_marker_required(self):
        for kind in ('branch', 'label', 'preview', 'marker'):
            with self.subTest(kind=kind), fixture() as (m, fake, _):
                if kind == 'branch': m['source_branch'] = 'fix/feature'
                if kind == 'label': fake.labels['org.opencontainers.image.source-archive-sha256'] = 'e' * 64
                if kind == 'preview': (Path(m['release']) / 'PREVIEW_VERIFIED').write_text('z' * 40)
                if kind == 'marker': (Path(m['release']) / 'UI_VERIFIED').write_text(m['merge_sha'])
                with self.assertRaises(r.UnsafeRelease): r.deploy(fake, m)
                self.assertEqual(fake.operations, [])

    def test_dual_locks_reject_a_concurrent_legacy_or_v2_release(self):
        for name in r.NAMES:
            with self.subTest(name=name), fixture() as (m, fake, _):
                with (r.ROOTS[name] / '.deploy.lock').open('a+') as handle:
                    fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                    with self.assertRaises(r.UnsafeRelease): r.deploy(fake, m)
                self.assertEqual(fake.operations, [])

    def test_backup_operation_cannot_be_reused(self):
        with fixture() as (m, fake, _):
            backup = r.ROOTS[r.NAMES[1]] / 'port-swaps' / m['operation_id']
            backup.mkdir(parents=True)
            with self.assertRaises(FileExistsError): r.deploy(fake, m)
            self.assertEqual(fake.operations, [])

    def test_capture_outputs_only_public_baseline_facts(self):
        with fixture() as (m, fake, _):
            result = r.capture_metadata(fake, **{key: m[key] for key in ('operation_id', 'host', 'release', 'merge_sha', 'source_archive_sha256', 'image_sha256', 'backend_identity')})
            self.assertEqual(result['baseline'], m['baseline'])
            self.assertNotIn('preserve-not-log', json.dumps(result))

    def test_unit_template_must_encode_correct_service_port_contract(self):
        for name in r.NAMES:
            text = (r.SOURCE_UNITS / (name + '.service')).read_text()
            r.validate_unit_template(text, name)
            with self.assertRaises(r.UnsafeRelease):
                r.validate_unit_template(text.replace(str(r.PORTS[name]), '13005'), name)

    def assert_baseline(self, m, fake):
        for name in r.NAMES:
            b = m['baseline'][name]
            self.assertEqual(r.container_port(fake.container(name)), b['port'])
            self.assertEqual(fake.tags[name], b['container']['image'])
            self.assertEqual(r.pointer_target(name), b['pointer_target'])
            self.assertEqual(r.sha_file(r.CONFIG[name][0]), b['unit_sha256'])
            self.assertEqual(r.sha_file(r.CONFIG[name][1]), b['service_env_sha256'])


if __name__ == '__main__':
    unittest.main()
