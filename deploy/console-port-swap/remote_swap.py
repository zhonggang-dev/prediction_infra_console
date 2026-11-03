#!/usr/bin/env python3
"""Switch both Console ports under both deployment locks; never touches a backend.

Run as root on the deployment host. --preflight is read-only except acquiring
lock files. --deploy requires a preview marker for the exact main merge SHA.
All configuration backups are root-only. No environment value is logged.
"""
from __future__ import annotations

import argparse
from contextlib import ExitStack, contextmanager
import fcntl
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
from typing import Any
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from console_ports import PORTS

NAMES = ('prediction-console', 'prediction-console-v2')
ROOTS = {name: Path('/opt') / name for name in NAMES}
CONFIG = {name: (Path('/etc/systemd/system') / (name + '.service'), Path('/etc') / name / 'service.env') for name in NAMES}
SOURCE_UNITS = Path(__file__).resolve().parents[1]
ID = re.compile(r'^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$')
SHA40 = re.compile(r'^[0-9a-f]{40}$')
SHA64 = re.compile(r'^[0-9a-f]{64}$')
IMAGE = re.compile(r'^sha256:[0-9a-f]{64}$')


class UnsafeRelease(RuntimeError):
    pass


def emit(phase: str, **facts: Any) -> None:
    print(json.dumps({'phase': phase, **facts}, sort_keys=True), flush=True)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha_file(path: Path) -> str | None:
    if path.is_symlink():
        raise UnsafeRelease('configuration/marker must not be a symlink')
    return digest(path.read_bytes()) if path.is_file() else None


def no_secrets(value: Any) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            if any(word in key.lower() for word in ('token', 'secret', 'password', 'credential', 'private_key', 'api_key', 'authorization')):
                raise UnsafeRelease('metadata contains a sensitive key')
            no_secrets(child)
    elif isinstance(value, list):
        for child in value:
            no_secrets(child)


def validate_metadata(m: dict[str, Any]) -> None:
    no_secrets(m)
    if not ID.fullmatch(str(m.get('operation_id', ''))):
        raise UnsafeRelease('invalid operation_id')
    if m.get('source_branch') != 'main' or not SHA40.fullmatch(str(m.get('merge_sha', ''))):
        raise UnsafeRelease('candidate must identify an exact main merge')
    if not SHA64.fullmatch(str(m.get('source_archive_sha256', ''))) or not IMAGE.fullmatch(str(m.get('image_sha256', ''))):
        raise UnsafeRelease('missing immutable candidate attestation')
    host = ipaddress.ip_address(m.get('host', ''))
    if not host.is_private:
        raise UnsafeRelease('host must be a private IP address')
    base = ROOTS['prediction-console-v2'] / 'releases'
    release = Path(m.get('release', ''))
    if release.is_symlink() or release.parent.resolve() != base.resolve() or not ID.fullmatch(release.name):
        raise UnsafeRelease('release must be one directory below the V2 release root')
    baseline = m.get('baseline')
    if not isinstance(baseline, dict) or set(baseline) != set(NAMES):
        raise UnsafeRelease('both baseline identities are required')
    ports = {name: baseline[name].get('port') for name in NAMES}
    if ports not in ({NAMES[0]: 13000, NAMES[1]: 13001}, PORTS):
        raise UnsafeRelease('baseline must be a complete approved role/port mapping')
    for name in NAMES:
        b = baseline[name]
        if not isinstance(b.get('container'), dict) or not all(b['container'].get(k) for k in ('id', 'image', 'started_at')):
            raise UnsafeRelease('incomplete baseline container identity')
        if not IMAGE.fullmatch(str(b['container']['image'])) or not b['container'].get('running') or b['container'].get('restart_count') != 0:
            raise UnsafeRelease('baseline container is not stable')
        if 'pointer_target' not in b:
            raise UnsafeRelease('baseline pointer fact is required')
        target = b['pointer_target']
        if target is None:
            # Older V2 releases changed only the image tag and never created
            # current. Preserve that observed absence, rather than inventing a
            # release pointer. The legacy service always requires its pointer.
            if name != NAMES[1]:
                raise UnsafeRelease('only the V2 baseline may lack current')
        elif not isinstance(target, str) or Path(target).parent.resolve() != (ROOTS[name] / 'releases').resolve():
            raise UnsafeRelease('baseline pointer outside service release root')
        for field in ('unit_sha256', 'unit_template_sha256'):
            if not SHA64.fullmatch(str(b.get(field, ''))):
                raise UnsafeRelease('missing unit hash')
        if b.get('service_env_sha256') is not None and not SHA64.fullmatch(str(b['service_env_sha256'])):
            raise UnsafeRelease('invalid service configuration hash')
    backend = m.get('backend_identity') or {}
    if type(backend.get('pid')) is not int or backend['pid'] <= 1 or not str(backend.get('binary_path', '')).startswith('/opt/') or not SHA64.fullmatch(str(backend.get('binary_sha256', ''))):
        raise UnsafeRelease('backend identity is incomplete')
    for key, default, maximum in [('startup_timeout_seconds', 90, 300), ('ui_timeout_seconds', 900, 1800)]:
        value = m.get(key, default)
        if type(value) is not int or not 1 <= value <= maximum:
            raise UnsafeRelease('timeout outside safe bounds')


