#!/usr/bin/env bash
# End-to-end startup, TUI navigation and owned-server lifecycle checks.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import json
import os
from pathlib import Path
import pty
import signal
import subprocess
import shutil
import sys
import tempfile
import time

root = Path(sys.argv[1])
launcher = root / 'mir.sh'

with tempfile.TemporaryDirectory(prefix='mir-regression-') as temporary:
    work = Path(temporary).resolve()
    bin_dir = work / 'bin'
    bin_dir.mkdir()
    # Exercise the Linux branch even on macOS; native Darwin checks are separate.
    (bin_dir / 'uname').write_text('#!/bin/sh\nprintf "Linux\\n"\n')
    (bin_dir / 'uname').chmod(0o755)
    for tool in ('mv', 'find'):
        gnu = shutil.which('g' + tool)
        if gnu:
            (bin_dir / tool).symlink_to(gnu)
    models = work / 'models with spaces'
    models.mkdir()
    model = models / 'example.gguf'
    model.touch()
    server_dir = work / 'llama with spaces'
    (server_dir / 'build/bin').mkdir(parents=True)
    def executable(path, text):
        path.write_text(text)
        path.chmod(0o755)
    executable(server_dir / 'build/bin/llama-server', '''#!/usr/bin/env bash
if [[ ${1:-} == --list-devices ]]; then
    printf 'Available devices:\\n  Vulkan0: Test GPU\\n  Vulkan1: Other GPU\\n'; exit 0
fi
if [[ ${1:-} == --help ]]; then
    echo '--model --port --host --ctx-size --device --threads --gpu-layers --batch-size --ubatch-size --temperature --top-p --top-k --min-p --repeat-penalty --presence-penalty --frequency-penalty --seed --n-predict --cache-type-k --cache-type-v'
    exit 0
fi
printf '%s\\0' "$@" > "$TEST_ARGS"
if [[ ${TEST_LIVE:-0} == 1 ]]; then
    echo "$$" > "$TEST_PID"
    trap 'echo stopped > "$TEST_STOP"; exit 0' TERM
    while true; do /bin/sleep 0.05; done
fi
exit "${TEST_EXIT:-0}"
''')
    executable(bin_dir / 'ss', '#!/usr/bin/env bash\nprintf "%s" "${TEST_LISTENERS:-}"\n')
    executable(bin_dir / 'curl', '#!/usr/bin/env bash\nexit "${TEST_HEALTH:-1}"\n')
    executable(bin_dir / 'xdg-open', '#!/usr/bin/env bash\nprintf "%s" "$1" > "$TEST_BROWSER"\n')
    executable(bin_dir / 'sleep', '#!/usr/bin/env bash\n/bin/sleep 0.01\n')
    executable(bin_dir / 'dialog', '''#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ['TEST_QUEUE'])
queue = json.loads(p.read_text())
with open(os.environ['TEST_DIALOG'], 'a') as log:
    log.write(json.dumps(sys.argv[1:]) + '\\n')
if not queue:
    sys.exit(255)
status, value = queue.pop(0)
p.write_text(json.dumps(queue))
sys.stdout.write(value)
sys.exit(status)
''')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('LLAMA_', 'MIR_', 'XDG_'))}
    (work / 'home').mkdir()
    env.update(HOME=str(work / 'home'), XDG_DATA_HOME=str(work / 'data'), PATH=str(bin_dir) + ':' + env['PATH'], XDG_CONFIG_HOME=str(work / 'config'),
               LLAMA_CPP_DIR=str(server_dir), LLAMA_MODELS_DIR=str(models),
               TEST_ARGS=str(work / 'args'), TEST_PID=str(work / 'pid'),
               TEST_STOP=str(work / 'stopped'), TEST_BROWSER=str(work / 'browser'),
               TEST_QUEUE=str(work / 'queue'), TEST_DIALOG=str(work / 'dialog.log'), TERM='xterm')
    def run(overrides=None, arguments=None, model_path=model):
        args_file = work / 'args'
        args_file.unlink(missing_ok=True)
        result = subprocess.run(['bash', str(launcher), str(model_path)] + (arguments or []),
                                env=env | (overrides or {}), cwd='/', capture_output=True, timeout=8)
        return result.returncode, result.stdout, result.stderr, args_file.read_bytes() if args_file.exists() else None
    cases = [({}, []), ({'LLAMA_DEVICE':'none', 'LLAMA_GPU_LAYERS':'all'}, []),
             ({'LLAMA_THREADS':'4', 'LLAMA_GPU_LAYERS':'12', 'LLAMA_DEVICE':'Vulkan0',
               'LLAMA_PROMPT_PROCESSING':'large-batch',
               'LLAMA_HOST':'0.0.0.0', 'LLAMA_PORT':'09931'}, ['--ctx-size','8192','--alias','a b']),
             ({'LLAMA_PROMPT_PROCESSING':'low-memory'}, []),
             ({'LLAMA_THREADS':'0'}, []), ({'LLAMA_GPU_LAYERS':'-1'}, []),
             ({'LLAMA_PORT':'65536'}, []), ({'LLAMA_CTX_SIZE':'bad'}, []),
             ({'LLAMA_PROMPT_PROCESSING':'bad'}, []),
             ({'TEST_LISTENERS':'LISTEN 0 128 0.0.0.0:9931 0.0.0.0:*\n'}, []),
             ({'TEST_EXIT':'7'}, [])]
    for index, (overrides, arguments) in enumerate(cases):
        result = run(overrides, arguments)
        code, _, error, args = result
        if index < 4:
            assert code == 0 and args, (index, result)
        elif index < 10:
            assert code == 1 and args is None and error, (index, result)
        else:
            assert code == 7, result
        if index == 0:
            assert b'--threads' not in args and b'--gpu-layers' not in args
            default_args = args.decode().split('\0')
        if index == 1:
            assert b'--gpu-layers\x000\x00' in args
        if index == 2:
            assert args.endswith(b'--ctx-size\x008192\x00--alias\x00a b\x00')
    print('PASS: direct startup, validation, port blocking, argument boundaries and exit status')

    disabled = work / 'disabled/bin'
    disabled.mkdir(parents=True)
    (disabled / 'llama-server').write_text('#!/bin/sh\nexit 99\n')
    for overrides, selected, diagnostic in [
        ({'MIR_LLAMA_CPP_DIR':str(work / 'missing')}, model, b'llama-server not found'),
        ({'MIR_LLAMA_CPP_DIR':str(disabled.parent)}, model, b'llama-server not found'),
        ({}, work / 'missing.gguf', b'GGUF model missing or unreadable'),
    ]:
        result = run(overrides, model_path=selected)
        assert result[0] == 1 and result[3] is None and diagnostic in result[2], result
    print('PASS: missing/non-executable server and missing model block startup before execution')

    precedence = run({'LLAMA_THREADS':'bad', 'MIR_THREADS':'3',
                         'LLAMA_PORT':'bad', 'MIR_PORT':'10001',
                         'LLAMA_DEVICE':'Vulkan0', 'MIR_DEVICE':'none',
                         'LLAMA_HOST':'127.0.0.2', 'MIR_HOST':'127.0.0.1',
                         'MIR_LLAMA_CPP_DIR':str(server_dir), 'LLAMA_CPP_DIR':'/missing'})
    assert precedence[0] == 0, precedence
    assert b'--threads\x003\x00' in precedence[3] and b'--port\x0010001\x00' in precedence[3]
    assert b'--device\x00none\x00' in precedence[3] and b'--host\x00127.0.0.1\x00' in precedence[3]
    print('PASS: new environment names, legacy aliases, explicit precedence')

    sampling = ['temperature', 'top_p', 'top_k', 'min_p', 'repeat_penalty', 'presence_penalty', 'frequency_penalty']
    presets = {'focused':['0.6','0.95','20','0','1','0','0'],
               'exploratory':['1','0.95','20','0','1','0','0'],
               'min-p':['1','1','0','0.05','1','0','0']}
    for preset, values in presets.items():
        result = run({'MIR_GENERATION_PRESET':preset})
        assert result[0] == 0, result
        args = result[3].decode().split('\0')[:-1]
        for key, value in zip(sampling, values):
            assert args[args.index('--'+key.replace('_','-'))+1] == value, args
        assert '--seed' not in args and '--n-predict' not in args
    assert all('--'+key.replace('_','-') not in default_args for key in sampling)
    overrides = {'MIR_GENERATION_PRESET':'focused', 'MIR_TEMPERATURE':'0.75',
                 'LLAMA_TEMPERATURE':'bad', 'MIR_SEED':'4294967295', 'MIR_MAX_TOKENS':'1024'}
    args = run(overrides, ['--temperature','0.9'])[3].decode().split('\0')[:-1]
    assert args[args.index('--temperature')+1] == '0.75' and args[-2:] == ['--temperature','0.9']
    assert args[args.index('--seed')+1] == '4294967295' and args[args.index('--n-predict')+1] == '1024'
    for key, value in [('TEMPERATURE','nan'), ('TOP_P','1.01'), ('MIN_P','-0.1'), ('TOP_K','1.5'),
                       ('REPEAT_PENALTY','0'), ('PRESENCE_PENALTY','$(touch bad)'),
                       ('FREQUENCY_PENALTY','-0.1234567890'),
                       ('SEED','4294967296'), ('MAX_TOKENS','-2'), ('GENERATION_PRESET','unknown')]:
        result = run({'MIR_'+key:value})
        assert result[0] == 1 and result[3] is None and result[2], (key,value,result)
    explicit = {'TEMPERATURE':'0', 'TOP_P':'1.000', 'MIN_P':'0', 'TOP_K':'0',
                'REPEAT_PENALTY':'0.01', 'PRESENCE_PENALTY':'-0.5', 'FREQUENCY_PENALTY':'0.2',
                'SEED':'-1', 'MAX_TOKENS':'0'}
    result = run({'MIR_'+key:value for key,value in explicit.items()})
    assert result[0] == 0, result
    args = result[3].decode().split('\0')[:-1]
    for key, value in explicit.items():
        flag = '--n-predict' if key == 'MAX_TOKENS' else '--' + key.lower().replace('_','-')
        assert args[args.index(flag)+1] == value, (key,value,args)
    assert run({'LLAMA_GENERATION_PRESET':'min-p', 'LLAMA_TEMPERATURE':'0.7'})[0] == 0
    print('PASS: generation presets, default omission, numeric validation, aliases and pass-through precedence')

    sources = 'MIR_ROOT=$1; source "$MIR_ROOT/tests/helpers/core.sh"; load_test_core fake\n'
    summary_checks = r'''
initialize_config "$2"
CTX_SIZE=4096
MODEL="/models/$(printf 'long-name-%.0s' {1..20})model.gguf"
DEVICE=$(printf 'Accelerator%.0s' {1..12})
CURRENT_PROFILE="$PROFILES_DIR/$(printf 'Profile%.0s' {1..10}).conf"
SAVED_PROFILE='different settings'
PORT_STATUS=$'Port 9931: IN USE\n123 user server'
before=$(profile_data)
mapfile -t lines < <(configuration_summary)
[[ ${#lines[@]} == 5 && ${lines[0]} == *'(Modified)' ]]
[[ ${lines[1]} == *'...'*model.gguf && ${lines[2]} == 'Context       4K' ]]
[[ ${lines[3]} == Device* && ${lines[4]} == 'Port          9931: IN USE' ]]
for line in "${lines[@]}"; do (( ${#line} <= 72 )); done
[[ $(profile_data) == "$before" ]]
for CTX_SIZE in auto 0 4096 12345 2147483647; do
    mapfile -t lines < <(configuration_summary)
    [[ ${lines[2]} == "Context       $(context_label)" ]]
    (( ${#lines[2]} <= 72 ))
done
MODEL=''
[[ $(configuration_summary) == *'Model         Not selected'* ]]
'''
    subprocess.run(['bash','-euo','pipefail','-c',sources+summary_checks,'test',str(root),str(model)],env=env,check=True)
    print('PASS: compact summary, long names, Modified visibility and unchanged settings')

    hidden = models / '.hidden'
    hidden.mkdir()
    (work / 'dialog.log').write_text('')
    (work / 'queue').write_text(json.dumps([
        [0,'hidden'], [0,'path'], [255,''],
        [0,'path'], [0,str(models / 'missing')], [0,''],
        [0,'path'], [0,str(hidden)], [0,'parent'], [0,'1'], [0,'use']]))
    folder_checks = r'initialize_config "$2"; [[ $(select_folder "$MODELS_DIR") == "$MODELS_DIR/.hidden" ]]'
    subprocess.run(['bash','-euo','pipefail','-c',sources+folder_checks,'test',str(root),str(model)],env=env,check=True)
    folder_menus = [args for line in (work / 'dialog.log').read_text().splitlines()
                    if '--menu' in (args := json.loads(line))]
    assert [args[args.index('--default-item')+1] for args in folder_menus] == [
        'use', 'hidden', 'path', 'path', 'use', 'use', 'use']
    assert '.hidden/' not in folder_menus[0] and '.hidden/' in folder_menus[1]
    assert json.loads((work / 'queue').read_text()) == []
    (work / 'queue').write_text(json.dumps([[255,'']]))
    folder_checks = r'initialize_config "$2"; previous=$MODELS_DIR; if select_folder "$MODELS_DIR"; then exit 1; fi; [[ "$MODELS_DIR" == "$previous" ]]'
    subprocess.run(['bash','-euo','pipefail','-c',sources+folder_checks,'test',str(root),str(model)],env=env,check=True)
    print('PASS: folder selection memory, hidden folders, parent navigation, invalid paths and cancellation')

    # Drive the TUI through a PTY with queued dialog responses.
    (work / 'config/mir.cpp/profiles/A profile.conf').unlink(missing_ok=True)
    queue = [[0,'configurations'],[0,'save'],[0,'A profile'],[0,''],[0,'back'],
             [0,'model'],[0,'context'],[0,'8192'],
             [0,'generation'],[0,'preset'],[0,'focused'],
             [0,'sampling'],[0,'temperature'],[0,'0.7'],[0,'back'],
             [0,'seed'],[0,'42'],[0,'max_tokens'],[0,'2048'],[0,'back'],
             [0,'back'],
             [0,'performance'],[0,'prompt'],[0,'low-memory'],[0,'back'],
             [0,'configurations'],[0,'update'],[0,''],[0,''],[0,'back'],
             [0,'configurations'],[0,'load'],[0,'0'],
             [0,'configurations'],[0,'delete'],[0,'0'],[0,''],[0,'back'],
             [0,'server'],[0,'check'],[0,'details'],[0,''],[0,'back'],[0,'launch'],[1,''],[0,''],[0,'']]
    (work / 'queue').write_text(json.dumps(queue))
    (work / 'dialog.log').write_text('')
    (work / 'stopped').unlink(missing_ok=True)
    (work / 'browser').unlink(missing_ok=True)
    (work / 'args').unlink(missing_ok=True)
    master, slave = pty.openpty()
    process = subprocess.Popen(['bash',str(launcher)], stdin=slave, stdout=slave, stderr=slave,
                               env=env | {'TEST_LIVE':'1','TEST_HEALTH':'0'}, cwd='/', start_new_session=True)
    os.close(slave)
    try:
        process.wait(timeout=8)
        assert process.returncode == 0
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
        os.close(master)
    assert (work / 'stopped').exists(), 'Server was not cleaned up'
    assert (work / 'browser').read_text() == 'http://127.0.0.1:9931'
    assert not (work / 'config/mir.cpp/profiles/A profile.conf').exists()
    assert json.loads((work / 'queue').read_text()) == []
    log = (work / 'dialog.log').read_text()
    assert 'View log' in log and 'Ready' in log
    assert 'MIR.CPP / STATION CONTROL' in log and 'Status     Ready' in log
    assert 'Free GiB:' in log, log
    dialogs = [json.loads(line) for line in log.splitlines()]
    for args in dialogs:
        assert args.count('MIR.CPP / STATION CONTROL') == 1
        title = args[args.index('--title')+1].strip()
        assert title and 'Mir.cpp' not in title and 'STATION CONTROL' not in title
    menus = [args for args in dialogs if '--menu' in args]
    model_menus = [args for args in menus if args[args.index('--title')+1] == ' Model settings ']
    assert model_menus
    for args in model_menus:
        index = args.index('--menu')
        assert args[index+4] == '5'
        assert args[index+5::2] == ['model','context','cache','generation','back']
    assert all(args[args.index('--ok-label')+1] == 'Select' for args in menus)
    for args in menus:
        cancel = [value for key, value in zip(args, args[1:]) if key == '--cancel-label'][-1]
        assert cancel == ('Quit' if 'Launch server' in args else 'Back')
    main = [args for args in menus if 'Launch server' in args]
    assert [args[args.index('--default-item')+1] for args in main] == [
        'launch', 'configurations', 'model', 'performance',
        'configurations', 'configurations', 'configurations', 'server']
    assert any(args[args.index('--default-item')+1] == 'context' for args in menus)
    for args in main:
        assert args[args.index('--title')+1] == ' Main menu '
        index = args.index('--menu')
        assert args[index+5::2] == ['launch','model','performance','server','configurations','paths','quit']
        assert len(args[index+1].splitlines()) == 5
    assert any('--msgbox' in args and ' Port process details ' in args and '--scrollbar' in args for args in dialogs)
    assert any('--msgbox' in args and ' Information ' in args for args in dialogs)
    assert all(args[args.index('--title')+1] == ' Server log ' and '--exit-label' in args
               for args in dialogs if '--textbox' in args)
    args = (work / 'args').read_bytes()
    assert b'--ctx-size\x008192\x00' in args and b'--batch-size\x00512\x00' in args
    assert b'--temperature\x000.7\x00' in args and b'--seed\x0042\x00' in args and b'--n-predict\x002048\x00' in args
    boxes = [json.loads(line) for line in log.splitlines() if '--textbox' in line]
    assert boxes and not Path(boxes[0][boxes[0].index('--textbox')+1]).exists()
    print('PASS: TUI navigation, settings, readiness, logs, Stop server and temporary-log cleanup')

    (work / 'pid').unlink(missing_ok=True)
    (work / 'stopped').unlink(missing_ok=True)
    process = subprocess.Popen(['bash', str(launcher), str(model)], env=env | {'TEST_LIVE':'1'},
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
    try:
        deadline = time.monotonic() + 4
        while not (work / 'pid').exists() and time.monotonic() < deadline:
            time.sleep(0.01)
        assert (work / 'pid').exists()
        process.terminate()
        process.communicate(timeout=4)
        assert process.returncode == 143 and (work / 'stopped').exists()
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
            process.wait(timeout=3)
    print('PASS: SIGTERM exit status and owned-server cleanup')

PY
