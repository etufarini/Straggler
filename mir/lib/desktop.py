#!/usr/bin/env python3
"""Checksums, tool versions and source fingerprints for desktop preparation."""
import hashlib
import os
from pathlib import Path
import sys


def source_files(root, platform):
    if platform not in ('linux', 'macos'):
        raise ValueError('Unsupported desktop platform: ' + platform)
    desktop = Path(root) / 'desktop'
    names = []
    for manifest in ('runtime-files.txt', f'runtime-files.{platform}.txt'):
        names.extend((desktop / manifest).read_text().splitlines())
    return names


def fingerprint(root, platform):
    root = Path(root)
    # The build recipe affects the binary; unrelated launcher changes do not.
    files = [root / 'lib/bootstrap.sh', root / 'lib/desktop.py',
             root / f'lib/platform/{platform}.sh']
    files += [root / name for name in source_files(root, platform)
              if name != 'desktop/README.md']
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
        print(fingerprint(arguments[0], arguments[1]))
    elif operation == 'sources':
        print('\n'.join(source_files(arguments[0], arguments[1])))
    else:
        sys.exit('Unknown preparation operation: ' + operation)
except (ValueError, OSError, IndexError) as error:
    sys.exit(str(error) or 'Invalid preparation data.')