def validate_unit_template(text: str, name: str) -> None:
    key = 'PREDICTION_CONSOLE_V2_PORT' if name == NAMES[1] else 'PREDICTION_CONSOLE_PORT'
    required = [f'Environment={key}={PORTS[name]}',
                '--name ' + name + ' --network host', '--env-file /etc/' + name + '/env',
                name + ':current pnpm start:v2' if name == NAMES[1] else name + ':current pnpm start --',
                'ExecStop=/usr/bin/docker stop --time 20 ' + name]
    if any(part not in text for part in required):
        raise UnsafeRelease('candidate systemd template role/port contract mismatch')
    if name == NAMES[0] and '--port ${PREDICTION_CONSOLE_PORT}' not in text:
        raise UnsafeRelease('legacy port must be an explicit environment parameter')
    starts = [line for line in text.splitlines() if line.startswith('ExecStart=')]
    if len(starts) != 1 or '\nEnvironmentFile=-/etc/' + name + '/service.env' not in text:
        raise UnsafeRelease('unexpected systemd start/override contract')


def container_port(payload: dict[str, Any]) -> int:
    config = payload.get('Config') or {}
    cmd = config.get('Cmd') or []
    if '--port' in cmd:
        return int(cmd[cmd.index('--port') + 1])
    for entry in config.get('Env') or []:
        if entry.startswith('PREDICTION_CONSOLE_V2_PORT='):
            return int(entry.split('=', 1)[1])
    raise UnsafeRelease('cannot verify container listening port')


def container_identity(payload: dict[str, Any]) -> dict[str, Any]:
    state = payload.get('State') or {}
    return {'id': payload.get('Id'), 'image': payload.get('Image'), 'started_at': state.get('StartedAt'), 'restart_count': payload.get('RestartCount'), 'running': state.get('Running') is True, 'status': state.get('Status')}


def atomic_write(path: Path, contents: bytes, mode: int) -> None:
    if path.is_symlink():
        raise UnsafeRelease('refuses symlink configuration')
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name('.' + path.name + '.swap-' + str(os.getpid()))
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temp, mode)
        os.replace(temp, path)
    finally:
        if temp.exists():
            temp.unlink()


def pointer_target(name: str) -> str | None:
    pointer = ROOTS[name] / 'current'
    if not pointer.is_symlink():
        if name == NAMES[1] and not pointer.exists():
            return None
        raise UnsafeRelease('service current must be a symlink')
    try:
        target = pointer.resolve(strict=True)
    except (FileNotFoundError, OSError, RuntimeError) as error:
        raise UnsafeRelease('service current is dangling or invalid') from error
    if not target.is_dir() or target.parent != (ROOTS[name] / 'releases').resolve():
        raise UnsafeRelease('service current points outside its release root')
    return str(target)


def atomic_pointer(name: str, target: str) -> None:
    path = ROOTS[name] / 'current'
    temp = path.with_name('.current-swap-' + str(os.getpid()))
    if temp.exists() or temp.is_symlink():
        raise UnsafeRelease('temporary pointer already exists')
    temp.symlink_to(target)
    os.replace(temp, path)


