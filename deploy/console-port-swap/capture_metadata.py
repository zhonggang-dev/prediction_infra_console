#!/usr/bin/env python3
"""Capture a non-sensitive baseline without changing services or configuration."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess

from remote_swap import RemoteIO, atomic_write, capture_metadata


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for key in ('operation-id', 'host', 'release', 'merge-sha', 'source-archive-sha256', 'image-sha256', 'output'):
        parser.add_argument('--' + key, required=True)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.error('baseline capture must run as root')
    backend_pid = int(subprocess.check_output(['systemctl', 'show', 'trading-execution.service', '-p', 'MainPID', '--value'], text=True).strip())
    executable = Path('/proc') / str(backend_pid) / 'exe'
    backend = {'pid': backend_pid, 'binary_path': os.readlink(executable), 'binary_sha256': hashlib.sha256(executable.read_bytes()).hexdigest()}
    metadata = capture_metadata(RemoteIO(), operation_id=args.operation_id, host=args.host, release=args.release,
        merge_sha=args.merge_sha, source_archive_sha256=args.source_archive_sha256, image_sha256=args.image_sha256, backend_identity=backend)
    atomic_write(Path(args.output), (json.dumps(metadata, indent=2) + '\n').encode(), 0o600)
    print(json.dumps({'phase': 'console_pair_baseline_captured', 'output': args.output}))


if __name__ == '__main__':
    main()
