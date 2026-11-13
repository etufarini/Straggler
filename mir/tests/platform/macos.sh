#!/usr/bin/env bash
# Darwin fixtures run on either host; native socket checks run only on macOS.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1])
native_path = os.environ['PATH']
sources = 'MIR_ROOT=$1; source "$MIR_ROOT/tests/helpers/core.sh"; load_test_core macos\n'
with tempfile.TemporaryDirectory(prefix='mir-macos-') as temporary:
    work = Path(temporary)
    commands = work / 'bin'
    commands.mkdir()
    def executable(path, text):
        path.write_text(text)
        path.chmod(0o755)
    executable(commands / 'uname', '#!/bin/sh\nprintf "Darwin\\n"\n')
    for tool in ('mv',):
        (commands / ('g' + tool)).symlink_to(shutil.which('g' + tool) or shutil.which(tool))
    executable(commands / 'netstat', '#!/bin/sh\nprintf "%s\\n" "$TEST_SOCKETS"\nexit "${TEST_NETSTAT_EXIT:-0}"\n')
    executable(commands / 'lsof', '#!/bin/sh\nprintf "%s\\n" "$TEST_PIDS"\nexit "${TEST_LSOF_EXIT:-0}"\n')
    executable(commands / 'open', '#!/bin/sh\nprintf "%s" "$1" > "$TEST_BROWSER"\n')
    executable(commands / 'curl', '#!/bin/sh\nexit 0\n')
    model = work / 'model.gguf'
    model.touch()
    package = work / 'package with spaces'
    (package / 'bin').mkdir(parents=True)
    executable(package / 'bin/llama-server', '''#!/usr/bin/env bash
case "$1" in
    --help)
        printf '%s\\n' '--model --port --device --gpu-layers --cache-type-k --cache-type-v' ;;
    --list-devices) printf probe >> "$TEST_DEVICE_PROBES"; /bin/sleep "${TEST_DEVICE_DELAY:-0}"; printf 'Available devices:\\n  MTL0: Test GPU (8192 MiB, 4096 MiB free)\\n' ;;
    *) printf '%s\\0' "$@" > "$TEST_ARGS"; /bin/sleep 0.2 ;;
esac
''')
    env = {k:v for k,v in os.environ.items() if not k.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    env.update(PATH=str(commands) + ':' + native_path, HOME=str(work), XDG_CONFIG_HOME=str(work / 'config'),
               MIR_LLAMA_CPP_DIR=str(package), TEST_SOCKETS='', TEST_PIDS='',
               TEST_BROWSER=str(work / 'browser'), TEST_ARGS=str(work / 'args'), TEST_DEVICE_PROBES=str(work / 'probes'))
    def check(code, overrides=None, success=True):
        result = subprocess.run(['bash', '-euo', 'pipefail', '-c', sources + code, 'test', str(root), str(model)],
                                env=env | (overrides or {}), capture_output=True, text=True, timeout=25)
        assert (result.returncode == 0) == success, (code, result.stdout, result.stderr)
        return result
    check('''initialize_config "$2"
validate_config
[[ "$SERVER" == "$MIR_LLAMA_CPP_DIR/bin/llama-server" ]]
DEVICE=none GPU_LAYERS=all
prepare_server
[[ " ${ARGS[*]} " == *' --gpu-layers 0 '* ]]
''')
    # Source builds retain precedence when both supported layouts exist.
    (package / 'build/bin').mkdir(parents=True)
    (package / 'build/bin/llama-server').symlink_to(package / 'bin/llama-server')
    check('initialize_config "$2"; [[ "$SERVER" == "$MIR_LLAMA_CPP_DIR/build/bin/llama-server" ]]')
    (package / 'build/bin/llama-server').unlink()
    check('''initialize_config "$2"
server_devices
[[ ${DEVICE_NAMES[*]} == MTL0 ]]
DEVICE=MTL0,MTL1 SPLIT_MODE=tensor TENSOR_SPLIT=2,1 FIT_TARGET=2048
build_model_args
[[ " ${MODEL_ARGS[*]} " == *' --split-mode tensor '* ]]
[[ $SPLIT_MODE == tensor && $TENSOR_SPLIT == 2,1 && $FIT_TARGET == 2048 ]]
''', {'TEST_DEVICE_DELAY':'0.1'})
    print('PASS: Darwin device discovery and preserved explicit GPU settings')

    busy = 'tcp4 0 0 127.0.0.1.9931 *.* LISTEN\ntcp6 0 0 ::1.9931 *.* LISTEN\n'
    check('PORT=9931; check_port; [[ -z "$LISTENERS" && ${#PIDS[@]} == 0 ]]',
          {'TEST_SOCKETS':'tcp4 0 0 127.0.0.1.9931 *.* ESTABLISHED\ntcp6 0 0 *.19931 *.* LISTEN'})
    check('''initialize_config "$2"
check_port
[[ "$PORT_STATUS" == *'IN USE'* && ${#PIDS[@]} == 0 ]]
if prepare_server; then exit 1; fi
[[ "$LAUNCH_ERROR" == *'IN USE'* ]]
''', {'TEST_SOCKETS':busy, 'TEST_LSOF_EXIT':'1'})
    check('PORT=9931; check_port; (( ${#PIDS[@]} == 1 )); [[ ${PIDS[0]} == 123 ]]',
          {'TEST_SOCKETS':busy, 'TEST_PIDS':'p123\nf10\np123'})
    check('PORT=9931; check_port', {'TEST_NETSTAT_EXIT':'1'}, success=False)
    print('PASS: Darwin IPv4/IPv6 listeners, exact ports, hidden owners, PID deduplication and fail-closed inspection')

    check('''initialize_config "$2"
prepare_server
run_server
''')
    assert (work / 'browser').read_text() == 'http://127.0.0.1:9931'
    assert b'--model\0' in (work / 'args').read_bytes()
    # Migration keeps the original and never merges with existing settings.
    legacy = work / 'migration/llama-launcher'
    legacy.mkdir(parents=True)
    (legacy / 'paths.conf').write_text('llama_dir=old\nmodels_dir=old\n')
    check('''CONFIG_DIR="$HOME/migration/mir.cpp"
migrate_config
[[ -f "$CONFIG_DIR/paths.conf" && -f "$HOME/migration/llama-launcher/paths.conf" ]]
printf unchanged > "$CONFIG_DIR/paths.conf"
migrate_config
[[ $(cat "$CONFIG_DIR/paths.conf") == unchanged ]]
''')
    print('PASS: macOS browser opening and atomic GNU-move migration without overwriting settings')

PY
