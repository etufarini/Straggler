"""Compile the actual desktop with only shared and host-platform native inputs."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile


desktop = Path(__file__).resolve().parents[1]
platform = {'linux': 'linux', 'darwin': 'macos'}[sys.platform]
other_platform = 'macos' if platform == 'linux' else 'linux'
with tempfile.TemporaryDirectory(prefix='straggler-desktop-isolation-') as temporary:
    work = Path(temporary)
    native = work/'src-tauri'
    native.mkdir()
    for name in ('Cargo.toml', 'Cargo.lock', 'build.rs', 'tauri.conf.json',
                 f'tauri.{platform}.conf.json'):
        shutil.copyfile(desktop/'src-tauri'/name, native/name)
    for name in ('src', 'icons', 'capabilities'):
        shutil.copytree(desktop/'src-tauri'/name, native/name)
    # Rust selects the host service at compile time; the opposite module is absent.
    (native/'src/platform'/f'{other_platform}.rs').unlink()
    (work/'packaging').mkdir()
    shutil.copyfile(desktop/'packaging/llama-runtime.json', work/'packaging/llama-runtime.json')
    home = work/'home'
    home.mkdir()
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith(('STRAGGLER_', 'MIR_', 'LLAMA_', 'XDG_'))}
    # Reuse developer tool caches while isolating application directories.
    environment.update(
        HOME=str(home),
        CARGO_HOME=os.environ.get('CARGO_HOME', str(Path.home()/'.cargo')),
        RUSTUP_HOME=os.environ.get('RUSTUP_HOME', str(Path.home()/'.rustup')),
        CARGO_TARGET_DIR=str(desktop/'src-tauri/target'),
    )
    command = ['cargo', 'check', '--locked', '--manifest-path', str(native/'Cargo.toml')]
    subprocess.run(command, env=environment, cwd=work, check=True)
    if platform == 'macos':
        subprocess.run(command + ['--features', 'app-store'], env=environment, cwd=work, check=True)
print(f'PASS: actual {platform} desktop compiles without opposite-platform sources or configuration')
