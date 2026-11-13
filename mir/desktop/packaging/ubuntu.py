#!/usr/bin/env python3
"""Build a native Ubuntu 24.04+ Debian package with the pinned CPU backend."""

import argparse
import json
import os
from pathlib import Path
import platform
import struct
import subprocess
import tarfile
import tempfile

import backend


PACKAGING = Path(__file__).resolve().parent
DESKTOP = PACKAGING.parent
MACHINES = {"x86_64-unknown-linux-gnu": 62, "aarch64-unknown-linux-gnu": 183}
SYSTEM_LIBRARIES = {
    "libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
    "libstdc++.so.6", "libgcc_s.so.1", "libgomp.so.1",
    "ld-linux-x86-64.so.2", "ld-linux-aarch64.so.1",
    "libssl.so.3", "libcrypto.so.3",
}
INSTALL_BACKEND = "usr/lib/mir.cpp/backend"
DOCUMENTS = {name: "copyright" if name == "LICENSE.Mir.cpp" else name
             for name in backend.BUNDLE_RESOURCES}


def elf_dependencies(binary, machine):
    """Read ELF64 dynamic dependencies without executing downloaded programs."""
    if len(binary) < 64 or binary[:7] != b"\x7fELF\x02\x01\x01":
        raise ValueError("Expected a little-endian ELF64 backend")
    header = struct.unpack_from("<16sHHIQQQIHHHHHH", binary)
    if header[2] != machine or header[1] not in (2, 3):
        raise ValueError("The backend does not match the selected Linux architecture")
    offset, entry_size, count = header[5], header[9], header[10]
    if entry_size != 56 or not count or offset + entry_size * count > len(binary):
        raise ValueError("Invalid ELF program headers")
    loads, dynamic = [], None
    for index in range(count):
        kind, _, start, address, _, size, _, _ = struct.unpack_from(
            "<IIQQQQQQ", binary, offset + index * entry_size)
        if start + size > len(binary):
            raise ValueError("Truncated ELF segment")
        if kind == 1:
            loads.append((start, address, size))
        elif kind == 2:
            if dynamic is not None:
                raise ValueError("Duplicate ELF dynamic segment")
            dynamic = (start, size)
    if dynamic is None or dynamic[1] % 16:
        raise ValueError("Missing or invalid ELF dynamic segment")
    strings, length, needed, terminated = None, None, [], False
    for index in range(dynamic[0], sum(dynamic), 16):
        tag, value = struct.unpack_from("<qQ", binary, index)
        if tag == 0:
            terminated = True
            break
        if tag == 1:
            needed.append(value)
        elif tag == 5:
            strings = value
        elif tag == 10:
            length = value
    if not terminated or strings is None or length is None:
        raise ValueError("Invalid ELF string table")
    for start, address, size in loads:
        if address <= strings and strings + length <= address + size:
            table = binary[start + strings - address:start + strings - address + length]
            break
    else:
        raise ValueError("ELF string table is outside its load segments")
    result = []
    for index in needed:
        end = table.find(b"\0", index)
        if index >= len(table) or end < 0:
            raise ValueError("Invalid ELF dependency name")
        name = table[index:end].decode("ascii")
        if not name or "/" in name:
            raise ValueError("An ELF dependency refers to an external installation")
        result.append(name)
    return result


def copy_backend(source, stage, target, manifest):
    destination = stage / "backend"
    destination.mkdir()
    with tarfile.open(source, "r:gz") as package:
        archive = backend.BackendArchive(package, "llama-" + manifest["tag"])
        # CPU variants and RPC are discovered with dlopen, not DT_NEEDED.
        pending = ["llama-server", "libllama-server-impl.so"]
        pending += [name for name in archive.members
                    if name.startswith("libggml-") and name.endswith(".so")]
        copied = set()
        while pending:
            name = pending.pop()
            if name in copied:
                continue
            copied.add(name)
            binary = archive.read(name)
            for dependency in elf_dependencies(binary, MACHINES[target]):
                if dependency in archive.members:
                    pending.append(dependency)
                elif dependency not in SYSTEM_LIBRARIES:
                    raise ValueError(f"Unsupported backend dependency: {dependency}")
            output = destination / name
            output.write_bytes(binary)
            output.chmod(0o755)
        (stage / "LICENSE.llama.cpp").write_bytes(archive.read("LICENSE"))


