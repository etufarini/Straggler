#!/usr/bin/env python3
"""Prepare a pinned backend and build the macOS desktop or sandbox diagnostic.

Python is a build tool here. Neither the resulting app nor its helper uses it.
"""

import argparse
import backend
from backend import BUNDLE_RESOURCES, BackendArchive
import json
import os
from pathlib import Path
import platform
import plistlib
import shutil
import struct
import subprocess
import tarfile
import tempfile
from datetime import datetime, timezone


PACKAGING = Path(__file__).resolve().parent
DESKTOP = PACKAGING.parent
PRODUCT = "Straggler Backend Check"
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
            destination = (stage / f"straggler-llama-server-{target}" if name == "llama-server"
                           else libraries / name)
            destination.write_bytes(binary)
            destination.chmod(0o755)
        (stage / "LICENSE.llama.cpp").write_bytes(archive.read("LICENSE"))


def store_entitlements(profile, identifier):
    entitlements = plistlib.loads((PACKAGING / "store.entitlements.plist").read_bytes())
    if profile is None:
        return entitlements
    teams = profile.get("TeamIdentifier", [])
    team = teams[0] if isinstance(teams, list) and teams else None
    allowed = profile.get("Entitlements", {})
    application = allowed.get("com.apple.application-identifier")
    prefixes = profile.get("ApplicationIdentifierPrefix", [team])
    if (not team or not any(application == f"{prefix}.{identifier}" for prefix in prefixes)
            or allowed.get("com.apple.developer.team-identifier") != team):
        raise ValueError("The provisioning profile must match this exact app identifier and Team ID")
    expiration = profile.get("ExpirationDate")
    if not isinstance(expiration, datetime) or expiration.replace(tzinfo=timezone.utc) <= datetime.now(timezone.utc):
        raise ValueError("The provisioning profile is expired or has no expiration date")
    if profile.get("ProvisionedDevices") or profile.get("ProvisionsAllDevices") or allowed.get("get-task-allow"):
        raise ValueError("Use a Mac App Store Connect distribution profile, not a development or direct-distribution profile")
    if "OSX" not in profile.get("Platform", []):
        raise ValueError("The provisioning profile must target macOS")
    entitlements.update({"com.apple.application-identifier": application,
                         "com.apple.developer.team-identifier": team})
    return entitlements


def prepare(target, archive_path=None, probe=False, app_store=False, store_check=False, profile=None):
    def populate(source, stage, destination, manifest):
        copy_backend(source, stage, target, manifest)
        desktop_config = json.loads((DESKTOP / "src-tauri/tauri.conf.json").read_text())
        identifier = "io.github.etufarini.straggler.packaging-check" if probe else desktop_config["identifier"]
        product = PRODUCT if probe else desktop_config["productName"]
        if store_check:
            identifier += ".store-check"
            product = "Straggler Store Check"
        config = {
            "productName": product,
            "identifier": identifier,
            "app": {"windows": []} if probe else {},
            "bundle": {
                "targets": ["app"],
                "resources": {str(destination / name): name for name in BUNDLE_RESOURCES},
                "externalBin": [str(destination / "straggler-llama-server")],
                "macOS": {
                    "minimumSystemVersion": "13.5",
                    "frameworks": [str(destination / "libraries" / p.name)
                                   for p in sorted((stage / "libraries").iterdir())],
                    "entitlements": str(PACKAGING / "app.entitlements.plist") if probe else None,
                },
            },
        }
        if app_store:
            entitlements = store_entitlements(profile, identifier)
            (stage / "store.entitlements.plist").write_bytes(plistlib.dumps(entitlements))
            config["bundle"]["macOS"]["entitlements"] = str(destination / "store.entitlements.plist")
        (stage / "tauri.packaging.json").write_text(json.dumps(config, indent=2) + "\n")
    return backend.prepare_backend(PACKAGING, target, archive_path, populate,
                                   variant="-app-store-check" if store_check else "-app-store" if app_store else "-probe" if probe else "")


def run(*arguments, **kwargs):
    subprocess.run(arguments, check=True, **kwargs)


