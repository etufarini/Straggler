"""Offline packaging boundaries; fixtures are tiny Mach-O headers, never programs."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import shutil
import struct
import sys
import tarfile
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch


PACKAGING = Path(__file__).resolve().parents[1] / "packaging"
sys.path.insert(0, str(PACKAGING))
spec = importlib.util.spec_from_file_location("macos_packaging", PACKAGING / "macos.py")
packaging = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packaging)
TARGET = "aarch64-apple-darwin"


def macho(*dependencies, architecture=0x100000C):
    commands = []
    for name in dependencies:
        payload = name.encode() + b"\0"
        length = (24 + len(payload) + 7) // 8 * 8
        commands.append(struct.pack("<6I", 0xC, length, 24, 0, 0, 0)
                        + payload + bytes(length - 24 - len(payload)))
    body = b"".join(commands)
    return struct.pack("<8I", 0xFEEDFACF, architecture, 0, 2, len(commands), len(body), 0, 0) + body


class PackagingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="mir-packaging-test-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def archive(self, files=None, links=None):
        destination = self.root / "fixture.tar.gz"
        files = files if files is not None else {
            "llama-server": macho("@rpath/libllama.0.dylib", "/usr/lib/libSystem.B.dylib"),
            "libllama.1.dylib": macho("@rpath/libggml.dylib"),
            "libggml.dylib": macho(),
            "unneeded-tool": b"not an executable",
            "LICENSE": b"Fixture license\n",
        }
        links = links if links is not None else {"libllama.0.dylib": "libllama.1.dylib"}
        with tarfile.open(destination, "w:gz") as archive:
            for name, contents in files.items():
                member = tarfile.TarInfo(name if name.startswith("/") else "llama-fixture/" + name)
                member.size = len(contents)
                archive.addfile(member, io.BytesIO(contents))
            for name, link in links.items():
                member = tarfile.TarInfo("llama-fixture/" + name)
                member.type = tarfile.SYMTYPE
                member.linkname = link
                archive.addfile(member)
        manifest = {
            "repository": "ggml-org/llama.cpp", "tag": "fixture", "commit": "a" * 40,
            "purpose": "Offline test", "artifacts": {TARGET: {
                "name": destination.name, "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
            }},
        }
        (self.root / "llama-runtime.json").write_text(json.dumps(manifest))
        return destination

    def prepare(self, archive):
        with patch.object(packaging, "PACKAGING", self.root):
            return packaging.prepare(TARGET, archive, probe=True)

    def test_probe_copies_transitive_libraries_and_required_resources(self):
        prepared = self.prepare(self.archive())
        config = json.loads((prepared / "tauri.packaging.json").read_text())
        self.assertEqual(config["app"]["windows"], [])
        self.assertEqual(config["bundle"]["resources"], {
            str(prepared / "LICENSE.Mir.cpp"): "LICENSE.Mir.cpp",
            str(prepared / "LICENSE.llama.cpp"): "LICENSE.llama.cpp",
            str(prepared / "backend-provenance.json"): "backend-provenance.json",
        })
        self.assertEqual({p.name for p in (prepared / "libraries").iterdir()},
                         {"libllama.0.dylib", "libggml.dylib"})
        self.assertFalse((prepared / "unneeded-tool").exists())
        self.assertFalse((prepared / "libraries/libllama.0.dylib").is_symlink())
        self.assertTrue((prepared / f"mir-llama-server-{TARGET}").stat().st_mode & 0o111)
        provenance = json.loads((prepared / "backend-provenance.json").read_text())
        self.assertEqual(provenance["target"], TARGET)

    def test_regular_desktop_bundle_keeps_its_identity_and_native_window(self):
        archive = self.archive()
        with patch.object(packaging, "PACKAGING", self.root):
            prepared = packaging.prepare(TARGET, archive)
        config = json.loads((prepared / "tauri.packaging.json").read_text())
        base = json.loads((packaging.DESKTOP / "src-tauri/tauri.conf.json").read_text())
        self.assertEqual(config["identifier"], base["identifier"])
        self.assertEqual(config["productName"], base["productName"])
        self.assertNotIn("windows", config["app"])
        self.assertIsNone(config["bundle"]["macOS"]["entitlements"])
        self.assertTrue(config["bundle"]["externalBin"])

    def test_disk_image_preserves_signed_app_and_provides_applications_shortcut(self):
        app = self.root / "Mir.cpp.app"
        app.mkdir()
        (app / "signed-payload").write_bytes(b"signed application")
        commands = []

        def run(*arguments):
            commands.append(arguments)
            if arguments[0] == "ditto":
                shutil.copytree(arguments[1], arguments[2])
            elif arguments[:2] == ("hdiutil", "create"):
                stage = Path(arguments[arguments.index("-srcfolder") + 1])
                self.assertEqual((stage / app.name / "signed-payload").read_bytes(), b"signed application")
                self.assertEqual((stage / "Applications").readlink(), Path("/Applications"))
                Path(arguments[-1]).write_bytes(b"disk image fixture")

        with patch.object(packaging, "run", side_effect=run):
            image = packaging.create_disk_image(app, "Developer ID fixture")
        self.assertEqual(image.read_bytes(), b"disk image fixture")
        self.assertEqual(commands[-3:], [
            ("codesign", "--force", "--sign", "Developer ID fixture", str(image)),
            ("codesign", "--verify", str(image)),
            ("hdiutil", "verify", str(image)),
        ])
        self.assertEqual((app / "signed-payload").read_bytes(), b"signed application")
        self.assertFalse(list(self.root.glob(".dmg-*")))

    def test_bundle_resources_must_be_at_the_runtime_paths_and_match_preparation(self):
        prepared = self.prepare(self.archive())
        app = self.root / "Backend Check.app"
        resources = app / "Contents/Resources"
        resources.mkdir(parents=True)
        for name in packaging.BUNDLE_RESOURCES:
            (resources / name).write_bytes((prepared / name).read_bytes())
        packaging.verify_bundle_resources(app, prepared)
        provenance = resources / "backend-provenance.json"
        provenance.write_text("{}")
        with self.assertRaisesRegex(ValueError, "backend-provenance.json"):
            packaging.verify_bundle_resources(app, prepared)
        provenance.unlink()
        nested = resources / "_root_/build"
        nested.mkdir(parents=True)
        (nested / provenance.name).write_bytes((prepared / provenance.name).read_bytes())
        with self.assertRaisesRegex(ValueError, "backend-provenance.json"):
            packaging.verify_bundle_resources(app, prepared)
        provenance.write_bytes((prepared / provenance.name).read_bytes())
        (resources / "launcher").mkdir()
        with self.assertRaisesRegex(ValueError, "launcher"):
            packaging.verify_bundle_resources(app, prepared)

    def test_failed_checksum_preserves_prepared_backend(self):
        archive = self.archive()
        prepared = self.prepare(archive)
        original = (prepared / f"mir-llama-server-{TARGET}").read_bytes()
        archive.write_bytes(b"wrong archive")
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            self.prepare(archive)
        self.assertEqual((prepared / f"mir-llama-server-{TARGET}").read_bytes(), original)

    def test_failed_download_preserves_prepared_backend(self):
        prepared = self.prepare(self.archive())
        with patch.object(packaging, "PACKAGING", self.root), \
                patch.object(packaging.backend.urllib.request, "urlopen", side_effect=OSError("offline")):
            with self.assertRaisesRegex(OSError, "offline"):
                packaging.prepare(TARGET)
        self.assertTrue((prepared / f"mir-llama-server-{TARGET}").is_file())

    def test_unsafe_members_links_and_cycles_are_rejected_without_extraction(self):
        for name in ("../outside", "/absolute", "nested/file"):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "path"):
                self.prepare(self.archive(files={name: b"bad"}, links={}))
        with self.assertRaisesRegex(ValueError, "Unsafe"):
            self.prepare(self.archive(links={"libllama.0.dylib": "../outside"}))
        with self.assertRaisesRegex(ValueError, "Cyclic"):
            self.prepare(self.archive(links={"libllama.0.dylib": "libllama.0.dylib"}))
        self.assertFalse((self.root / "outside").exists())

    def test_architecture_missing_libraries_and_external_dependencies_are_rejected(self):
        for binary, message in (
            (macho(architecture=0x1000007), "architecture"),
            (macho("@rpath/libmissing.dylib"), "Missing"),
            (macho("/opt/homebrew/lib/libsomething.dylib"), "external installation"),
            (macho("@rpath/../libsomething.dylib"), "Unsupported"),
        ):
            with self.subTest(message=message), self.assertRaisesRegex(ValueError, message):
                self.prepare(self.archive(files={"llama-server": binary}, links={}))

    def test_truncated_load_commands_fail_explicitly(self):
        for binary in (b"", macho("@rpath/libggml.dylib")[:-8],
                       struct.pack("<8I", 0xFEEDFACF, 0x100000C, 0, 2, 1, 8, 0, 0)
                       + struct.pack("<II", 0xC, 0)):
            with self.subTest(binary=binary), self.assertRaises(ValueError):
                packaging.macho_dependencies(binary, 0x100000C)

    def test_repreparation_is_transactional_and_recovers_rename_failure(self):
        archive = self.archive()
        prepared = self.prepare(archive)
        original_rename = Path.rename

        def fail_activation(path, destination):
            if path.name == "prepared":
                raise OSError("activation failed")
            return original_rename(path, destination)

        with patch.object(Path, "rename", fail_activation):
            with self.assertRaisesRegex(OSError, "activation failed"):
                self.prepare(archive)
        self.assertTrue((prepared / f"mir-llama-server-{TARGET}").is_file())
        self.assertFalse(prepared.with_name(TARGET + ".previous").exists())
        self.assertEqual(self.prepare(archive), prepared)

    def test_helper_entitlements_only_inherit_parent_sandbox(self):
        helper = plistlib.loads((PACKAGING / "helper.entitlements.plist").read_bytes())
        self.assertEqual(helper, {"com.apple.security.app-sandbox": True,
                                 "com.apple.security.inherit": True})
        parent = plistlib.loads((PACKAGING / "app.entitlements.plist").read_bytes())
        self.assertNotIn("com.apple.security.inherit", parent)
        self.assertTrue(parent["com.apple.security.files.user-selected.read-only"])

    def test_store_gui_has_its_own_entitlements_and_preparation_directory(self):
        archive = self.archive()
        with patch.object(packaging, "PACKAGING", self.root), \
                patch.object(packaging, "store_entitlements", return_value={"fixture": True}):
            prepared = packaging.prepare(TARGET, archive, app_store=True, store_check=True)
        config = json.loads((prepared / "tauri.packaging.json").read_text())
        self.assertTrue(config["identifier"].endswith(".store-check"))
        self.assertEqual(config["app"], {})
        self.assertTrue(prepared.name.endswith("-app-store-check"))
        self.assertEqual(plistlib.loads((prepared / "store.entitlements.plist").read_bytes()), {"fixture": True})
        self.assertEqual(config["bundle"]["macOS"]["entitlements"], str(prepared / "store.entitlements.plist"))

    def test_store_profile_must_be_current_and_match_the_exact_application_and_team(self):
        identifier = "io.github.etufarini.mir"
        profile = {
            "TeamIdentifier": ["TEAM"],
            "Platform": ["OSX"],
            "ExpirationDate": datetime.now(timezone.utc) + timedelta(days=1),
            "Entitlements": {"com.apple.application-identifier": "TEAM." + identifier,
                             "com.apple.developer.team-identifier": "TEAM"},
        }
        entitlements = packaging.store_entitlements(profile, identifier)
        self.assertTrue(entitlements["com.apple.security.files.bookmarks.app-scope"])
        self.assertTrue(entitlements["com.apple.security.files.user-selected.read-write"])
        self.assertNotIn("com.apple.security.inherit", entitlements)
        for change in ({"TeamIdentifier": ["OTHER"]}, {"TeamIdentifier": []}, {"Platform": ["iOS"]}, {"ProvisionedDevices": ["device"]},
                       {"ExpirationDate": datetime.now(timezone.utc) - timedelta(days=1)}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                packaging.store_entitlements({**profile, **change}, identifier)
        with self.assertRaises(ValueError):
            packaging.store_entitlements(profile, identifier + ".different")
        legacy_prefix = {**profile, "ApplicationIdentifierPrefix": ["PREFIX"],
                         "Entitlements": {**profile["Entitlements"],
                                          "com.apple.application-identifier": "PREFIX." + identifier}}
        self.assertEqual(packaging.store_entitlements(legacy_prefix, identifier)[
            "com.apple.application-identifier"], "PREFIX." + identifier)


if __name__ == "__main__":
    unittest.main()
