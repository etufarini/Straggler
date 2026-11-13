#!/usr/bin/env python3
"""Checksums, tool versions and source fingerprints for desktop preparation."""
import hashlib
import os
from pathlib import Path
import sys


def fingerprint(root):
    root = Path(root)
    # The build recipe affects the binary; unrelated launcher changes do not.
    files = [root / 'lib/bootstrap.sh']
    desktop = root / 'desktop'
    files.append(desktop / 'packaging/llama-runtime.json')
    files += [desktop / name for name in ('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts')]
    files += [desktop / 'src-tauri' / name for name in ('Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json', 'tauri.macos.conf.json')]
    for directory in ('src', 'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities'):
        files += [p for p in (desktop / directory).rglob('*') if p.is_file()]
    digest = hashlib.sha256()
    for file in sorted(set(files)):
        digest.update(str(file.relative_to(root)).encode() + b'\0')
        digest.update(file.read_bytes())
    digest.update(os.uname().sysname.encode() + b'\0' + os.uname().machine.encode())
    return digest.hexdigest()


try:
    operation, *arguments = sys.argv[1:]
    if operation == 'checksum':
        digest = hashlib.sha256(Path(arguments[0]).read_bytes()).hexdigest()
        sys.exit(0 if digest == arguments[1] else 1)
    elif operation == 'version':
        import re
        version = re.fullmatch(r'(\d+)\.(\d+)\.(\d+)(?:[-+].*)?', arguments[0])
        sys.exit(0 if version and tuple(map(int, version.groups())) >= tuple(map(int, arguments[1].split('.'))) else 1)
    elif operation == 'fingerprint':
        print(fingerprint(arguments[0]))
    else:
        sys.exit('Unknown preparation operation: ' + operation)
except (ValueError, OSError, IndexError) as error:
    sys.exit(str(error) or 'Invalid preparation data.')
