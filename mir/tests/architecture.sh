#!/usr/bin/env bash
# Enforce the platform boundary and Linux startup without any macOS files.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
# Installed source builds need every frontend/native module, not just the files
# that happened to exist when the extraction manifest was first written.
manifest_lines = (root/'desktop/runtime-files.txt').read_text().splitlines()
manifest = set(manifest_lines)
assert len(manifest) == len(manifest_lines), 'Duplicate desktop runtime files'
for name in manifest:
    assert (root/name).is_file(), f'Missing runtime file: {name}'
required = set()
for directory in ('src', 'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities'):
    required.update(str(file.relative_to(root)) for file in (root/'desktop'/directory).rglob('*') if file.is_file())
assert not required - manifest, f'Unpackaged desktop sources: {sorted(required - manifest)}'
print('PASS: desktop runtime manifest includes every frontend/native source and resource')
# Shared features must depend on services, not platform implementations.
for file in [root/'sh/install-core.sh', *sorted((root/'lib').glob('*.sh'))]:
    if file.name in ('runtime.sh', 'platform.sh'):
        continue
    text = file.read_text()
    assert not re.search(r'\bis_macos\b|\bDarwin\b|\bHomebrew\b|/proc/|\b(?:gfind|gmv|gtimeout|netstat|lsof|xdg-open)\b', text), file
with tempfile.TemporaryDirectory(prefix='mir-architecture-') as temporary:
    work = Path(temporary)
    (work/'lib/platform').mkdir(parents=True)
    for source in (root/'lib').glob('*.sh'):
        (work/'lib'/source.name).symlink_to(source)
    (work/'lib/platform/linux.sh').symlink_to(root/'lib/platform/linux.sh')
    # Omit macOS files so accidental imports fail.
    command = '''source "$1/lib/runtime.sh"
source "$1/lib/platform.sh"
uname() { printf 'Linux\\n'; }
brew() { printf 'Unexpected Homebrew invocation\\n' >&2; exit 99; }
MIR_ROOT=$1
configure_runtime
[[ "$PLATFORM_ID" == linux && "$RUNTIME_BASH" == "$BASH" ]]
load_platform "$PLATFORM_ID"
source "$1/lib/config.sh"
source "$1/lib/paths.sh"
source "$1/lib/processes.sh"
source "$1/lib/server.sh"
platform_required_tools
[[ ${REQUIRED_TOOLS[*]} == 'curl ss' ]]
load_platform linux
if load_platform macos; then exit 1; fi
[[ "$PLATFORM_LOADED" == linux ]]
if load_platform '../unexpected'; then exit 1; fi
uname() { printf 'Unsupported-test-OS\\n'; }
if configure_runtime check; then exit 1; fi
'''
    result = subprocess.run(['bash','-euo','pipefail','-c',command,'test',str(work)],
                            capture_output=True,text=True,timeout=5,env=os.environ)
    assert result.returncode == 0, (result.stdout,result.stderr)
print('PASS: OS-free shared modules, explicit test imports, Linux-only checkout and adapter isolation')
PY
"$BASH" "$TEST_ROOT/sh/build-install.sh" --check
