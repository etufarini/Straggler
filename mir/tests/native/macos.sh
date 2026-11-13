#!/usr/bin/env bash
# Bootstrap coverage includes real macOS Bash 3.2 and a system-only PATH.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
import fcntl
import pty
import re
import select
import signal
import struct
import termios
import time
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile

root = Path(sys.argv[1]).resolve()
if sys.platform != 'darwin':
    print('SKIP: native Bash 3.2 and system-only macOS PATH require macOS')
    sys.exit(0)
modern = shutil.which('bash')
assert subprocess.run([modern, '-c', '(( BASH_VERSINFO[0] >= 4 ))']).returncode == 0
system_path = '/usr/bin:/bin:/usr/sbin:/sbin'
base = {k:v for k,v in os.environ.items() if not k.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
with tempfile.TemporaryDirectory(prefix='mir-bootstrap-') as temporary:
    work = Path(temporary).resolve()
    commands = work / 'commands'
    commands.mkdir()
    prefix = work / 'custom brew with spaces'
    (prefix / 'bin').mkdir(parents=True)
    def executable(path, text):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        path.chmod(0o755)
    executable(commands / 'brew', '#!/bin/sh\nprintf "%s\\n" "$TEST_PREFIX"\n')
    executable(commands / 'netstat', '#!/bin/sh\nexit 0\n')
    executable(commands / 'lsof', '#!/bin/sh\nexit 1\n')
    for tool in ('gfind', 'gmv'):
        (prefix / 'bin' / tool).symlink_to(shutil.which(tool))
    (prefix / 'bin/bash').symlink_to(modern)
    # Literal punctuation in filenames/arguments must survive interpreter changes.
    model = work / 'model $(literal); with spaces.gguf'
    model.touch()
    server_dir = work / 'llama package'
    executable(server_dir / 'bin/llama-server', '''#!/bin/sh
if [ "$1" = --help ]; then echo '--model --port --cache-type-k --cache-type-v'; exit 0; fi
printf '%s\\0' "$@" > "$TEST_ARGS"
exit 7
''')
    env = base | {'PATH':str(commands) + ':' + system_path, 'TEST_PREFIX':str(prefix),
                  'HOME':str(work / 'home'), 'XDG_CONFIG_HOME':str(work / 'config'),
                  'MIR_LLAMA_CPP_DIR':str(server_dir), 'TEST_ARGS':str(work / 'args')}
    result = subprocess.run(['/bin/bash', str(root / 'mir.sh'), str(model), '--alias', 'literal $(data); words'],
                            env=env, cwd='/', capture_output=True, text=True, timeout=15)
    assert result.returncode == 7, result.stderr
    args = (work / 'args').read_bytes().split(b'\0')[:-1]
    assert args == [b'--model', str(model).encode(), b'--cache-type-k', b'q4_0',
                    b'--cache-type-v', b'q4_0', b'--port', b'9931', b'--alias', b'literal $(data); words']
    print('PASS: Bash 3.2 source launch, custom Homebrew prefix, literal arguments and server exit status')

    (prefix / 'bin/bash').unlink()
    result = subprocess.run(['/bin/bash', str(root / 'mir.sh'), str(model)], env=env,
                            capture_output=True, text=True, timeout=15)
    assert result.returncode != 0 and 'brew install bash' in result.stderr, result.stderr
    assert 'bad substitution' not in result.stderr and 'invalid option' not in result.stderr
    print('PASS: missing compatible Bash fails before modern modules with actionable instructions')

    # Reject bad installer arguments before creating any installation directory.
    rejected_home = work / 'rejected'
    result = subprocess.run(['/bin/bash', '-s', '--', 'unsupported'],
                            input=(root / 'sh/install.sh').read_bytes(), env=env | {'HOME':str(rejected_home)},
                            capture_output=True, timeout=10)
    assert result.returncode != 0 and not rejected_home.exists()
    assert b'takes no arguments' in result.stderr
    print('PASS: unsupported installer arguments cannot trigger installation')
    snapshot_code = '''MIR_ROOT=$1
source "$MIR_ROOT/tests/helpers/core.sh"
load_test_core macos
platform_memory_snapshot
[[ "$RAM_AVAILABLE" =~ ^[0-9]+$ ]]
(( RAM_AVAILABLE <= $(sysctl -n hw.memsize) / 1048576 ))
[[ $(platform_memory_style) == system ]]
'''
    result = subprocess.run([modern, '-euo', 'pipefail', '-c', snapshot_code, 'test', str(root)],
                            capture_output=True, text=True, timeout=10)
    assert result.returncode == 0, result.stderr
    print('PASS: native macOS available-RAM snapshot and page-size conversion')
PY
"$BASH" "$TEST_ROOT/tests/native/ports.sh" macos
