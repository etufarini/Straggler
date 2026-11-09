#!/usr/bin/env bash
# Source entry point preparation, cache reuse, failed builds and owned cancellation.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 - "$TEST_ROOT" <<'PY'
import os
import hashlib
import io
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import tarfile
import time

original = Path(sys.argv[1])
with tempfile.TemporaryDirectory(prefix='mir-bootstrap-') as temporary:
    work = Path(temporary)
    root = work / 'source with spaces'
    root.mkdir()
    for name in ('mir.sh',):
        shutil.copy2(original / name, root / name)
    for name in ('lib', 'sh'):
        shutil.copytree(original / name, root / name)
    for name in (original / 'desktop/runtime-files.txt').read_text().splitlines():
        target = root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(original / name, target)
    commands = work / 'commands'
    commands.mkdir()
    def executable(name, text):
        path = commands / name
        path.write_text(text)
        path.chmod(0o755)
    executable('dpkg-query', '#!/usr/bin/env bash\nprintf "install ok installed"\n')
    executable('rustc', '#!/usr/bin/env bash\nprintf "rustc 1.96.1\\n"\n')
    executable('node', '#!/usr/bin/env bash\nexit 0\n')
    executable('npm', r'''#!/usr/bin/env bash
printf '%s\n' "$*" >> "$TEST_WORK/npm"
[[ ${TEST_FAIL:-0} == 0 ]] || exit 1
if [[ ${TEST_WAIT:-0} == 1 ]]; then
    printf '%s\n' "$$" > "$TEST_WORK/worker"
    trap 'printf stopped > "$TEST_WORK/stopped"; exit 143' TERM
    while true; do sleep .05; done
fi
''')
    executable('cargo', r'''#!/usr/bin/env bash
mkdir -p "$CARGO_TARGET_DIR/release"
cat > "$CARGO_TARGET_DIR/release/mir-desktop" <<'APP'
#!/usr/bin/env bash
if [[ ${1:-} == --mir-check ]]; then echo 'Mir.cpp desktop test'; exit; fi
[[ -f "$MIR_ROOT/mir.sh" ]] || exit 1
printf 'Desktop started\n'
APP
chmod +x "$CARGO_TARGET_DIR/release/mir-desktop"
mkdir -p "$CARGO_TARGET_DIR/release/bundle/macos/Mir.cpp.app/Contents/MacOS"
cp "$CARGO_TARGET_DIR/release/mir-desktop" "$CARGO_TARGET_DIR/release/bundle/macos/Mir.cpp.app/Contents/MacOS/mir-desktop"
''')
    env = {key: value for key, value in os.environ.items() if not key.startswith(('MIR_', 'SPUTNIK_', 'LLAMA_', 'XDG_'))}
    env.update(HOME=str(work / 'home'), XDG_DATA_HOME=str(work / 'data'), XDG_CACHE_HOME=str(work / 'cache'),
               XDG_CONFIG_HOME=str(work / 'config'), PATH=str(commands) + ':' + env['PATH'], TEST_WORK=str(work))
    def run(arguments=(), overrides=None):
        return subprocess.run(['bash', str(root / 'mir.sh'), *arguments], cwd='/', env=env | (overrides or {}), capture_output=True, timeout=10)
    prepared = run(['--prepare-desktop'])
    assert prepared.returncode == 0, prepared.stderr
    cache = work / 'cache/mir.cpp/desktop'
    binary_glob = '*/Mir.cpp.app/Contents/MacOS/mir-desktop' if sys.platform == 'darwin' else '*/mir-desktop'
    binaries = set(cache.glob(binary_glob))
    assert len(binaries) == 1
    calls = (work / 'npm').read_bytes()
    started = run()
    assert started.returncode == 0 and b'Desktop started' in started.stdout, started.stderr
    assert (work / 'npm').read_bytes() == calls
    print('PASS: source startup outside the repository, automatic preparation, MIR_ROOT and cache reuse')
    damaged = next(iter(binaries))
    damaged.write_text('#!/usr/bin/env bash\nexit 1\n')
    repaired = run(['--prepare-desktop'])
    assert repaired.returncode == 0, repaired.stderr
    assert subprocess.run([str(damaged), '--mir-check'], env=env, capture_output=True).returncode == 0
    print('PASS: a damaged cached executable or app bundle is replaced after successful preparation')
    with (root / 'desktop/src/main.tsx').open('a') as source:
        source.write('\n// Changed source\n')
    failed = run(['--prepare-desktop'], {'TEST_FAIL':'1'})
    assert failed.returncode != 0
    assert set(cache.glob(binary_glob)) == binaries
    assert not list(cache.glob('.prepare.*'))
    print('PASS: changed-source detection and failed preparation preserve verified builds')
    process = subprocess.Popen(['bash', str(root / 'mir.sh'), '--prepare-desktop'], cwd='/', env=env | {'TEST_WAIT':'1'},
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    deadline = time.monotonic() + 10
    while not (work / 'worker').exists() and time.monotonic() < deadline:
        if process.poll() is not None: break
        time.sleep(.02)
    assert (work / 'worker').exists(), process.communicate(timeout=5)
    worker = int((work / 'worker').read_text())
    process.send_signal(signal.SIGTERM)
    process.communicate(timeout=5)
    assert process.returncode == 143, process.returncode
    assert (work / 'stopped').exists()
    assert not list(cache.glob('.prepare.*'))
    assert set(cache.glob(binary_glob)) == binaries
    try:
        os.kill(worker, 0)
    except ProcessLookupError:
        pass
    else:
        assert Path(f'/proc/{worker}/stat').read_text().split(') ')[1].startswith('Z ')
    print('PASS: SIGTERM stops the owned compiler group and removes incomplete preparation')
    executable('ps', r'''#!/usr/bin/env bash
if [[ ${TEST_PS_RACE:-0} == 1 && ! -f "$TEST_WORK/lookup-interrupted" ]]; then
    printf interrupted > "$TEST_WORK/lookup-interrupted"
    kill -TERM "$(cat "$TEST_WORK/parent")"
    exit 1
fi
exec /bin/ps "$@"
''')
    (work / 'worker').unlink(missing_ok=True)
    process = subprocess.Popen(['bash', str(root / 'mir.sh'), '--prepare-desktop'], cwd='/', env=env | {'TEST_WAIT':'1', 'TEST_PS_RACE':'1'}, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    (work / 'parent').write_text(str(process.pid))
    process.communicate(timeout=5)
    assert process.returncode == 143, process.returncode
    assert (work / 'lookup-interrupted').exists()
    assert not list(cache.glob('.prepare.*'))
    print('PASS: interruption during initial compiler identity lookup still cleans the worker group')
    # Exercise official-download handling with local archives and real checksums.
    executable('node', '#!/usr/bin/env bash\nexit 1\n')
    executable('rustc', '#!/usr/bin/env bash\nprintf "rustc 1.60.0\\n"\n')
    executable('uname', '#!/usr/bin/env bash\nif [[ ${1:-} == -m ]]; then echo x86_64; else /usr/bin/uname -s; fi\n')
    system = 'darwin' if sys.platform == 'darwin' else 'linux'
    node_archive = work / 'node.tar.gz'
    with tarfile.open(node_archive, 'w:gz') as archive:
        for name in ('node', 'npm'):
            data = b'#!/usr/bin/env bash\nexit 0\n'
            info = tarfile.TarInfo(f'node-v24.1.0-{system}-x64/bin/' + name)
            info.mode = 0o755
            info.size = len(data)
            archive.addfile(info, io.BytesIO(data))
    node_digest = hashlib.sha256(node_archive.read_bytes()).hexdigest()
    (work / 'node-checksum').write_text(node_digest + f'  node-v24.1.0-{system}-x64.tar.gz\n')
    rust_installer = work / 'rustup-init'
    rust_installer.write_text(r'''#!/usr/bin/env bash
printf '%s\n' "$*" > "$TEST_WORK/rustup-arguments"
mkdir -p "$CARGO_HOME/bin" "$RUSTUP_HOME"
for tool in cargo rustup rustc; do
    printf '#!/usr/bin/env bash\nexit 0\n' > "$CARGO_HOME/bin/$tool"
    chmod +x "$CARGO_HOME/bin/$tool"
done
''')
    (work / 'rust-checksum').write_text(hashlib.sha256(rust_installer.read_bytes()).hexdigest() + '\n')
    executable('curl', r'''#!/usr/bin/python3
import os, pathlib, shutil, sys
args=sys.argv[1:]
url=next(a for a in args if a.startswith('https://'))
destination=pathlib.Path(args[args.index('--output')+1])
root=pathlib.Path(os.environ['TEST_WORK'])
if url.endswith('SHASUMS256.txt'):
    text=(root/'node-checksum').read_text()
    if os.environ.get('TEST_BAD_NODE'): text='0'*64+'  '+text.split()[1]+'\n'
    destination.write_text(text)
elif url.endswith(('-linux-x64.tar.gz', '-darwin-x64.tar.gz')): shutil.copyfile(root/'node.tar.gz',destination)
elif url.endswith('/rustup-init.sha256'):
    destination.write_text('0'*64+'\n' if os.environ.get('TEST_BAD_RUST') else (root/'rust-checksum').read_text())
elif url.endswith('/rustup-init'): shutil.copyfile(root/'rustup-init',destination)
else: sys.exit('Unexpected toolchain URL: '+url)
''')
    toolkit = 'MIR_ROOT=$1; source "$1/lib/platform.sh"; load_platform "$(if [[ $(uname -s) == Darwin ]]; then echo macos; else echo linux; fi)"; source "$1/lib/bootstrap.sh"; fail() { printf "%s\\n" "$*" >&2; exit 1; }; desktop_toolchains "$2"; [[ $(command -v node) == "$2/node/bin/node" && $(command -v cargo) == "$2/rust/cargo/bin/cargo" ]]'
    tools = work / 'private tools'
    result = subprocess.run(['bash','-euo','pipefail','-c',toolkit,'test',str(root),str(tools)],env=env,capture_output=True,timeout=10)
    assert result.returncode == 0, result.stderr
    assert '--no-modify-path --profile minimal' in (work/'rustup-arguments').read_text()
    for flag in ('TEST_BAD_NODE','TEST_BAD_RUST'):
        destination = work / flag
        result = subprocess.run(['bash','-euo','pipefail','-c',toolkit,'test',str(root),str(destination)],env=env|{flag:'1'},capture_output=True,timeout=10)
        assert result.returncode != 0
        assert b'checksum failed' in result.stderr
        assert not (destination/'rust/cargo/bin/cargo').exists()
    print('PASS: private Node/Rust preparation, official URL selection, checksum rejection and unchanged shell configuration')
PY
