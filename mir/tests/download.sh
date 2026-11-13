#!/usr/bin/env bash
# Opt-in network smoke check of the published README command; uses an isolated HOME.
set -euo pipefail
TEST_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
python3 -I - "$TEST_ROOT" <<'PY'
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

readme = (Path(sys.argv[1]).parent / 'README.md').read_text()
match = re.search(r'https://raw\.githubusercontent\.com/etufarini/Mir\.cpp/v\d+\.\d+\.\d+/mir/sh/install\.sh', readme)
assert match, 'README must pin the installer to a release tag'
url = match.group()
with tempfile.TemporaryDirectory(prefix='mir-download-') as temporary:
    home = Path(temporary) / 'home with spaces'
    home.mkdir()
    env = {key: value for key, value in os.environ.items()
           if not key.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    env['HOME'] = str(home)
    config = home / '.config/mir.cpp'
    (config / 'profiles').mkdir(parents=True)
    (config / 'paths.conf').write_text('personal paths\n')
    (config / 'profiles/Personal.conf').write_text('personal profile\n')
    install_dir = home / '.local/share/mir.cpp'
    command = home / '.local/bin/mir'
    previous = None
    for action in ('install', 'update'):
        # A successful Bash exit can hide a failed download; check both processes.
        with subprocess.Popen(['curl', '-fsSL', '--connect-timeout', '15', '--max-time', '60', url],
                              stdout=subprocess.PIPE, env=env) as download:
            result = subprocess.run(['bash'], stdin=download.stdout, env=env, cwd='/',
                                    capture_output=True, timeout=240)
            download.stdout.close()
            assert download.wait(timeout=10) == 0, 'Installer download failed'
        assert result.returncode == 0, (result.stdout, result.stderr)
        assert b'Installation complete' in result.stdout
        assert command.is_file() and os.access(command, os.X_OK)
        assert command.read_text().splitlines()[1] == '# Mir.cpp managed launcher'
        active = (install_dir / 'current').resolve(strict=True)
        assert active != previous
        assert len(list((install_dir / 'releases').glob('install.*'))) == 1
        assert previous is None or not previous.exists()
        for name in ('mir.sh', 'lib/config.sh', 'lib/desktop.sh', 'mir/docs/guide.md'):
            assert (active / name).is_file(), name
        assert (config / 'paths.conf').read_text() == 'personal paths\n'
        assert (config / 'profiles/Personal.conf').read_text() == 'personal profile\n'
        previous = active
        print(f'PASS: live curl | bash {action}, installed files and preserved settings', flush=True)
    # The published installer may lag behind this checkout.
    if (active / 'sh/uninstall.sh').is_file():
        result = subprocess.run([str(command), '--uninstall', '--yes'], env=env, cwd='/',
                                capture_output=True, timeout=10)
        assert result.returncode == 0, (result.stdout, result.stderr)
        assert not command.exists() and not active.exists()
        assert (config / 'profiles/Personal.conf').read_text() == 'personal profile\n'
        print('PASS: published uninstall command and preserved settings')
    else:
        print('NOTE: published release does not include --uninstall; local integration tests cover it')
PY
