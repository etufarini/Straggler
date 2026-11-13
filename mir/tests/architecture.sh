#!/usr/bin/env bash
# Enforce platform boundaries and startup without the other OS's files.
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
manifests = {}
for name in ('runtime-files.txt', 'runtime-files.linux.txt', 'runtime-files.macos.txt'):
    lines = (root/'desktop'/name).read_text().splitlines()
    assert len(lines) == len(set(lines)), f'Duplicate runtime files: {name}'
    assert all(line.startswith('desktop/') and '..' not in Path(line).parts for line in lines), name
    manifests[name] = set(lines)
manifest = set().union(*manifests.values())
assert len(manifest) == sum(map(len, manifests.values())), 'Overlapping desktop manifests'
for name in manifest:
    assert (root/name).is_file(), f'Missing runtime file: {name}'
required = set()
required.update(str(file.relative_to(root)) for file in (root/'desktop/src-tauri').glob('tauri*.conf.json'))
for directory in ('src', 'src-tauri/src', 'src-tauri/icons', 'src-tauri/capabilities'):
    required.update(str(file.relative_to(root)) for file in (root/'desktop'/directory).rglob('*') if file.is_file())
assert not required - manifest, f'Unpackaged desktop sources: {sorted(required - manifest)}'
print('PASS: disjoint common/Linux/macOS manifests include every desktop source and resource')
# Shared features must depend on services, not platform implementations.
for file in [root/'sh/install-core.sh', *sorted((root/'lib').glob('*.sh'))]:
    if file.name in ('runtime.sh', 'platform.sh'):
        continue
    text = file.read_text()
    assert not re.search(r'\bis_macos\b|\bDarwin\b|\bHomebrew\b|/proc/|\b(?:gfind|gmv|gtimeout|netstat|lsof|xdg-open)\b', text), file
for platform, system, other, tools in (
    ('linux', 'Linux', 'macos', 'curl ss'),
    ('macos', 'Darwin', 'linux', 'curl gmv lsof netstat'),
):
    with tempfile.TemporaryDirectory(prefix='mir-architecture-') as temporary:
        work = Path(temporary)
        (work/'lib/platform').mkdir(parents=True)
        for source in (root/'lib').glob('*.sh'):
            (work/'lib'/source.name).symlink_to(source)
        (work/f'lib/platform/{platform}.sh').symlink_to(root/f'lib/platform/{platform}.sh')
        if platform == 'macos':
            (work/'lib/platform/macos-bootstrap.sh').symlink_to(root/'lib/platform/macos-bootstrap.sh')
        # Use a private Homebrew prefix even when the host happens to have Homebrew.
        (work/'bin').mkdir()
        brew = work/'bin/brew'
        brew.write_text('#!/bin/sh\nprintf called >> "$TEST_PREFIX/brew-calls"\nprintf "%s\\n" "$TEST_PREFIX"\n')
        brew.chmod(0o755)
        environment = os.environ | {'TEST_PREFIX': str(work), 'PATH': str(work/'bin') + ':' + os.environ['PATH']}
        command = '''source "$1/lib/runtime.sh"
source "$1/lib/platform.sh"
uname() { printf '%s\\n' "$TEST_SYSTEM"; }
MIR_ROOT=$1
configure_runtime
[[ "$PLATFORM_ID" == "$2" && "$RUNTIME_BASH" == "$BASH" ]]
load_platform "$PLATFORM_ID"
source "$1/lib/config.sh"
source "$1/lib/paths.sh"
source "$1/lib/processes.sh"
source "$1/lib/server.sh"
platform_required_tools
[[ ${REQUIRED_TOOLS[*]} == "$4" ]]
load_platform "$2"
if load_platform "$3"; then exit 1; fi
[[ "$PLATFORM_LOADED" == "$2" ]]
if load_platform '../unexpected'; then exit 1; fi
uname() { printf 'Unsupported-test-OS\\n'; }
if configure_runtime check; then exit 1; fi
'''
        result = subprocess.run(['bash','-euo','pipefail','-c',command,'test',str(work),platform,other,tools],
                                capture_output=True,text=True,timeout=5,env=environment | {'TEST_SYSTEM': system})
        assert result.returncode == 0, (result.stdout,result.stderr)
        if platform == 'linux':
            assert not (work/'brew-calls').exists(), 'Linux startup invoked Homebrew'
print('PASS: shared shell modules load with only the selected platform present, on either host')
PY
"$BASH" "$TEST_ROOT/sh/build-install.sh" --check
