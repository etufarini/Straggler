#!/usr/bin/env python3
"""Prepare a pinned upstream backend and build a local macOS packaging check.

Python is a build tool here. Neither the resulting app nor its helper uses it.
"""

import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import plistlib
import shutil
import struct
import subprocess
import tarfile
import tempfile
import urllib.request


PACKAGING = Path(__file__).resolve().parent
DESKTOP = PACKAGING.parent
PRODUCT = "Mir.cpp Backend Check"
CPU_TYPES = {"aarch64-apple-darwin": 0x100000C, "x86_64-apple-darwin": 0x1000007}


def macho_dependencies(binary, cpu_type):
    """Read load commands without executing downloaded code or requiring a Mac."""
    if len(binary) < 32:
        raise ValueError("Truncated Mach-O header")
    magic, architecture, _, _, count, size, _, _ = struct.unpack_from("<8I", binary)
    if magic != 0xFEEDFACF or architecture != cpu_type:
        raise ValueError("The backend does not match the selected macOS architecture")
    end = 32 + size
    if end > len(binary) or count > size // 8:
        raise ValueError("Invalid Mach-O load commands")
    dependencies = []
    offset = 32
    for _ in range(count):
        if offset + 8 > end:
            raise ValueError("Truncated Mach-O load command")
        command, length = struct.unpack_from("<II", binary, offset)
        if length < 8 or offset + length > end:
            raise ValueError("Invalid Mach-O command length")
        if command in (0xC, 0x80000018, 0x8000001F, 0x20, 0x80000023):
            if length < 24:
                raise ValueError("Truncated Mach-O library command")
            name_offset = struct.unpack_from("<I", binary, offset + 8)[0]
            if not 24 <= name_offset < length:
                raise ValueError("Invalid Mach-O library name")
            name = binary[offset + name_offset:offset + length].split(b"\0", 1)[0]
            dependencies.append(name.decode("utf-8"))
        offset += length
    if offset != end:
        raise ValueError("Inconsistent Mach-O load commands")
    return dependencies


class BackendArchive:
    """Read only flat release members; never extract archive paths or links."""

    def __init__(self, archive, prefix):
        self.archive = archive
        self.members = {}
        total = 0
        for member in archive.getmembers():
            path = PurePosixPath(member.name)
            if path.parts == (prefix,) and member.isdir():
                continue
            if len(path.parts) != 2 or path.parts[0] != prefix or path.name in (".", ".."):
                raise ValueError("Unexpected path in the backend archive")
            if not (member.isfile() or member.issym()):
                raise ValueError("Unexpected file type in the backend archive")
            if member.issym() and ("/" in member.linkname or member.linkname in ("", ".", "..")):
                raise ValueError("Unsafe backend library link")
            if path.name in self.members:
                raise ValueError("Duplicate backend archive member")
            total += member.size
            if member.size > 256 * 1024 * 1024 or total > 1024 * 1024 * 1024:
                raise ValueError("Backend archive exceeds the preparation size limit")
            self.members[path.name] = member

    def read(self, name):
        visited = set()
        while True:
            if name in visited:
                raise ValueError("Cyclic backend library link")
            visited.add(name)
            member = self.members.get(name)
            if member is None:
                raise ValueError(f"Missing backend archive member: {name}")
            if not member.issym():
                with self.archive.extractfile(member) as source:
                    return source.read()
            name = member.linkname


def copy_backend(archive_path, stage, target, manifest):
    libraries = stage / "libraries"
    libraries.mkdir()
    with tarfile.open(archive_path, "r:gz") as package:
        archive = BackendArchive(package, "llama-" + manifest["tag"])
        pending = ["llama-server"]
        copied = set()
        while pending:
            name = pending.pop()
            if name in copied:
                continue
            copied.add(name)
            binary = archive.read(name)
            for dependency in macho_dependencies(binary, CPU_TYPES[target]):
                if dependency.startswith("@rpath/"):
                    dependency_name = dependency.removeprefix("@rpath/")
                    if "/" in dependency_name or not dependency_name.endswith(".dylib"):
                        raise ValueError(f"Unsupported backend dependency: {dependency}")
                    pending.append(dependency_name)
                elif not dependency.startswith(("/usr/lib/", "/System/Library/")):
                    raise ValueError(f"Backend depends on an external installation: {dependency}")
            destination = (stage / f"mir-llama-server-{target}" if name == "llama-server"
                           else libraries / name)
            destination.write_bytes(binary)
            destination.chmod(0o755)
        (stage / "LICENSE.llama.cpp").write_bytes(archive.read("LICENSE"))


