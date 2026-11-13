"""Check developer-suite boundaries with unrelated tools absent."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
with tempfile.TemporaryDirectory(prefix='mir-runner-') as temporary:
    work = Path(temporary)
    commands = work/'bin'
    commands.mkdir()
    interpreter = commands/'bash'
    interpreter.symlink_to(shutil.which('bash'))
    for name in ('dirname', 'uname'):
        (commands/name).symlink_to(shutil.which(name))
    (commands/'python3').symlink_to(sys.executable)
    for name in ('npm', 'cargo'):
        executable = commands/name
        executable.write_text('''#!/bin/sh
printf '%s\n' "$*" >> "$TEST_TOOL_LOG"
''')
        executable.chmod(0o755)
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    environment.update(HOME=str(work), PATH=str(commands),
                       TEST_TOOL_LOG=str(work/'commands'))
    for suite, forbidden in (('frontend', 'cargo'), ('browser', 'cargo'), ('runtime', 'npm')):
        (commands/forbidden).rename(work/forbidden)
        result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), suite],
                                env=environment, cwd=work,
                                capture_output=True, text=True, timeout=15)
        assert result.returncode == 0, (suite, result.stdout, result.stderr)
        assert (work/'commands').is_file(), f'{suite} did not run checks'
        assert (work/'commands').read_text().strip(), f'{suite} did not run checks'
        (work/'commands').unlink()
        (work/forbidden).rename(commands/forbidden)
    result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), 'unknown-suite'],
                            env=environment, capture_output=True, text=True, timeout=5)
    assert result.returncode != 0 and 'Usage:' in result.stderr
    assert not (work/'commands').exists()

    result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), 'frontend', 'extra'],
                            env=environment, capture_output=True, text=True, timeout=5)
    assert result.returncode != 0 and 'Expected at most one suite' in result.stderr
    assert not (work/'commands').exists()

    # Exercise Linux display dispatch on either host without a compositor or Xvfb.
    uname = commands/'uname'
    uname.unlink()
    uname.write_text('#!/bin/sh\nprintf "Linux\\n"\n')
    uname.chmod(0o755)
    headless = environment | {'DISPLAY': '', 'WAYLAND_DISPLAY': ''}
    result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), 'native'],
                            env=headless, capture_output=True, text=True, timeout=5)
    assert result.returncode != 0 and 'graphical session' in result.stderr, result.stderr
    assert not (work/'commands').exists()
    display_tools = {
        'xvfb-run': '#!/bin/sh\nshift\nexec "$@"\n',
        'dbus-run-session': '''#!/bin/sh
[ "$1" = -- ] || exit 99
[ "$LIBGL_ALWAYS_SOFTWARE" = 1 ] && [ "$WEBKIT_DISABLE_COMPOSITING_MODE" = 1 ] || exit 99
printf 'virtual display and private bus\n' >> "$TEST_TOOL_LOG"
''',
    }
    for name, body in display_tools.items():
        executable = commands/name
        executable.write_text(body)
        executable.chmod(0o755)
    result = subprocess.run([str(interpreter), str(root/'tests/run.sh'), 'native'],
                            env=headless, capture_output=True, text=True, timeout=5)
    assert result.returncode == 0, result.stderr
    assert (work/'commands').read_text().strip() == 'virtual display and private bus'
print('PASS: frontend/browser checks need no Rust, runtime checks need no npm; invalid suites fail')
print('PASS: headless native checks require display tools and request software rendering')
