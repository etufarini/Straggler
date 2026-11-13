#!/usr/bin/env bash
# Server capabilities, device discovery and native argument compatibility; no inference.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import signal
import shutil
import subprocess
import sys
import tempfile
import time

root = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='mir-portability-') as temporary:
    work = Path(temporary)
    commands = work / 'bin'
    commands.mkdir()
    # Exercise the Linux branch even on macOS; native Darwin checks are separate.
    (commands / 'uname').write_text('#!/bin/sh\nprintf "Linux\\n"\n')
    (commands / 'uname').chmod(0o755)
    for tool in ('mv', 'find'):
        gnu = shutil.which('g' + tool)
        if gnu:
            (commands / tool).symlink_to(gnu)
    models = work / 'models'
    models.mkdir()
    model = models / 'model.gguf'
    model.touch()
    server_dir = work / 'llama.cpp'
    (server_dir / 'build/bin').mkdir(parents=True)

    def executable(path, contents):
        path.write_text(contents)
        path.chmod(0o755)

    help_text = '''--model FNAME        model file
--port PORT          TCP port
--host HOST          bind address
-dev, --device DEV   devices
--ctx-size N         context
--threads N          threads
--gpu-layers N       layers, auto or all
--batch-size N       batch
--ubatch-size N      ubatch
-sm, --split-mode {none,layer,row,tensor}  GPU distribution
-ts, --tensor-split N0,N1,...  relative proportions
-fitt, --fit-target MiB0,MiB1,...  fitting margin
-ctk, --cache-type-k TYPE  KV cache data type for K
    allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
-ctv, --cache-type-v TYPE  KV cache data type for V
    allowed values: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1
--alias STRING       alias
--lora-scaled FNAME SCALE   adapter
--no-webui           Disable the Web UI'''
    executable(server_dir / 'build/bin/llama-server', '''#!/usr/bin/env bash
if [[ ${1:-} == --help ]]; then printf '%s\\n' "$TEST_HELP"; exit "${TEST_HELP_EXIT:-0}"; fi
if [[ ${1:-} == --list-devices ]]; then printf '%s\\n' "$TEST_DEVICES"; exit "${TEST_DEVICE_EXIT:-0}"; fi
printf '%s\\0' "$@" > "$TEST_ARGS"
# Inject native startup failures without duplicating llama.cpp's parser.
if [[ -n ${TEST_START_ERROR:-} ]]; then printf '%s\\n' "$TEST_START_ERROR" >&2; fi
if [[ ${TEST_START_EXIT:-0} != 0 ]]; then exit "$TEST_START_EXIT"; fi
if [[ ${TEST_LIVE:-0} == 1 ]]; then
    trap 'exit 0' TERM
    while true; do /bin/sleep 0.02; done
fi
''')
    executable(commands / 'ss', '''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_PORTS"
if [[ -n ${TEST_BUSY_PORT:-} && $* == *":$TEST_BUSY_PORT" ]]; then
    printf 'LISTEN 0 128 0.0.0.0:%s 0.0.0.0:*\\n' "$TEST_BUSY_PORT"
fi
''')
    executable(commands / 'curl', '#!/usr/bin/env bash\nprintf "%s\\0" "$@" > "$TEST_CURL"\n')
    executable(commands / 'xdg-open', '#!/usr/bin/env bash\nprintf "%s" "$1" > "$TEST_BROWSER"\n')
    executable(commands / 'sleep', '#!/usr/bin/env bash\n/bin/sleep 0.01\n')
    env = {k:v for k,v in os.environ.items() if not k.startswith(('LLAMA_', 'MIR_', 'XDG_'))}
    (work / 'home').mkdir()
    env.update(HOME=str(work / 'home'), XDG_DATA_HOME=str(work / 'data'), PATH=str(commands) + ':' + env['PATH'], XDG_CONFIG_HOME=str(work / 'config'),
               MIR_LLAMA_CPP_DIR=str(server_dir), MIR_MODELS_DIR=str(models),
               TEST_HELP=help_text, TEST_DEVICES='Available devices:\n  Vulkan0: First GPU (16384 MiB, 8192 MiB free)\n  Vulkan1: Second GPU (8192 MiB, 4096 MiB free)',
               TEST_ARGS=str(work / 'args'), TEST_PORTS=str(work / 'ports'),
               TEST_CURL=str(work / 'curl'), TEST_BROWSER=str(work / 'browser'),
               TEST_QUEUE=str(work / 'queue'))
    sources = 'MIR_ROOT=$1; source "$MIR_ROOT/tests/helpers/core.sh"; load_test_core fake\n'

    def check(code, overrides=None):
        result = subprocess.run(['bash', '-euo', 'pipefail', '-c', sources + code,
                                 'test', str(root), str(model)], env=env | (overrides or {}),
                                capture_output=True, text=True, timeout=12)
        assert result.returncode == 0, (code, result.stdout, result.stderr)

    def launch(overrides=None, arguments=None):
        (work / 'args').unlink(missing_ok=True)
        (work / 'ports').write_text('')
        result = subprocess.run(['bash', str(root / 'mir.sh'), str(model)] + (arguments or []),
                                env=env | (overrides or {}), capture_output=True, text=True, timeout=10)
        data = (work / 'args').read_bytes().split(b'\0')[:-1] if (work / 'args').exists() else []
        return result, [s.decode() for s in data]

    for context in ['auto', '0', '1024']:
        result, args = launch({'MIR_CTX_SIZE':context})
        assert result.returncode == 0, result.stderr
        if context == 'auto':
            assert '--ctx-size' not in args
        else:
            assert args[args.index('--ctx-size')+1] == context
    result, args = launch({'LLAMA_ARG_CTX_SIZE':'2048'})
    assert result.returncode == 0 and '--ctx-size' not in args
    result, args = launch({'MIR_CTX_SIZE':'1+1'})
    assert result.returncode != 0 and not args
    print('PASS: automatic/custom context, native environment and bounded validation')

    # GPU controls must stay optional, literal and independent of CPU fallback.
    result, args = launch()
    for flag in ['--split-mode', '--tensor-split', '--fit-target']:
        assert flag not in args
    gpu_controls = {'SPLIT_MODE':('layer','--split-mode','row'),
                    'TENSOR_SPLIT':('2.5,1','--tensor-split','1,2'),
                    'FIT_TARGET':('2048,1024','--fit-target','512')}
    for key, (value, flag, native) in gpu_controls.items():
        result, args = launch({'MIR_'+key:value})
        assert result.returncode == 0 and args[args.index(flag)+1] == value, result.stderr
        result, args = launch({'LLAMA_ARG_'+key:value})
        assert result.returncode == 0 and flag not in args
        result, args = launch({'MIR_'+key:'auto', 'LLAMA_ARG_'+key:value})
        assert result.returncode == 0 and flag not in args
        result, args = launch({'MIR_'+key:value, 'LLAMA_ARG_'+key:native})
        assert result.returncode == 0 and args[args.index(flag)+1] == value
        # Native parsers may reject malformed environment values before CLI
        # overrides. Construction alone cannot establish successful startup.
        error = 'error while handling environment variable "LLAMA_ARG_'+key+'"'
        result, args = launch({'MIR_'+key:value, 'LLAMA_ARG_'+key:'invalid',
                               'TEST_START_EXIT':'1', 'TEST_START_ERROR':error})
        assert result.returncode == 1 and error in result.stderr
        assert args[args.index(flag)+1] == value
        result, args = launch({'MIR_'+key:value, 'MIR_DEVICE':'none', 'TEST_HELP':help_text.replace(flag,'--unavailable')})
        assert result.returncode == 0 and flag not in args and args[args.index('--gpu-layers')+1] == '0'
        result, args = launch({'MIR_'+key:value, 'TEST_HELP':help_text.replace(flag,'--unavailable')})
        assert result.returncode != 0 and flag in result.stderr and not args
    for key in ('SPLIT_MODE', 'TENSOR_SPLIT', 'FIT_TARGET'):
        result, args = launch({'MIR_'+key:'$(touch executed)'})
        assert result.returncode != 0 and not args, (key,result.stderr)
    result, args = launch({'MIR_TENSOR_SPLIT':'0,1', 'MIR_FIT_TARGET':'0'})
    assert result.returncode == 0, result.stderr
    for arguments in [['-sm','row','-ts','1,2','-fitt','1024'],
                      ['--split-mode','row','--tensor-split','1,2','--fit-target','1024']]:
        check('''initialize_config "$2"
validate_config
prepare_server ''' + ' '.join(arguments) + '''
[[ $EFFECTIVE_SPLIT_MODE == row ]]
''', {'MIR_SPLIT_MODE':'tensor', 'MIR_TENSOR_SPLIT':'2,1', 'MIR_FIT_TARGET':'2048'})
    # b12177 rejects the equals form; pass it through unchanged and surface
    # the server's failure rather than claiming universal native support.
    error = 'error: invalid argument: --split-mode=row'
    result, args = launch({'TEST_START_EXIT':'1', 'TEST_START_ERROR':error}, ['--split-mode=row'])
    assert result.returncode == 1 and error in result.stderr and args[-1] == '--split-mode=row'
    for arguments in [['-ts'], ['--fit-target'], ['--split-mode','bogus']]:
        result, args = launch(arguments=arguments)
        assert result.returncode != 0 and not args, arguments
    result, args = launch(arguments=['--alias','--tensor-split'])
    assert result.returncode == 0
    for value in ['0,0','1/2','1e2,1']:
        result, args = launch(arguments=['--tensor-split',value])
        assert result.returncode == 0 and args[-2:] == ['--tensor-split',value]
    result, args = launch({'TEST_HELP':help_text.replace('{none,layer,row,tensor}','{none,layer,future_mode}')}, ['--split-mode','future_mode'])
    assert result.returncode == 0 and args[-2:] == ['--split-mode','future_mode']
    result, args = launch({'MIR_SPLIT_MODE':'tensor', 'TEST_HELP':help_text.replace('{none,layer,row,tensor}','{none,layer,row}')})
    assert result.returncode != 0 and 'not advertised' in result.stderr
    print('PASS: optional GPU flags, literal ratio/margin validation, native/MIR/CLI priority, CPU fallback and unsupported builds')

    # The installed build's help is the authority; never reuse draft-cache lists.
    check(r'''initialize_config "$2"
server_capabilities
expected=$'f32\nf16\nbf16\nq8_0\nq4_0\nq4_1\niq4_nl\nq5_0\nq5_1'
[[ $(cache_types K) == "$expected" && $(cache_types V) == "$expected" ]]
help=$'--cache-type-k TYPE\n  allowed values: f16, q4_0,\n                  custom_type\n  (default: f16)\n--cache-type-v TYPE\n  allowed values: f16\n--cache-type-k-draft TYPE\n  allowed values: draft_only'
[[ $(cache_types K "$help") == $'f16\nq4_0\ncustom_type' ]]
[[ $(cache_types V "$help") == f16 ]]
[[ -z $(cache_types K $'--cache-type-k-draft TYPE\nallowed values: draft_only') ]]
''')
    for kind in ['q8_0', 'f16', 'q5_1']:
        result, args = launch({'MIR_CACHE_TYPE_K':kind, 'MIR_CACHE_TYPE_V':kind})
        assert result.returncode == 0, (kind, result.stderr)
        assert args[args.index('--cache-type-k')+1] == kind
        assert args[args.index('--cache-type-v')+1] == kind
    result, args = launch()
    assert args[args.index('--cache-type-k')+1] == 'q4_0'
    assert args[args.index('--cache-type-v')+1] == 'q4_0'
    result, args = launch({'LLAMA_ARG_CACHE_TYPE_K':'q8_0', 'LLAMA_ARG_CACHE_TYPE_V':'f16'})
    assert result.returncode == 0 and 'KV cache: K q8_0 | V f16' in result.stdout
    result, args = launch({'LLAMA_ARG_CACHE_TYPE_K':'q8_0', 'MIR_CACHE_TYPE_K':'q4_0'})
    assert result.returncode == 0 and 'KV cache: K q4_0 | V q4_0' in result.stdout
    for key in ['K', 'V']:
        result, args = launch({'MIR_CACHE_TYPE_'+key:'$(touch executed)'})
        assert result.returncode != 0 and not args, key
        result, args = launch({'MIR_CACHE_TYPE_'+key:'unavailable'})
        assert result.returncode != 0 and not args and 'not advertised' in result.stderr
    for arguments in [['-ctk','q8_0','-ctv','f16'], ['--cache-type-k','q8_0','--cache-type-v','f16']]:
        result, args = launch({'MIR_CACHE_TYPE_K':'unavailable'}, arguments)
        assert result.returncode == 0 and 'KV cache: K q8_0 | V f16' in result.stdout, result.stderr
    result, args = launch(arguments=['--alias','--cache-type-v'])
    assert result.returncode == 0 and 'KV cache: K q4_0 | V q4_0' in result.stdout
    for arguments in [['-ctk'], ['--cache-type-v'], ['--cache-type-k','unavailable']]:
        result, args = launch(arguments=arguments)
        assert result.returncode != 0 and not args
    result, args = launch({'TEST_HELP':'--model FNAME\n--port PORT'})
    assert result.returncode != 0 and 'does not advertise --cache-type-k' in result.stderr
    print('PASS: all advertised cache types, wrapped/draft help isolation, defaults, native/MIR/CLI priority and unsupported controls')

    for host, address in [('::1','[::1]'), ('::','[::1]'), ('0.0.0.0','127.0.0.1'),
                          ('127.0.0.2','127.0.0.2'), ('::1,127.0.0.1','[::1]')]:
        result, _ = launch({'MIR_HOST':host})
        assert result.returncode == 0 and f'http://{address}:9931' in result.stdout, result
    result, _ = launch({'LLAMA_ARG_HOST':'::1'})
    assert result.returncode == 0 and 'http://[::1]:9931' in result.stdout
    result, args = launch(arguments=['--port','10001', '--host','::1', '--alias','two words'])
    assert result.returncode == 0 and 'http://[::1]:10001' in result.stdout
    assert (work / 'ports').read_text().strip().endswith(':10001')
    assert args[-6:] == ['--port','10001', '--host','::1', '--alias','two words']
    result, _ = launch({'TEST_BUSY_PORT':'10001'}, ['--port','10001'])
    assert result.returncode != 0 and 'IN USE' in result.stderr and not (work / 'args').exists()
    result, _ = launch({'TEST_BUSY_PORT':'9931'}, ['--port','10002','--host','0.0.0.0'])
    assert result.returncode == 0 and 'http://127.0.0.1:10002' in result.stdout
    result, _ = launch(arguments=['--alias','--port','--lora-scaled','--host','1'])
    assert result.returncode == 0 and 'http://127.0.0.1:9931' in result.stdout, result
    result, _ = launch(arguments=['--no-webui','--host','::1'])
    assert result.returncode == 0 and 'http://[::1]:9931' in result.stdout, result
    for arguments in [['--port'], ['--host'], ['--port','65536']]:
        result, args = launch(arguments=arguments)
        assert result.returncode != 0 and not args, arguments
    check('''initialize_config "$2"
validate_config
prepare_server --host /tmp/mir-test.sock
[[ $URL == 'Unix socket: /tmp/mir-test.sock' && $HEALTH_URL == http://localhost ]]
[[ ${CURL_ARGS[*]} == *'--unix-socket /tmp/mir-test.sock' ]]
''')
    print('PASS: effective host/port, IPv6, wildcard and native binds, occupied overrides, argument values and Unix socket health')

    minimal_help = '--model FNAME\n--port PORT\n--cache-type-k TYPE\n--cache-type-v TYPE'
    result, _ = launch({'TEST_HELP':minimal_help, 'MIR_THREADS':'4'})
    assert result.returncode != 0 and 'does not advertise --threads' in result.stderr
    result, _ = launch({'TEST_HELP':minimal_help})
    assert result.returncode == 0, result.stderr
    result, _ = launch({'TEST_HELP_EXIT':'1'})
    assert result.returncode == 0 and 'Could not inspect' in result.stderr
    result, _ = launch({'MIR_DEVICE':'Vulkan0,Vulkan1'})
    assert result.returncode == 0, result.stderr
    result, _ = launch({'MIR_DEVICE':'Vulkan9'})
    assert result.returncode != 0 and "Device 'Vulkan9' is unavailable" in result.stderr
    result, _ = launch({'MIR_DEVICE':'Vulkan9'}, ['--device','none'])
    assert result.returncode == 0, result.stderr
    check('''initialize_config "$2"
DEVICE=Vulkan9
if prepare_server; then exit 1; fi
[[ $DEVICE == Vulkan9 && $LAUNCH_ERROR == *unavailable* ]]
platform_timeout() { return 1; }
DEVICE=none
GPU_LAYERS=all
prepare_server
[[ ${ARGS[*]} == *'--device none --gpu-layers 0'* ]]
''')
    # Prove the bound can actually terminate a stalled probe, independently of a GPU.
    executable(commands / 'stalled', '#!/usr/bin/env bash\nexec /bin/sleep 30\n')
    start = time.monotonic()
    check('if platform_timeout 0.1 stalled; then exit 1; fi')
    assert time.monotonic() - start < 3
    print('PASS: server capability checks, missing devices without mutation, CPU recovery and bounded probing')

    # The complete running loop must probe and open the effective IPv6 endpoint.
    for artifact in ('args', 'curl', 'browser'):
        (work / artifact).unlink(missing_ok=True)
    process = subprocess.Popen(['bash', str(root / 'mir.sh'), str(model), '--port', '10003'],
                               env=env | {'TEST_LIVE':'1', 'MIR_HOST':'::1'},
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, start_new_session=True)
    try:
        deadline = time.monotonic() + 5
        while not (work / 'browser').exists() and time.monotonic() < deadline:
            time.sleep(0.02)
        assert (work / 'browser').read_text() == 'http://[::1]:10003'
        curl_args = (work / 'curl').read_bytes().split(b'\0')[:-1]
        assert b'http://[::1]:10003/health' in curl_args and b'--noproxy' in curl_args and b'--globoff' in curl_args
    finally:
        process.terminate()
        try:
            process.communicate(timeout=5)
        finally:
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=3)
    assert process.returncode == 143
    print('PASS: running health check, browser address and shutdown with an overridden IPv6 endpoint')

PY
