#!/usr/bin/env bash
# End-to-end startup and owned-server lifecycle checks.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import json
import os
from pathlib import Path
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