def prepare(target, archive_path=None):
    manifest = json.loads((PACKAGING / "llama-runtime.json").read_text())
    artifact = manifest["artifacts"][target]
    url = (f"https://github.com/{manifest['repository']}/releases/download/"
           f"{manifest['tag']}/{artifact['name']}")
    generated = PACKAGING / "generated"
    generated.mkdir(exist_ok=True)
    destination = generated / target
    # Serialize replacement so a failed download never destroys a prepared backend.
    with (generated / ".prepare.lock").open("w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        with tempfile.TemporaryDirectory(prefix=".backend-", dir=generated) as temporary:
            work = Path(temporary)
            source = Path(archive_path) if archive_path else work / artifact["name"]
            if not archive_path:
                print(f"Downloading {url}", flush=True)
                with urllib.request.urlopen(url, timeout=60) as response, source.open("wb") as output:
                    shutil.copyfileobj(response, output)
            checksum = hashlib.sha256()
            with source.open("rb") as contents:
                for chunk in iter(lambda: contents.read(1024 * 1024), b""):
                    checksum.update(chunk)
            digest = checksum.hexdigest()
            if digest != artifact["sha256"]:
                raise ValueError("Backend archive SHA-256 does not match llama-runtime.json")
            stage = work / "prepared"
            stage.mkdir()
            copy_backend(source, stage, target, manifest)
            provenance = {key: manifest[key] for key in ("repository", "tag", "commit", "purpose")}
            provenance.update(target=target, archive=artifact["name"], sha256=digest, url=url)
            (stage / "backend-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
            config = {
                "productName": PRODUCT,
                "identifier": "io.github.etufarini.mir.packaging-check",
                "app": {"windows": []},
                "bundle": {
                    "targets": ["app"],
                    "resources": [str(destination / "LICENSE.llama.cpp"),
                                  str(destination / "backend-provenance.json")],
                    "externalBin": [str(destination / "mir-llama-server")],
                    "macOS": {
                        "minimumSystemVersion": "13.5",
                        "frameworks": [str(destination / "libraries" / p.name)
                                       for p in sorted((stage / "libraries").iterdir())],
                        "entitlements": str(PACKAGING / "app.entitlements.plist"),
                    },
                },
            }
            (stage / "tauri.backend-check.json").write_text(json.dumps(config, indent=2) + "\n")
            previous = generated / (target + ".previous")
            if previous.exists():
                raise ValueError(f"Recover the interrupted preparation before retrying: {previous}")
            if destination.exists():
                destination.rename(previous)
            try:
                stage.rename(destination)
            except OSError:
                if previous.exists():
                    previous.rename(destination)
                raise
            if previous.exists():
                shutil.rmtree(previous)
    return destination


def run(*arguments, **kwargs):
    subprocess.run(arguments, check=True, **kwargs)


def sign_bundle(app, identity):
    contents = app / "Contents"
    # The upstream executables use @loader_path; their libraries live in Frameworks.
    helper = contents / "MacOS/mir-llama-server"
    run("install_name_tool", "-add_rpath", "@executable_path/../Frameworks", str(helper))
    for library in sorted((contents / "Frameworks").glob("*.dylib")):
        run("codesign", "--force", "--sign", identity, str(library))
    run("codesign", "--force", "--sign", identity, "--options", "runtime", "--entitlements",
        str(PACKAGING / "helper.entitlements.plist"), str(helper))
    run("codesign", "--force", "--sign", identity, "--options", "runtime", "--entitlements",
        str(PACKAGING / "app.entitlements.plist"), str(app))
    run("codesign", "--verify", "--deep", "--strict", str(app))
    entitlements = subprocess.check_output(["codesign", "--display", "--entitlements", ":-", str(helper)])
    if plistlib.loads(entitlements) != plistlib.loads((PACKAGING / "helper.entitlements.plist").read_bytes()):
        raise ValueError("The signed helper has unexpected sandbox entitlements")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "bundle"))
    parser.add_argument("--target", choices=tuple(CPU_TYPES), required=True)
    parser.add_argument("--archive", type=Path, help="Use a local archive; still verify the pinned SHA-256")
    parser.add_argument("--signing-identity", default="-", help="Default: local ad hoc signature, not distribution")
    args = parser.parse_args()
    if args.action == "bundle" and platform.system() != "Darwin":
        parser.error("Building and signing the macOS bundle requires a Mac")
    prepared = prepare(args.target, args.archive)
    if args.action == "bundle":
        build = PACKAGING / "generated/build"
        environment = dict(os.environ, CARGO_TARGET_DIR=str(build))
        run("npm", "exec", "--", "tauri", "build", "--target", args.target,
            "--features", "packaging-probe", "--config", str(prepared / "tauri.backend-check.json"),
            "--no-sign", cwd=DESKTOP, env=environment)
        app = build / args.target / "release/bundle/macos" / (PRODUCT + ".app")
        sign_bundle(app, args.signing_identity)
        print(f"Local packaging check: {app}")
    else:
        print(f"Verified backend prepared at {prepared}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Backend packaging failed: {error}") from error
