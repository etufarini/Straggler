"""Offline packaging boundaries; fixtures are tiny Mach-O headers, never programs."""

import hashlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import struct
import tarfile
import tempfile
import unittest
from unittest.mock import patch


PACKAGING = Path(__file__).resolve().parents[1] / "packaging"
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
            return packaging.prepare(TARGET, archive)

    def test_copies_transitive_libraries_and_replaces_launcher_resources(self):
        prepared = self.prepare(self.archive())
        config = json.loads((prepared / "tauri.backend-check.json").read_text())
        self.assertEqual(config["app"]["windows"], [])
        self.assertIsInstance(config["bundle"]["resources"], list)
        self.assertEqual(len(config["bundle"]["resources"]), 2)
        self.assertEqual({p.name for p in (prepared / "libraries").iterdir()},
                         {"libllama.0.dylib", "libggml.dylib"})
        self.assertFalse((prepared / "unneeded-tool").exists())
        self.assertFalse((prepared / "libraries/libllama.0.dylib").is_symlink())
        self.assertTrue((prepared / f"mir-llama-server-{TARGET}").stat().st_mode & 0o111)
        provenance = json.loads((prepared / "backend-provenance.json").read_text())
        self.assertEqual(provenance["target"], TARGET)

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
                patch.object(packaging.urllib.request, "urlopen", side_effect=OSError("offline")):
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


if __name__ == "__main__":
    unittest.main()