def restore_pointer(name: str, target: str | None, candidate: str) -> None:
    if target is not None:
        atomic_pointer(name, target)
        return
    if name != NAMES[1]:
        raise UnsafeRelease('legacy current cannot be removed')
    observed = pointer_target(name)
    if observed is None:
        return  # The attempted switch failed before creating its pointer.
    if observed != candidate:
        raise UnsafeRelease('CAS refused removal of an unknown release pointer')
    # pointer_target verified this is a real in-root symlink. Removing only
    # our candidate restores the exact older V2 deployment shape.
    (ROOTS[name] / 'current').unlink()


def patch_port(contents: bytes, name: str, port: int) -> bytes:
    key = 'PREDICTION_CONSOLE_V2_PORT' if name == NAMES[1] else 'PREDICTION_CONSOLE_PORT'
    text = contents.decode('utf-8')
    lines = [line for line in text.splitlines() if not re.match(r'^\s*(?:export\s+)?' + key + r'\s*=', line)]
    return ('\n'.join(lines).rstrip() + '\n' + key + '=' + str(port) + '\n').lstrip('\n').encode('utf-8')


class RemoteIO:
    def run(self, *args: str) -> str:
        # subprocess output may include sensitive env values: never emit it.
        return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=120).strip()

    def container(self, name: str) -> dict[str, Any] | None:
        try:
            return json.loads(self.run('docker', 'inspect', name))[0]
        except subprocess.CalledProcessError as error:
            if error.returncode == 1 and 'No such' in (error.stderr or ''):
                return None
            raise

    def image(self, ref: str) -> dict[str, Any]:
        return json.loads(self.run('docker', 'image', 'inspect', ref))[0]

    def unit_contract(self, name: str) -> None:
        path = self.run('systemctl', 'show', name + '.service', '-p', 'FragmentPath', '--value')
        dropins = self.run('systemctl', 'show', name + '.service', '-p', 'DropInPaths', '--value')
        if path != str(CONFIG[name][0]) or dropins:
            raise UnsafeRelease('unexpected unit source or drop-in overrides')

    def backend(self, expected: dict[str, Any]) -> None:
        path = Path('/proc') / str(expected['pid']) / 'exe'
        if os.readlink(path) != expected['binary_path'] or digest(path.read_bytes()) != expected['binary_sha256']:
            raise UnsafeRelease('protected backend identity changed')

    def stop(self, name: str) -> None:
        self.run('systemctl', 'stop', name + '.service')

    def start(self, name: str) -> None:
        self.run('systemctl', 'start', name + '.service')

    def reload(self) -> None:
        self.run('systemctl', 'daemon-reload')

    def tag(self, image: str, name: str) -> None:
        self.run('docker', 'tag', image, name + ':current')

    def page(self, host: str, port: int, path: str) -> None:
        authority = '[' + host + ']' if ':' in host else host
        request = Request('http://' + authority + ':' + str(port) + path, headers={'Accept': 'text/html'})
        with urlopen(request, timeout=12) as response:
            if response.status != 200 or 'text/html' not in response.headers.get('Content-Type', ''):
                raise UnsafeRelease('frontend page did not return HTML200')
            response.read(1024)


@contextmanager
def dual_locks():
    with ExitStack() as stack:
        for name in sorted(NAMES):
            path = ROOTS[name] / '.deploy.lock'
            path.parent.mkdir(parents=True, exist_ok=True)
            handle = stack.enter_context(path.open('a+'))
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise UnsafeRelease('a frontend deployment lock is held') from error
        yield


def observe(io: RemoteIO, m: dict[str, Any], *, allow_missing: bool = False) -> dict[str, Any]:
    io.backend(m['backend_identity'])
    output = {}
    for name in NAMES:
        io.unit_contract(name)
        payload = io.container(name)
        if payload is None and not allow_missing:
            raise UnsafeRelease('baseline container is absent')
        output[name] = {'container': container_identity(payload) if payload else None,
                        'port': container_port(payload) if payload else None,
                        'tag_image': io.image(name + ':current')['Id'],
                        'pointer_target': pointer_target(name),
                        'unit_sha256': sha_file(CONFIG[name][0]),
                        'service_env_sha256': sha_file(CONFIG[name][1])}
    return output


