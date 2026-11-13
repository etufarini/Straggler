#!/usr/bin/env bash
# Compile the actual desktop using only common and host-platform runtime files.
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
platform = {'linux': 'linux', 'darwin': 'macos'}[sys.platform]
sources = subprocess.check_output(
    [sys.executable, str(root/'lib/desktop.py'), 'sources', str(root), platform], text=True,
).splitlines()
with tempfile.TemporaryDirectory(prefix='mir-desktop-isolation-') as temporary:
    work = Path(temporary)
    for name in sources:
        destination = work/name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(root/name, destination)
    home = work/'home'
    home.mkdir()
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('MIR_', 'LLAMA_', 'XDG_'))}
    # Reuse developer tool caches, while keeping application directories isolated.
    environment.update(
        HOME=str(home),
        CARGO_HOME=os.environ.get('CARGO_HOME', str(Path.home()/'.cargo')),
        RUSTUP_HOME=os.environ.get('RUSTUP_HOME', str(Path.home()/'.rustup')),
        CARGO_TARGET_DIR=str(root/'desktop/src-tauri/target'),
    )
    command = ['cargo', 'check', '--locked', '--manifest-path', str(work/'desktop/src-tauri/Cargo.toml')]
    subprocess.run(command, env=environment, cwd=work, check=True)
    if platform == 'macos':
        subprocess.run(command + ['--features', 'app-store'], env=environment, cwd=work, check=True)
print(f'PASS: actual {platform} desktop compiles without opposite-platform sources or configuration')
PY