def verify_bundle_resources(app, prepared):
    resources = app / "Contents/Resources"
    for name in BUNDLE_RESOURCES:
        bundled = resources / name
        if not bundled.is_file() or bundled.read_bytes() != (prepared / name).read_bytes():
            raise ValueError(f"Missing or incorrect bundled backend resource: {name}")
    if (resources / "launcher").exists():
        raise ValueError("The desktop bundle must not include launcher resources")


def sign_bundle(app, identity, sandbox=True, parent_entitlements=None):
    contents = app / "Contents"
    # The upstream executables use @loader_path; their libraries live in Frameworks.
    helper = contents / "MacOS/straggler-llama-server"
    run("install_name_tool", "-add_rpath", "@executable_path/../Frameworks", str(helper))
    for library in sorted((contents / "Frameworks").glob("*.dylib")):
        run("codesign", "--force", "--sign", identity, str(library))
    # Hardened library validation requires a common Team ID, absent from ad hoc signatures.
    helper_options = [] if identity == "-" else ["--options", "runtime"]
    helper_entitlements = ["--entitlements", str(PACKAGING / "helper.entitlements.plist")] if sandbox else []
    parent_entitlements = parent_entitlements or PACKAGING / "app.entitlements.plist"
    app_entitlements = ["--entitlements", str(parent_entitlements)] if sandbox else []
    run("codesign", "--force", "--sign", identity, *helper_options, *helper_entitlements, str(helper))
    run("codesign", "--force", "--sign", identity, "--options", "runtime", *app_entitlements, str(app))
    run("codesign", "--verify", "--deep", "--strict", str(app))
    for binary, path in ((helper, PACKAGING / "helper.entitlements.plist"), (app, parent_entitlements)):
        entitlements = subprocess.check_output(["codesign", "--display", "--entitlements", "-", "--xml", str(binary)])
        actual = plistlib.loads(entitlements) if entitlements.strip() else {}
        expected = plistlib.loads(path.read_bytes()) if sandbox else {}
        if actual != expected:
            raise ValueError(f"Unexpected signed entitlements: {binary.name}")