def preflight(io: RemoteIO, m: dict[str, Any]) -> dict[str, Any]:
    validate_metadata(m)
    current = observe(io, m)
    for name in NAMES:
        b, c = m['baseline'][name], current[name]
        for key in ('container', 'port', 'pointer_target', 'unit_sha256', 'service_env_sha256'):
            if b[key] != c[key]:
                raise UnsafeRelease('baseline changed: ' + name + '.' + key)
        if c['tag_image'] != b['container']['image']:
            raise UnsafeRelease('baseline image tag changed')
        template = SOURCE_UNITS / (name + '.service')
        if sha_file(template) != b['unit_template_sha256']:
            raise UnsafeRelease('candidate unit source hash mismatch')
        validate_unit_template(template.read_text(), name)
    candidate = io.image(m['image_sha256'])
    labels = (candidate.get('Config') or {}).get('Labels') or {}
    if candidate['Id'] != m['image_sha256'] or labels.get('org.opencontainers.image.revision') != m['merge_sha'] or labels.get('org.opencontainers.image.source-branch') != 'main' or labels.get('org.opencontainers.image.source-archive-sha256') != m['source_archive_sha256']:
        raise UnsafeRelease('candidate image attestation failed')
    release = Path(m['release'])
    if not release.is_dir() or (release / 'PREVIEW_VERIFIED').is_symlink() or (release / 'PREVIEW_VERIFIED').read_text().strip() != m['merge_sha']:
        raise UnsafeRelease('exact candidate preview is not verified')
    for marker in ('UI_VERIFIED', 'UI_REJECTED'):
        if (release / marker).exists() or (release / marker).is_symlink():
            raise UnsafeRelease('candidate UI marker already exists')
    return current


def assert_candidate(io: RemoteIO, m: dict[str, Any], instances: dict[str, Any], written: dict[str, tuple[bytes, bytes]]) -> None:
    assert_owned(io, m, instances, written)
    current = observe(io, m)
    for name in NAMES:
        image = m['image_sha256'] if name == NAMES[1] else m['baseline'][name]['container']['image']
        pointer = m['release'] if name == NAMES[1] else m['baseline'][name]['pointer_target']
        if current[name]['tag_image'] != image or current[name]['container']['image'] != image or current[name]['pointer_target'] != pointer or current[name]['port'] != PORTS[name]:
            raise UnsafeRelease('candidate image/pointer/port changed')
        # When already swapped, a later V2-only release must leave the protected
        # legacy config and container untouched.
        unchanged = name == NAMES[0] and m['baseline'][name]['port'] == PORTS[name]
        for index, field in enumerate(('unit_sha256', 'service_env_sha256')):
            expected = m['baseline'][name][field] if unchanged else digest(written[name][index])
            if current[name][field] != expected:
                raise UnsafeRelease('candidate configuration changed')
        if not current[name]['container']['running'] or current[name]['container']['status'] != 'running':
            raise UnsafeRelease('candidate is not running')


def prepare(io: RemoteIO, m: dict[str, Any]) -> tuple[Path, dict[str, dict[str, bytes | None]]]:
    backup = ROOTS[NAMES[1]] / 'port-swaps' / m['operation_id']
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    os.chmod(backup, 0o700)
    saved = {}
    for name in NAMES:
        saved[name] = {}
        for label, path in zip(('unit', 'service_env'), CONFIG[name]):
            if path.is_symlink():
                raise UnsafeRelease('configuration is symlinked')
            contents = path.read_bytes() if path.exists() else None
            saved[name][label] = contents
            if contents is not None:
                atomic_write(backup / (name + '.' + label), contents, 0o600)
        atomic_write(backup / (name + '.identity.json'), json.dumps(m['baseline'][name]).encode(), 0o600)
    atomic_write(backup / 'metadata.json', json.dumps(m, indent=2).encode(), 0o600)
    return backup, saved


def desired_configs(saved: dict[str, Any]) -> dict[str, tuple[bytes, bytes]]:
    return {name: ((SOURCE_UNITS / (name + '.service')).read_bytes(), patch_port(saved[name]['service_env'] or b'', name, PORTS[name])) for name in NAMES}