def prepare(target, archive_path=None):
    def populate(source, stage, destination, manifest):
        copy_backend(source, stage, target, manifest)
        files = {"/" + INSTALL_BACKEND: str(destination / "backend")}
        files.update({"/usr/share/doc/mir-cpp/" + installed: str(destination / source)
                      for source, installed in DOCUMENTS.items()})
        config = {"bundle": {
            "targets": ["deb"],
            "linux": {"deb": {
                "depends": ["libc6 (>= 2.39)", "libstdc++6", "libgomp1", "libssl3t64 | libssl3"],
                "files": files,
            }},
        }}
        (stage / "tauri.ubuntu.json").write_text(json.dumps(config, indent=2) + "\n")
    return backend.prepare_backend(PACKAGING, target, archive_path, populate)


def verify_package(package, prepared, target):
    """Check the actual package payload and loaders in an isolated user directory."""
    with tempfile.TemporaryDirectory(prefix="mir-deb-check-") as temporary:
        root = Path(temporary)
        subprocess.run(["dpkg-deb", "--extract", str(package), str(root)], check=True)
        installed = root / INSTALL_BACKEND
        for source in (prepared / "backend").iterdir():
            output = installed / source.name
            if output.is_symlink() or not output.is_file() or output.read_bytes() != source.read_bytes():
                raise ValueError(f"Incorrect packaged backend: {source.name}")
        for name, installed_name in DOCUMENTS.items():
            if (root / "usr/share/doc/mir-cpp" / installed_name).read_bytes() != (prepared / name).read_bytes():
                raise ValueError(f"Incorrect packaged resource: {name}")
        executable = root / "usr/bin/mir-desktop"
        if (root / "usr/bin/mir").exists():
            raise ValueError("The package must not install the removed mir launcher")
        entries = list((root / "usr/share/applications").glob("*.desktop"))
        if not any(line == "Exec=mir-desktop" or line.startswith("Exec=mir-desktop ")
                   for entry in entries for line in entry.read_text().splitlines()):
            raise ValueError("The application menu must launch mir-desktop")
        environment = {key: value for key, value in os.environ.items()
                       if not key.startswith(("MIR_", "LLAMA_", "LD_", "XDG_"))}
        environment.update(HOME=str(root), PATH="/usr/bin:/bin",
                           XDG_CONFIG_HOME=str(root / "config"), XDG_DATA_HOME=str(root / "data"))
        for binary in [executable, *installed.iterdir()]:
            result = subprocess.run(["ldd", str(binary)], env=environment, capture_output=True, text=True, check=True)
            if "not found" in result.stdout:
                raise ValueError(f"Unresolved dependency in {binary.name}: {result.stdout}")
        subprocess.run([str(executable), "--mir-check"], env=environment, check=True, timeout=20)
        for flag in ("--version", "--help"):
            result = subprocess.run([str(installed / "llama-server"), flag], env=environment,
                                    capture_output=True, text=True, check=True, timeout=30)
            if flag == "--version":
                manifest = json.loads((prepared / "backend-provenance.json").read_text())
                if manifest["commit"][:7] not in result.stdout + result.stderr:
                    raise ValueError("The packaged backend does not report the pinned source commit")
        print(f"Verified {target} package, resources, dynamic loaders and backend version/help: {package}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "bundle"))
    parser.add_argument("--target", choices=tuple(MACHINES), required=True)
    parser.add_argument("--archive", type=Path)
    args = parser.parse_args()
    if args.action == "bundle":
        expected = "x86_64" if args.target.startswith("x86_64") else "aarch64"
        if platform.system() != "Linux" or platform.machine() != expected:
            parser.error("Build and verify the Debian package on Linux with the matching architecture")
    prepared = prepare(args.target, args.archive)
    if args.action == "prepare":
        print(f"Verified backend prepared at {prepared}")
        return
    for binary in sorted((prepared / "backend").iterdir()):
        subprocess.run(["patchelf", "--set-rpath", "$ORIGIN", str(binary)], check=True)
    build = PACKAGING / "generated/build-ubuntu"
    environment = dict(os.environ, CARGO_TARGET_DIR=str(build))
    subprocess.run(["npm", "exec", "--", "tauri", "build", "--target", args.target,
                    "--config", str(prepared / "tauri.ubuntu.json")], cwd=DESKTOP, env=environment, check=True)
    packages = list((build / args.target / "release/bundle/deb").glob("*.deb"))
    if len(packages) != 1:
        raise ValueError("Expected exactly one Debian package; clean the previous package output first")
    verify_package(packages[0], prepared, args.target)


if __name__ == "__main__":
    main()
