#!/usr/bin/env python3
"""Data-only encoding for the desktop bridge and source preparation."""
import hashlib
import json
import os
from pathlib import Path
import sys

FIELDS = (
    'model context port device threads gpu_layers prompt_processing cache_type_k cache_type_v '
    'split_mode tensor_split fit_target temperature top_p top_k min_p repeat_penalty '
    'presence_penalty frequency_penalty seed max_tokens'
).split()


def literal(value):
    if not isinstance(value, str) or '\0' in value or '\n' in value or '\r' in value:
        raise ValueError('Settings must be single-line text values.')
    return value


def decode():
    text = sys.stdin.read()
    request = json.loads(text) if text.strip() else {}
    if not isinstance(request, dict) or request.keys() - {'settings', 'llamaDir', 'modelsDir', 'targets'}:
        raise ValueError('Invalid desktop request.')
    lines = []
    if 'settings' in request:
        settings = request['settings']
        if not isinstance(settings, dict) or set(settings) != set(FIELDS):
            raise ValueError('A complete configuration needs every supported field.')
        lines.extend(f'{key}={literal(settings[key])}' for key in FIELDS)
    for key in ('llamaDir', 'modelsDir'):
        if key in request:
            lines.append(f'@{key}={literal(request[key])}')
    for target in request.get('targets', []):
        pid, identity = target['pid'], literal(target['identity'])
        if not isinstance(pid, int) or pid <= 1 or not identity:
            raise ValueError('Invalid listener identity.')
        lines.append(f'@target={pid}\t{identity}')
    print('\n'.join(lines), end='\n' if lines else '')


def snapshot(args):
    values = iter(args)
    llama, models, available, status, warning, preset = [next(values) for _ in range(6)]
    settings = dict(line.split('=', 1) for line in next(values).splitlines())
    if set(settings) != set(FIELDS):
        raise ValueError('Launcher configuration fields do not match the desktop contract.')
    files = [next(values) for _ in range(int(next(values)))]
    devices = [dict(name=next(values), label=next(values)) for _ in range(int(next(values)))]
    listeners = [dict(pid=int(next(values)), identity=next(values), details=next(values))
                 for _ in range(int(next(values)))]
    ram = next(values)
    free = [dict(name=next(values), availableMiB=int(next(values))) for _ in range(int(next(values)))]
    backends = [dict(id=next(values), label=next(values)) for _ in range(int(next(values)))]
    tag, backend, commit, previous = [next(values) for _ in range(4)]
    presets = dict(zip(('default', 'focused', 'exploratory', 'min-p'), [next(values).split() for _ in range(4)]))
    capabilities = json.loads(next(values))
    profiles = list(values)
    return dict(llamaDir=llama, modelsDir=models, serverAvailable=available == 'true',
                port=int(settings['port']), portStatus=status, warning=warning,
                settings=settings, generationPreset=preset,
                models=[dict(path=p, label=os.path.relpath(p, models)) for p in files],
                devices=devices, listeners=listeners,
                backends=backends, capabilities=capabilities,
                memory=dict(availableRamMiB=int(ram) if ram else None, devices=free), presets=presets,
                build=dict(tag=tag, backend=backend, commit=commit, previous=previous) if tag else None,
                profiles=profiles)


def browse(args):
    location = Path(args[0] or Path.home()).expanduser().resolve(strict=True)
    if not location.is_dir() or not os.access(location, os.R_OK | os.X_OK):
        raise ValueError('Choose a readable directory.')
    hidden = args[1] == 'true'
    directories = sorted((p for p in location.iterdir() if p.is_dir() and (hidden or not p.name.startswith('.'))),
                         key=lambda p: p.name.casefold())
    return dict(path=str(location), parent=str(location.parent),
                directories=[dict(name=p.name, path=str(p)) for p in directories])


def fingerprint(root):
    root = Path(root)
    files = [root / 'mir.sh']
    files += list((root / 'lib').rglob('*.sh')) + list((root / 'lib').rglob('*.py'))
    files += list((root / 'sh').glob('*.sh'))
    desktop = root / 'desktop'
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
    elif operation == 'capabilities':
        print(json.dumps(dict(cacheTypesK=arguments[0].splitlines(),
                              cacheTypesV=arguments[1].splitlines(),
                              splitModes=arguments[2].splitlines(),
                              multipleDevices=arguments[3] == 'true', buildNote=arguments[4])))
    elif operation == 'decode':
        decode()
    elif operation == 'fingerprint':
        print(fingerprint(arguments[0]))
    else:
        if operation == 'snapshot':
            result = snapshot(arguments)
        elif operation == 'log':
            from collections import deque
            with open(arguments[0], errors='replace') as source:
                result = dict(logs=[line.rstrip('\n') for line in deque(source, maxlen=300)])
        else:
            result = browse(arguments)
        print(json.dumps(result))
except (ValueError, OSError, KeyError, StopIteration, TypeError) as error:
    sys.exit(str(error) or 'Invalid desktop data.')