def create_disk_image(app, identity):
    """Package the already signed app without rebuilding or changing its contents."""
    image = app.with_suffix(".dmg")
    with tempfile.TemporaryDirectory(prefix=".dmg-", dir=app.parent) as temporary:
        stage = Path(temporary)
        run("ditto", str(app), str(stage / app.name))
        (stage / "Applications").symlink_to("/Applications", target_is_directory=True)
        run("hdiutil", "create", "-volname", app.stem, "-srcfolder", str(stage),
            "-format", "UDZO", "-ov", str(image))
    if identity != "-":
        run("codesign", "--force", "--sign", identity, str(image))
        run("codesign", "--verify", str(image))
    run("hdiutil", "verify", str(image))
    return image


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=("prepare", "bundle"))
    parser.add_argument("--target", choices=tuple(CPU_TYPES), required=True)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--probe", action="store_true", help="Build the sandboxed backend diagnostic instead of the desktop")
    mode.add_argument("--app-store", action="store_true", help="Build the sandboxed GUI with persistent model-folder permissions")
    parser.add_argument("--store-check", action="store_true", help="Use a separate test app/container for local Store checks")
    parser.add_argument("--debug", action="store_true", help="Store-check only: enable debug WebDriver testing")
    parser.add_argument("--provisioning-profile", type=Path, help="Mac App Store Connect profile; never uploaded")
    parser.add_argument("--pkg-signing-identity", help="Mac Installer Distribution identity; also create a signed .pkg")
    parser.add_argument("--archive", type=Path, help="Use a local archive; still verify the pinned SHA-256")
    parser.add_argument("--signing-identity", default="-", help="Default: local ad hoc signature, not distribution")
    args = parser.parse_args()
    if (args.store_check and not args.app_store) or (args.debug and not args.store_check):
        parser.error("--store-check requires --app-store; --debug requires --store-check")
    if args.store_check and (args.signing_identity != "-" or args.provisioning_profile or args.pkg_signing_identity):
        parser.error("Store-check builds use ad hoc signing and a separate test container")
    if (args.provisioning_profile or args.pkg_signing_identity) and not args.app_store:
        parser.error("Store provisioning and installer signing require --app-store")
    if args.app_store and ((args.signing_identity != "-") != bool(args.provisioning_profile)):
        parser.error("Certificate-signed Store builds require both --signing-identity and --provisioning-profile")
    if args.pkg_signing_identity and not args.provisioning_profile:
        parser.error("A Store .pkg requires a distribution profile and application signing certificate")
    if args.action == "bundle" and platform.system() != "Darwin":
        parser.error("Building and signing the macOS bundle requires a Mac")
    profile = None
    if args.provisioning_profile:
        profile = plistlib.loads(subprocess.check_output(["security", "cms", "-D", "-i", str(args.provisioning_profile.resolve())]))
    prepared = prepare(args.target, args.archive, probe=args.probe,
                       app_store=args.app_store, store_check=args.store_check, profile=profile)
    if args.action == "bundle":
        # Build a complete ICNS (including 512@2x) from the existing vector art;
        # the regular small PNG list alone produces an incomplete Store icon.
        with tempfile.TemporaryDirectory(prefix=".icons-", dir=prepared.parent) as temporary:
            run("npm", "exec", "--", "tauri", "icon", str(DESKTOP / "src-tauri/icons/icon.svg"),
                "--output", temporary, cwd=DESKTOP)
            shutil.copyfile(Path(temporary) / "icon.icns", prepared / "icon.icns")
        config_path = prepared / "tauri.packaging.json"
        config = json.loads(config_path.read_text())
        config["bundle"]["icon"] = [str(prepared / "icon.icns")]
        config_path.write_text(json.dumps(config, indent=2) + "\n")
        build = PACKAGING / ("generated/build-app-store-check" if args.store_check else
                             "generated/build-app-store" if args.app_store else
                             "generated/build-probe" if args.probe else "generated/build")
        environment = dict(os.environ, CARGO_TARGET_DIR=str(build))
        features = (["--features", "app-store,native-tests" if args.debug else "app-store"] if args.app_store
                    else ["--features", "packaging-probe"] if args.probe else [])
        if args.debug:
            features += ["--debug"]
        run("npm", "exec", "--", "tauri", "build", "--target", args.target,
            *features, "--config", str(config_path),
            "--no-sign", cwd=DESKTOP, env=environment)
        product = config["productName"]
        app = build / args.target / ("debug" if args.debug else "release") / "bundle/macos" / (product + ".app")
        verify_bundle_resources(app, prepared)
        if args.provisioning_profile:
            (app / "Contents/embedded.provisionprofile").write_bytes(args.provisioning_profile.read_bytes())
        sign_bundle(app, args.signing_identity, sandbox=args.probe or args.app_store,
                    parent_entitlements=prepared / "store.entitlements.plist" if args.app_store else None)
        if profile:
            details = subprocess.run(["codesign", "--display", "--verbose=4", str(app)], capture_output=True, text=True, check=True)
            if f"TeamIdentifier={profile['TeamIdentifier'][0]}" not in details.stderr:
                raise ValueError("The signing certificate's Team ID does not match the provisioning profile")
            with tempfile.TemporaryDirectory(prefix="straggler-signature-check-") as temporary:
                prefix = Path(temporary) / "signing"
                run("codesign", "--display", "--extract-certificates", str(prefix), str(app))
                certificate = prefix.with_name(prefix.name + "0").read_bytes()
                if certificate not in profile.get("DeveloperCertificates", []):
                    raise ValueError("The provisioning profile does not authorize the application's signing certificate")
        if args.pkg_signing_identity:
            package = app.with_suffix(".pkg")
            run("xcrun", "productbuild", "--sign", args.pkg_signing_identity, "--component", str(app), "/Applications", str(package))
            run("pkgutil", "--check-signature", str(package))
            print(f"Built Store package (not uploaded): {package}")
        if not args.probe and not args.app_store:
            run(str(app / "Contents/MacOS/straggler-desktop"), "--straggler-check")
            image = create_disk_image(app, args.signing_identity)
            print(f"Built disk image (not notarized or published): {image}")
        print(f"Built application: {app}")
    else:
        print(f"Verified backend prepared at {prepared}")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, tarfile.TarError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Backend packaging failed: {error}") from error
