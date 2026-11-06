#!/usr/bin/env bash
# Metadata-only GGUF fixtures and model discovery; no tensors or inference.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import shutil
import struct
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='mir-models-') as temporary:
    work = Path(temporary)
    models = work / 'models with spaces'
    models.mkdir()
    commands = work / 'bin'
    commands.mkdir()
    for tool in ('mv', 'find'):
        (commands / tool).symlink_to(shutil.which('g' + tool) or shutil.which(tool))
    env = {k:v for k,v in os.environ.items() if not k.startswith(('LLAMA_', 'MIR_', 'XDG_'))}
    env.update(HOME=str(work), LC_ALL='C', XDG_CONFIG_HOME=str(work / 'config'),
               XDG_DATA_HOME=str(work / 'data'), PATH=str(commands) + ':' + env['PATH'],
               MIR_MODELS_DIR=str(models))

    def string(value, endian='<'):
        encoded = value.encode()
        return struct.pack(endian + 'Q', len(encoded)) + encoded

    def gguf(name, fields, endian='<', version=3):
        data = b'GGUF' + struct.pack(endian + 'IQQ', version, 0, len(fields))
        for key, kind, value in fields:
            data += string(key, endian) + struct.pack(endian + 'I', kind)
            if kind == 8:
                data += string(value, endian)
            elif kind == 9:
                data += struct.pack(endian + 'IQ', 8, len(value))
                data += b''.join(string(item, endian) for item in value)
            else:
                data += struct.pack(endian + {2:'H', 4:'I'}[kind], value)
        (models / name).write_bytes(data)

    gguf('selected.gguf', [('general.type', 8, 'model')])
    gguf('unrelated-name.gguf', [('general.type', 8, 'mmproj')])
    gguf('adapter.gguf', [('general.type', 8, 'adapter')])
    gguf('first.gguf', [('split.no', 2, 0), ('general.type', 8, 'model')], version=2)
    gguf('second.gguf', [('split.no', 2, 1)])
    gguf('big-endian.gguf', [('split.no', 2, 1)], endian='>')
    gguf('future.gguf', [], version=99)
    gguf('tokens.gguf', [('tokenizer.ggml.tokens', 9, ['a','b']), ('general.type', 8, 'model')])
    (models / 'truncated.gguf').write_bytes(b'GGUF\x03')
    (models / 'oversized.gguf').write_bytes(b'GGUF' + struct.pack('<IQQQ', 3, 0, 1, 2**63))
    # Bounds must fail open for discovery, without allocating enormous metadata.
    scalar = string('ignored') + struct.pack('<IB', 0, 1)
    (models / 'too-many-fields.gguf').write_bytes(
        b'GGUF' + struct.pack('<IQQ', 3, 0, 100001) + scalar * 100001)
    (models / 'too-many-strings.gguf').write_bytes(
        b'GGUF' + struct.pack('<IQQ', 3, 0, 1) + string('tokens') + struct.pack('<IIQ', 9, 8, 100001)
        + string('') * 100001)
    # A sparse file crosses the byte budget without allocating a large payload.
    with (models / 'metadata-budget.gguf').open('wb') as stream:
        stream.write(b'GGUF' + struct.pack('<IQQ', 3, 0, 1) + string('ignored')
                     + struct.pack('<IQ', 8, 33 * 1024 * 1024))
        stream.seek(33 * 1024 * 1024, 1)
        stream.write(b'\0')
    (models / 'unknown-type.gguf').write_bytes(
        b'GGUF' + struct.pack('<IQQ', 3, 0, 1) + string('future') + struct.pack('<I', 99))
    outside = work / 'outside.gguf'
    shutil.copyfile(models / 'selected.gguf', outside)
    (models / 'linked.gguf').symlink_to(outside)
    (models / 'broken.gguf').symlink_to(work / 'missing.gguf')
    (models / 'directory-link').symlink_to(work, target_is_directory=True)
    (models / '._resource.gguf').touch()
    nested = models / 'nested'
    nested.mkdir()
    (nested / 'UPPER.GGUF').touch()
    (nested / 'line\nbreak.gguf').touch()
    (work / 'root-link').symlink_to(models, target_is_directory=True)

    # Assert the reader's classifications independently of discovery filtering.
    roles = {'selected.gguf':'model', 'first.gguf':'model', 'tokens.gguf':'model',
             'unrelated-name.gguf':'component', 'adapter.gguf':'component',
             'second.gguf':'continuation', 'big-endian.gguf':'continuation'}
    for name in ('future', 'truncated', 'oversized', 'too-many-fields', 'too-many-strings', 'metadata-budget', 'unknown-type'):
        roles[name + '.gguf'] = 'unknown'
    result = subprocess.run([sys.executable, '-I', str(root / 'lib/gguf.py')],
                            input=b''.join(os.fsencode(models / name) + b'\0' for name in roles),
                            capture_output=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert result.stdout.split(b'\0')[:-1] == [value.encode() for value in roles.values()]

    sources = 'MIR_ROOT=$1; source "$MIR_ROOT/tests/helpers/core.sh"; load_test_core fake\n'
    selected = models / 'selected.gguf'
    def scan(prefix='', directory=models):
        code = sources + '''initialize_config "$2"
''' + prefix + r'''
scan_models
[[ $MODEL == "$2" ]]
printf '%s\0' "${MODELS[@]}"
'''
        result = subprocess.run(['bash', '-euo', 'pipefail', '-c', code, 'test', str(root), str(directory / selected.name)],
                                env=env | {'MIR_MODELS_DIR':str(directory)}, cwd=work,
                                capture_output=True, timeout=5)
        assert result.returncode == 0, result.stderr
        return [Path(os.fsdecode(path)).relative_to(directory).as_posix()
                for path in result.stdout.split(b'\0') if path]
    expected = {name for name, role in roles.items() if role in ('model', 'unknown')}
    expected |= {'linked.gguf', 'nested/UPPER.GGUF', 'nested/line\nbreak.gguf'}
    discovered = scan()
    assert set(discovered) == expected, discovered
    assert discovered == sorted(discovered, key=os.fsencode)
    assert scan(directory=work / 'root-link') == discovered
    fallback = scan('command() { if [[ ${*: -1} == python3 ]]; then return 1; else builtin command "$@"; fi; }')
    assert set(fallback) == expected | {name for name, role in roles.items() if role in ('component', 'continuation')}
    print('PASS: GGUF v2/v3, endianness, component/shard roles, malformed metadata and bounded fallback')
    print('PASS: recursive discovery, stable ordering, literal filenames, symlinks and optional-reader fallback')
PY