def assert_owned(io: RemoteIO, m: dict[str, Any], instances: dict[str, Any], written: dict[str, tuple[bytes, bytes]], *, restoring: bool = False) -> None:
    current = observe(io, m, allow_missing=True)
    for name in NAMES:
        b, c = m['baseline'][name], current[name]
        allowed_image = {b['container']['image']}
        if name == NAMES[1]:
            allowed_image.add(m['image_sha256'])
        if c['tag_image'] not in allowed_image:
            raise UnsafeRelease('CAS refused unknown frontend image tag')
        pointers = {b['pointer_target']}
        if name == NAMES[1]:
            pointers.add(m['release'])
        if c['pointer_target'] not in pointers:
            raise UnsafeRelease('CAS refused unknown release pointer')
        expected = instances.get(name)
        if c['container'] is not None:
            identity = c['container']
            if expected is None or any(identity.get(key) != expected.get(key) for key in ('id', 'image', 'started_at', 'restart_count')):
                raise UnsafeRelease('CAS refused unknown frontend container instance')
        for index, field in enumerate(('unit_sha256', 'service_env_sha256')):
            allowed_hash = {b[field], digest(written[name][index])}
            if c[field] not in allowed_hash:
                raise UnsafeRelease('CAS refused changed frontend configuration')


def wait_container(io: RemoteIO, m: dict[str, Any], name: str, image: str, port: int, instances: dict[str, Any], *, previous_id: str | None = None) -> dict[str, Any]:
    deadline = time.monotonic() + m.get('startup_timeout_seconds', 90)
    observed_id = None
    while time.monotonic() < deadline:
        io.backend(m['backend_identity'])
        payload = io.container(name)
        if payload:
            current = container_identity(payload)
            if current['id'] == previous_id:
                time.sleep(1)
                continue
            if current['image'] != image or container_port(payload) != port or current['restart_count'] != 0:
                raise UnsafeRelease('unexpected frontend instance during startup')
            if observed_id is not None and observed_id != current['id']:
                raise UnsafeRelease('frontend instance replaced during startup')
            observed_id = current['id']
            instances[name] = current
            if current['running'] and current['status'] == 'running':
                return current
        time.sleep(1)
    raise TimeoutError('frontend container startup timed out')


def start_owned(io: RemoteIO, m: dict[str, Any], name: str, image: str, port: int, instances: dict[str, Any]) -> None:
    previous = instances.get(name, {}).get('id')
    try:
        io.start(name)
    except Exception:
        # A failed systemctl start may already have created a container. Record
        # only its checked immutable identity before a possible rollback.
        payload = io.container(name)
        if payload and container_identity(payload)['id'] != previous and container_identity(payload)['image'] == image and container_port(payload) == port:
            instances[name] = container_identity(payload)
        raise
    wait_container(io, m, name, image, port, instances, previous_id=previous)


def verify_pages(io: RemoteIO, m: dict[str, Any], ports: dict[str, int]) -> None:
    for name in NAMES:
        deadline = time.monotonic() + m.get('startup_timeout_seconds', 90)
        last_error = None
        while time.monotonic() < deadline:
            try:
                io.page(m['host'], ports[name], '/trading/orders' if name == NAMES[1] else '/live')
                break
            except Exception as error:
                last_error = type(error).__name__
                time.sleep(1)
        else:
            raise TimeoutError('frontend HTTP startup failed: ' + str(last_error))


def restore(io: RemoteIO, m: dict[str, Any], saved: dict[str, Any], written: dict[str, tuple[bytes, bytes]], instances: dict[str, Any], changed: list[str]) -> None:
    assert_owned(io, m, instances, written)
    # Stop both changed roles before restoring any old port, or the restored
    # listener could collide with the other candidate listener.
    for name in reversed(changed):
        io.stop(name)
    for name in changed:
        for label, path in zip(('unit', 'service_env'), CONFIG[name]):
            contents = saved[name][label]
            if contents is None:
                path.unlink(missing_ok=True)
            else:
                atomic_write(path, contents, 0o644 if label == 'unit' else 0o600)
        io.tag(m['baseline'][name]['container']['image'], name)
        restore_pointer(name, m['baseline'][name]['pointer_target'], m['release'])
    io.reload()
    for name in changed:
        b = m['baseline'][name]
        start_owned(io, m, name, b['container']['image'], b['port'], instances)
    verify_pages(io, m, {name: m['baseline'][name]['port'] for name in NAMES})
    observed = observe(io, m)
    for name in NAMES:
        b, c = m['baseline'][name], observed[name]
        for field in ('unit_sha256', 'service_env_sha256', 'pointer_target', 'port'):
            if b[field] != c[field]:
                raise UnsafeRelease('paired rollback verification failed')
        if c['tag_image'] != b['container']['image'] or c['container']['image'] != b['container']['image']:
            raise UnsafeRelease('paired rollback image verification failed')
    emit('console_pair_rollback_verified')


