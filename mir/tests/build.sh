#!/usr/bin/env bash
# Isolated build/update and package-manager checks; no real packages or models.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" "${1:-linux}" <<'PY'
import hashlib
import io
import json
import os
from pathlib import Path
import pty
import select
import shutil
import signal
import struct
import subprocess
import sys
import tarfile
import tempfile
import termios
import time

root = Path(sys.argv[1])
adapter = sys.argv[2]
assert adapter in ('linux', 'macos')
gpu = 'metal' if adapter == 'macos' else 'vulkan'
with tempfile.TemporaryDirectory(prefix='mir-build-test-') as temporary:
    work = Path(temporary)
    home = work / 'home with spaces'
    home.mkdir()
    commands = work / 'bin'
    commands.mkdir()

    def executable(name, text):
        path = commands / name
        path.write_text(text)
        path.chmod(0o755)

    executable('git', '''#!/usr/bin/env bash
if [[ $* == *rev-parse* ]]; then
    if [[ $* == *--verify* ]]; then printf 'tag\\n' >> "$TEST_WORK/build.events"; fi
    [[ $* != *--verify* || ${TEST_NOT_TAG:-0} == 0 ]] || exit 1
    printf '%040d\\n' 1; exit
fi
printf 'clone\\n' >> "$TEST_WORK/build.events"
[[ ${TEST_CLONE_FAIL:-0} == 0 ]] || exit 1
printf '%s\\0' "$@" >> "$TEST_WORK/git.args"
if [[ ${TEST_SLOW:-0} == 1 ]]; then
    echo "$$" > "$TEST_WORK/worker.pid"
    trap 'echo stopped > "$TEST_WORK/worker.stopped"; exit 143' TERM
    /bin/sleep 30
fi
target=${*: -1}
mkdir -p "$target/tools/ui/dist"
if [[ ${TEST_PIN_UI:-0} == 1 ]]; then
    mkdir -p "$target/scripts"
    touch "$target/scripts/ui-assets.cmake"
elif [[ ${TEST_NO_UI:-0} == 0 ]]; then echo '<html>fixture</html>' > "$target/tools/ui/dist/index.html"; fi
''')
    executable('cmake', '''#!/usr/bin/env bash
printf '%s\\0' "$@" >> "$TEST_WORK/cmake.args"
if [[ ${1:-} == -S ]]; then event=configure; else event=compile; fi
printf '%s\\n' "$event" >> "$TEST_WORK/build.events"
[[ ${TEST_CMAKE_FAIL:-0} == 0 ]] || exit 1
[[ ${1:-} != --build || ${TEST_BUILD_FAIL:-0} == 0 ]] || exit 1
if [[ $* == *'--target help'* ]]; then exit 99; fi
if [[ ${1:-} == -S ]]; then
    mkdir -p "$4/bin"
    cat > "$4/bin/llama-server" <<'SERVER'
#!/usr/bin/env bash
printf 'probe:%s\\n' "${1:-}" >> "$TEST_WORK/build.events"
[[ ${TEST_PROBE_FAIL:-0} == 0 ]] || exit 1
if [[ ${TEST_SLOW_PROBE:-0} == 1 ]]; then
    echo "$$" > "$TEST_WORK/probe.pid"
    trap 'echo stopped > "$TEST_WORK/probe.stopped"; exit 143' TERM
    /bin/sleep 30
fi
if [[ ${1:-} == --list-devices ]]; then
    echo 'Available devices:'
    echo '  BLAS: CPU library (0 MiB, 0 MiB free)'
    if [[ ${TEST_NO_DEVICE:-0} == 0 ]]; then echo '  Arbitrary0: Test accelerator'; fi
else echo 'version/help fixture'; fi
SERVER
    chmod +x "$4/bin/llama-server"
fi
''')
    executable('curl', '''#!/usr/bin/env bash
[[ ${TEST_NETWORK_FAIL:-0} == 0 ]] || exit 22
printf '%s\\0' "$@" >> "$TEST_WORK/curl.args"
if [[ $* == *'/releases/tags/'* ]]; then printf '%s' "$TEST_UI_META"; exit; fi
while (( $# )); do
    if [[ $1 == --output ]]; then cp -- "$TEST_UI_ARCHIVE" "$2"; exit; fi
    shift
done
printf '%s' '[{"tag_name":"v1","published_at":"2026-01-01","draft":false},{"tag_name":"b2","published_at":"2026-01-03","prerelease":true},{"tag_name":"draft","published_at":"2026-01-04","draft":true}]'
''')
    executable('ps', '''#!/usr/bin/env bash
if [[ ${TEST_PS_RACE:-0} == 1 && ! -e "$TEST_WORK/ps-started" ]]; then
    touch "$TEST_WORK/ps-started"
    /bin/sleep 2
    exit 1
fi
exec "$TEST_REAL_PS" "$@"
''')
    executable('ss', '#!/usr/bin/env bash\nexit 0\n')
    executable('setsid', '#!/usr/bin/env python3\nimport os, sys\nos.setsid()\nos.execvp(sys.argv[1], sys.argv[1:])\n')
    env = {k: v for k, v in os.environ.items() if not k.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    env.update(HOME=str(home), XDG_CONFIG_HOME=str(home / 'config'),
               XDG_DATA_HOME=str(home / 'data'), PATH=str(commands) + ':' + os.environ['PATH'],
               MIR_ROOT=str(root), TEST_GPU=gpu, TEST_WORK=str(work), TEST_REAL_PS=shutil.which('ps'))
    sources = 'source "$MIR_ROOT/tests/helpers/core.sh"\nload_test_core ' + adapter + '\nsource \"$MIR_ROOT/lib/desktop.sh\"\ninstall_build() { (platform_ensure_dependencies() { return 0; }; desktop_build \"$@\") || return; load_paths; SERVER=$(server_path \"$LLAMA_CPP_PATH\"); }\n'
    init = '''initialize_config
mkdir -p "$CONFIG_DIR"
'''

    def check(code, overrides=None, success=True, timeout=12):
        result = subprocess.run(['bash', '-euo', 'pipefail', '-c', sources + init + code],
                                env=env | (overrides or {}), cwd=work, capture_output=True, text=True, timeout=timeout)
        assert (result.returncode == 0) == success, (code, result.stdout, result.stderr)
        return result

    check('''[[ $(latest_build_tag) == b2 ]]
for tag in 'bad;touch /tmp/never' '../bad' '-bad' ''; do
    if valid_build_tag "$tag"; then exit 1; fi
done
''')
    check('latest_build_tag', {'TEST_NETWORK_FAIL': '1'}, success=False)
    print('PASS: release ordering, prereleases, network errors and literal tag validation')

    check('''for jobs in 1 64; do valid_build_jobs "$jobs"; done
for jobs in '' 0 01 -1 65 1.5 '1+1' '$(touch executed)'; do
    if valid_build_jobs "$jobs"; then exit 1; fi
done
''')
    check('''LLAMA_CPP_PATH="$HOME/external"
mkdir -p "$LLAMA_CPP_PATH"; echo original > "$LLAMA_CPP_PATH/keep"
MODEL="$HOME/model.gguf"; touch "$MODEL"
DEVICE=none; CTX_SIZE=4096
install_build v1 cpu 2
read_build "$LLAMA_CPP_PATH"
[[ $BUILD_TAG == v1 && $BUILD_BACKEND == cpu && -z $BUILD_PREVIOUS ]]
first=$LLAMA_CPP_PATH
[[ $SERVER == "$first/build/bin/llama-server" && -f "$HOME/external/keep" ]]
[[ $DEVICE == none && $CTX_SIZE == 4096 && $MODEL == "$HOME/model.gguf" ]]
install_build b2 "$TEST_GPU" 2
read_build "$LLAMA_CPP_PATH"
[[ $BUILD_TAG == b2 && $BUILD_BACKEND == "$TEST_GPU" && $BUILD_PREVIOUS == "${first##*/}" ]]
second=$LLAMA_CPP_PATH
CAPABILITIES_SERVER=old
activate_build "$first"
[[ $LLAMA_CPP_PATH == "$first" && -z $CAPABILITIES_SERVER ]]
activate_build "$second"
[[ $LLAMA_CPP_PATH == "$second" ]]
''')
    assert ('-DGGML_' + gpu.upper() + '=ON\0').encode() in (work / 'cmake.args').read_bytes()
    assert b'--target\0llama-server\0' in (work / 'cmake.args').read_bytes()
    assert b'--target\0help\0' not in (work / 'cmake.args').read_bytes()
    if adapter == 'linux':
        check('''stage=$(mktemp -d "$(build_root)/builds/build.XXXXXXXX")
    build_release "$stage" b2 cuda 2 ''
    read_build "$stage"
    [[ $BUILD_BACKEND == cuda ]]
    rm -rf -- "$stage"
    ''')
        assert b'-DGGML_CUDA=ON\0' in (work / 'cmake.args').read_bytes()
    print('PASS: install, update, backend flags, restore and preserved model settings')

    ui_archive = work / 'ui.tar.gz'
    def make_ui_archive(unsafe=False):
        with tarfile.open(ui_archive, 'w:gz', compresslevel=1) as archive:
            entries = {'llama-v1/index.html':b'<html>UI release v1</html>'}
            if unsafe:
                entries[str(work / 'escaped-ui')] = b'unsafe'
            for name, data in entries.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(data)
                archive.addfile(entry, io.BytesIO(data))
        return {'tag_name':'v1', 'assets':[{
            'name':'llama-v1-ui.tar.gz',
            'browser_download_url':'https://github.com/ggml-org/llama.cpp/releases/download/v1/llama-v1-ui.tar.gz',
            'digest':'sha256:' + hashlib.sha256(ui_archive.read_bytes()).hexdigest()}]}

    ui_metadata = make_ui_archive()
    ui_env = {'TEST_PIN_UI':'1', 'TEST_UI_META':json.dumps(ui_metadata), 'TEST_UI_ARCHIVE':str(ui_archive)}
    check('''stage=$(mktemp -d "$(build_root)/builds/build.XXXXXXXX")
build_release "$stage" v1 cpu 2 ''
[[ $(cat "$stage/source/tools/ui/dist/index.html") == '<html>UI release v1</html>' ]]
[[ ! -e "$stage/ui.tar.gz" ]]
rm -rf -- "$stage"
''', ui_env)
    assert b'-DLLAMA_USE_PREBUILT_UI=OFF\0' in (work / 'cmake.args').read_bytes()
    download_args = (work / 'curl.args').read_bytes()
    assert b'/releases/tags/v1\0' in download_args and b'/download/v1/llama-v1-ui.tar.gz\0' in download_args
    assert b'/download/latest/' not in download_args
    for failure in ('digest', 'missing_asset', 'tag', 'unsafe_archive'):
        metadata = make_ui_archive(unsafe=failure == 'unsafe_archive')
        if failure == 'digest': metadata['assets'][0]['digest'] = 'sha256:' + '0' * 64
        if failure == 'missing_asset': metadata['assets'] = []
        if failure == 'tag': metadata['tag_name'] = 'other'
        check('''previous=$LLAMA_CPP_PATH; before=$(cat "$PATHS_FILE")
if install_build v1 cpu 2; then exit 1; fi
[[ $LLAMA_CPP_PATH == "$previous" && $(cat "$PATHS_FILE") == "$before" ]]
''', ui_env | {'TEST_UI_META':json.dumps(metadata)})
        assert not (work / 'escaped-ui').exists()
    print('PASS: exact-release Web UI, SHA-256, disabled latest fallback and missing/mismatched/unsafe asset rejection')
    linked = work / 'linked builds'
    linked.symlink_to(home / 'data/mir.cpp/llama.cpp/builds', target_is_directory=True)
    check('''stage=$(mktemp -d "$TEST_WORK/linked builds/build.XXXXXXXX")
build_release "$stage" linked cpu 2 ''
[[ -x "$stage/build/bin/llama-server" ]]
rm -rf -- "$stage"
''')
    cmake_args = (work / 'cmake.args').read_bytes().split(b'\0')[:-1]
    for index, arg in enumerate(cmake_args[:-1]):
        if arg in (b'-S', b'-B'):
            path = os.fsdecode(cmake_args[index + 1])
            assert path == str(Path(path).resolve()), path
    print('PASS: symlinked staging paths resolve consistently for upstream CMake UI packaging')


    failures = {'TEST_CLONE_FAIL':'clone', 'TEST_NOT_TAG':'tag',
                'TEST_CMAKE_FAIL':'configure', 'TEST_BUILD_FAIL':'compile',
                'TEST_PROBE_FAIL':'probe:--version',
                'TEST_NO_UI':'probe:--list-devices', 'TEST_NO_DEVICE':'probe:--list-devices'}
    for failure, event in failures.items():
        (work / 'build.events').unlink(missing_ok=True)
        check('''previous=$LLAMA_CPP_PATH; before=$(cat "$PATHS_FILE")
count=$(find "$(build_root)/builds" -mindepth 1 -maxdepth 1 -type d | wc -l)
if install_build broken "$TEST_GPU" 2; then exit 1; fi
[[ $LLAMA_CPP_PATH == "$previous" && $(cat "$PATHS_FILE") == "$before" ]]
[[ $(find "$(build_root)/builds" -mindepth 1 -maxdepth 1 -type d | wc -l) == "$count" ]]
''', {failure: '1'})
        assert (work / 'build.events').is_file(), (adapter, failure, 'Build stopped before the fixture')
        assert (work / 'build.events').read_text().splitlines()[-1] == event, failure
        if failure in ('TEST_NO_UI', 'TEST_NO_DEVICE'):
            error = 'Web UI assets are missing' if failure == 'TEST_NO_UI' else 'No accelerator is available'
            assert error in (home / 'data/mir.cpp/llama.cpp/build.log').read_text(), failure
    check('''previous=$LLAMA_CPP_PATH; before=$(cat "$PATHS_FILE")
save_paths() { return 1; }
if install_build unsaved cpu 2; then exit 1; fi
[[ $LLAMA_CPP_PATH == "$previous" && $(cat "$PATHS_FILE") == "$before" ]]
''')
    check('''exec 7> "$(build_root)/.build.lock"; flock -n 7
previous=$LLAMA_CPP_PATH
if install_build locked cpu 2; then exit 1; fi
[[ $LLAMA_CPP_PATH == "$previous" ]]
''')
    print('PASS: checkout/compiler/probe/UI/device/storage failures and concurrent build protection')

    check(r'''metadata="$LLAMA_CPP_PATH/mir-build.conf"
cp "$metadata" "$TEST_WORK/metadata"
for invalid in format=2 'tag=$(touch executed)' commit=invalid backend=unknown previous=../outside; do
    field=${invalid%%=*}
    while IFS= read -r line; do
        if [[ $line == "$field="* ]]; then printf '%s\n' "$invalid";
        else printf '%s\n' "$line"; fi
    done < "$TEST_WORK/metadata" > "$metadata"
    if read_build "$LLAMA_CPP_PATH"; then exit 1; fi
    [[ ! -e executed ]]
done
for extra in 'tag=duplicate' 'future=value' 'malformed'; do
    cp "$TEST_WORK/metadata" "$metadata"
    printf '%s\n' "$extra" >> "$metadata"
    if read_build "$LLAMA_CPP_PATH"; then exit 1; fi
done
sed '/^previous=/d' "$TEST_WORK/metadata" > "$metadata"
if read_build "$LLAMA_CPP_PATH"; then exit 1; fi
rm -- "$metadata"
ln -s "$TEST_WORK/metadata" "$metadata"
if read_build "$LLAMA_CPP_PATH"; then exit 1; fi
rm -- "$metadata"
cp "$TEST_WORK/metadata" "$metadata"
read_build "$LLAMA_CPP_PATH"
if read_build "$LLAMA_CPP_PATH/../../builds/${LLAMA_CPP_PATH##*/}"; then exit 1; fi
''')
    print('PASS: metadata fields, contained paths, symlinks and duplicate rejection')

    if adapter != 'linux':
        print('PASS: macOS managed CPU/Metal builds, update/restore and compiler failure fixtures')
        sys.exit(0)

    # Simulated package operations use a pipe for the script and a PTY for consent.
    executable('apt-get', '''#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_WORK/packages"
printf 'PACKAGE_STDOUT\\n'
printf 'PACKAGE_STDERR\\n' >&2
exit "${TEST_APT_FAIL:-0}"
''')
    executable('sudo', '''#!/usr/bin/env bash
printf 'sudo %s\\n' "$*" >> "$TEST_WORK/packages"
if [[ ${TEST_PASSWORD:-0} == 1 && $2 == update ]]; then
    printf '[sudo] password: ' > /dev/tty
    IFS= read -r -s password < /dev/tty
    printf '\\n' > /dev/tty
    [[ $password == test-password ]] || exit 1
fi
exec "$@"
''')
    executable('dpkg-query', '#!/usr/bin/env bash\nprintf "install ok installed"\n')
    executable('apt-cache', '#!/usr/bin/env bash\nexit 1\n')
    dependency_code = sources + '''
debian_package_manager() { return 0; }
command() {
    if [[ $1 == -v && $2 == cmake ]]; then return 1; fi
    builtin command "$@"
}
platform_ensure_dependencies build
'''
    def dependency_run(answer, overrides=None):
        settings = env | {'TERM':'xterm-256color', 'LANG':'C.UTF-8'} | (overrides or {})
        master, slave = pty.openpty()
        def terminal():
            import fcntl
            import termios
            os.setsid()
            fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 24, 80, 0, 0))
        process = subprocess.Popen(['bash'], stdin=subprocess.PIPE, stdout=slave, stderr=slave,
                                   env=settings, preexec_fn=terminal)
        os.close(slave)
        process.stdin.write(dependency_code.encode())
        process.stdin.close()
        output = b''
        def await_text(text):
            nonlocal output
            deadline = time.monotonic() + 5
            while text not in output and time.monotonic() < deadline:
                if select.select([master], [], [], 0.1)[0]:
                    try:
                        output += os.read(master, 65536)
                    except OSError:
                        break
            assert text in output, output
        try:
            await_text(b'[y/N]')
            os.write(master, answer.encode() + b'\n')
            if settings.get('TEST_PASSWORD') == '1' and answer == 'y' and os.geteuid() != 0:
                await_text(b'[sudo] password:')
                deadline = time.monotonic() + 2
                while termios.tcgetattr(master)[3] & termios.ECHO and time.monotonic() < deadline:
                    time.sleep(0.01)
                assert not termios.tcgetattr(master)[3] & termios.ECHO
                os.write(master, b'test-password\n')
            deadline = time.monotonic() + 5
            while process.poll() is None and time.monotonic() < deadline:
                if select.select([master], [], [], 0.05)[0]:
                    try:
                        output += os.read(master, 65536)
                    except OSError:
                        break
            process.wait(timeout=1)
            while select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError:
                    break
                if not data:
                    break
                output += data
            return process.returncode, output
        finally:
            os.close(master)
            if process.poll() is None:
                process.kill()
                process.wait(timeout=5)

    assert dependency_run('n')[0] != 0
    assert not (work / 'packages').exists()
    assert dependency_run('y')[0] == 0
    package_log = (work / 'packages').read_text()
    assert 'apt-get update' in package_log and 'install --no-remove -y cmake' in package_log
    assert 'upgrade' not in package_log
    assert dependency_run('y', {'TEST_APT_FAIL': '1'})[0] != 0
    print('PASS: terminal consent with piped input, limited sudo, refusal and package failure')

PY
