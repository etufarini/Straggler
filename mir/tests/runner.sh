#!/usr/bin/env bash
# Suite boundaries must keep unrelated developer tools out of local work.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(sys.argv[1]).resolve()
with tempfile.TemporaryDirectory(prefix='mir-runner-') as temporary:
    work = Path(temporary)
    commands = work/'bin'
    commands.mkdir()
    # The runner prepends its interpreter directory so tests use a private Bash path.
    interpreter = commands/'bash'
    interpreter.symlink_to(shutil.which('bash'))
    for name in ('npm', 'cargo'):
        executable = commands/name
        executable.write_text('''#!/bin/sh
if [ "${0##*/}" = "$TEST_FORBIDDEN_TOOL" ]; then
    printf 'Unexpected tool: %s\n' "$0" >&2
    exit 99
fi
printf '%s\n' "$*" >> "$TEST_TOOL_LOG"
''')
        executable.chmod(0o755)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    environment.update(HOME=str(work), PATH=str(commands) + ':' + os.environ['PATH'],
                       TEST_TOOL_LOG=str(work/'commands'))
    for suite, forbidden in (('frontend', 'cargo'), ('browser', 'cargo'), ('runtime', 'npm')):
        result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), suite],
                                env=environment | {'TEST_FORBIDDEN_TOOL': forbidden}, cwd=work,
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, (suite, result.stdout, result.stderr)
        assert (work/'commands').is_file(), f'{suite} did not run checks'
        assert (work/'commands').read_text().strip(), f'{suite} did not run checks'
        (work/'commands').unlink()
    result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), 'unknown-suite'],
                            env=environment, capture_output=True, text=True, timeout=5)
    assert result.returncode != 0 and 'Usage:' in result.stderr
    assert not (work/'commands').exists()
print('PASS: frontend/browser checks need no Rust, runtime checks need no npm; invalid suites fail')
PY