def deploy(io: RemoteIO, m: dict[str, Any]) -> None:
    with dual_locks():
        baseline = preflight(io, m)
        backup, saved = prepare(io, m)
        written = desired_configs(saved)
        instances = {name: baseline[name]['container'] for name in NAMES}
        swapping = any(m['baseline'][name]['port'] != PORTS[name] for name in NAMES)
        changed = list(NAMES) if swapping else [NAMES[1]]
        mutation_started = False
        try:
            # Re-read after backups and immediately before the first mutation.
            preflight(io, m)
            mutation_started = True
            for name in reversed(changed):
                io.stop(name)
            for name in changed:
                atomic_write(CONFIG[name][0], written[name][0], 0o644)
                atomic_write(CONFIG[name][1], written[name][1], 0o600)
            io.tag(m['image_sha256'], NAMES[1])
            atomic_pointer(NAMES[1], m['release'])
            io.reload()
            for name in changed:
                image = m['image_sha256'] if name == NAMES[1] else m['baseline'][name]['container']['image']
                start_owned(io, m, name, image, PORTS[name], instances)
            assert_candidate(io, m, instances, written)
            verify_pages(io, m, PORTS)
            emit('console_pair_waiting_ui', release=m['release'], ports=PORTS)
            deadline = time.monotonic() + m.get('ui_timeout_seconds', 900)
            release = Path(m['release'])
            while time.monotonic() < deadline:
                assert_candidate(io, m, instances, written)
                reject, verify = release / 'UI_REJECTED', release / 'UI_VERIFIED'
                if reject.exists() or reject.is_symlink() or verify.is_symlink():
                    raise UnsafeRelease('UI verification rejected')
                if verify.is_file() and verify.read_text().strip() == m['merge_sha']:
                    # Release identity and config must still match after marker.
                    assert_candidate(io, m, instances, written)
                    current = observe(io, m)
                    for name in NAMES:
                        if current[name]['port'] != PORTS[name] or current[name]['container']['running'] is not True or current[name]['container']['status'] != 'running':
                            raise UnsafeRelease('candidate stopped before final verification')
                    atomic_write(backup / 'VERIFIED', (m['merge_sha'] + '\n').encode(), 0o600)
                    emit('console_pair_verified', merge_sha=m['merge_sha'], ports=PORTS)
                    return
                time.sleep(2)
            raise TimeoutError('UI verification timed out')
        except BaseException:
            if mutation_started:
                emit('console_pair_rollback_started')
                restore(io, m, saved, written, instances, changed)
            raise


def capture_metadata(io: RemoteIO, *, operation_id: str, host: str, release: str, merge_sha: str,
                     source_archive_sha256: str, image_sha256: str, backend_identity: dict[str, Any]) -> dict[str, Any]:
    """Read-only baseline collection. Returned object has hashes, never env values."""
    metadata = {'operation_id': operation_id, 'host': host, 'release': release, 'merge_sha': merge_sha,
                'source_branch': 'main', 'source_archive_sha256': source_archive_sha256,
                'image_sha256': image_sha256, 'backend_identity': backend_identity, 'baseline': {}}
    current = observe(io, metadata)
    for name in NAMES:
        facts = current[name]
        metadata['baseline'][name] = {key: facts[key] for key in ('container', 'port', 'pointer_target', 'unit_sha256', 'service_env_sha256')}
        metadata['baseline'][name]['unit_template_sha256'] = sha_file(SOURCE_UNITS / (name + '.service'))
    validate_metadata(metadata)
    return metadata


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--metadata-json', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preflight', action='store_true')
    mode.add_argument('--deploy', action='store_true')
    args = parser.parse_args()
    def interrupted(signum, _frame):
        raise InterruptedError('release interrupted by signal ' + str(signum))
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        if os.geteuid() != 0:
            raise UnsafeRelease('remote release must run as root')
        metadata = json.loads(Path(args.metadata_json).read_text())
        validate_metadata(metadata)
        io = RemoteIO()
        if args.preflight:
            with dual_locks():
                preflight(io, metadata)
            emit('console_pair_preflight_verified')
        else:
            deploy(io, metadata)
        return 0
    except BaseException as error:
        emit('console_pair_failed', error_type=type(error).__name__)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
