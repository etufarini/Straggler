"""Offline ELF/package contracts. Tiny fixture bytes are never executable."""

import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "packaging"))
import ubuntu

TARGET = "x86_64-unknown-linux-gnu"


def elf(*dependencies, machine=62):
    strings = b"\0"
    entries = []
    for name in dependencies:
        entries.append((1, len(strings)))
        strings += name.encode() + b"\0"
    start = 64 + 2 * 56
    string_start = start + (len(entries) + 3) * 16
    entries += [(5, string_start), (10, len(strings)), (0, 0)]
    length = string_start + len(strings)
    header = struct.pack("<16sHHIQQQIHHHHHH", b"\x7fELF\x02\x01\x01", 3, machine,
                         1, 0, 64, 0, 0, 64, 56, 2, 0, 0, 0)
    load = struct.pack("<IIQQQQQQ", 1, 5, 0, 0, 0, length, length, 8)
    dynamic = struct.pack("<IIQQQQQQ", 2, 4, start, start, 0,
                          len(entries) * 16, len(entries) * 16, 8)
    return header + load + dynamic + b"".join(struct.pack("<qQ", *e) for e in entries) + strings


class UbuntuPackagingTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="mir-ubuntu-packaging-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def archive(self, extra=None):
        files = {
            "llama-server": elf("libllama-server-impl.so", "libc.so.6"),
            "libllama-server-impl.so": elf("libllama.so.0"),
            "libllama.so.1": elf("libggml-base.so.0"),
            "libggml-base.so.0": elf("libm.so.6"),
            "libggml-cpu-baseline.so": elf("libggml-base.so.0", "libgomp.so.1"),
            "libllama-bench-impl.so": elf(),
            "llama-cli": b"unneeded tool",
            "LICENSE": b"Fixture license\n",
        }
        files.update(extra or {})
        source = self.root / "fixture.tar.gz"
        with tarfile.open(source, "w:gz") as package:
            for name, contents in files.items():
                member = tarfile.TarInfo("llama-fixture/" + name)
                member.size = len(contents)
                package.addfile(member, io.BytesIO(contents))
            link = tarfile.TarInfo("llama-fixture/libllama.so.0")
            link.type, link.linkname = tarfile.SYMTYPE, "libllama.so.1"
            package.addfile(link)
        manifest = {"repository": "ggml-org/llama.cpp", "tag": "fixture",
                    "commit": "a" * 40, "purpose": "Offline fixture", "artifacts": {
                        TARGET: {"name": source.name, "sha256": hashlib.sha256(source.read_bytes()).hexdigest()}}}
        (self.root / "llama-runtime.json").write_text(json.dumps(manifest))
        return source

    def prepare(self, source):
        with patch.object(ubuntu, "PACKAGING", self.root):
            return ubuntu.prepare(TARGET, source)

    def test_includes_dynamic_cpu_modules_and_transitive_libraries_without_tools(self):
        prepared = self.prepare(self.archive())
        files = {p.name for p in (prepared / "backend").iterdir()}
        self.assertEqual(files, {"llama-server", "libllama-server-impl.so", "libllama.so.0",
                                 "libggml-base.so.0", "libggml-cpu-baseline.so"})
        self.assertFalse((prepared / "backend/libllama.so.0").is_symlink())
        config = json.loads((prepared / "tauri.ubuntu.json").read_text())
        self.assertNotIn("mainBinaryName", config)
        deb = config["bundle"]["linux"]["deb"]
        self.assertEqual(deb["files"]["/usr/lib/mir.cpp/backend"], str(prepared / "backend"))
        self.assertIn("libgomp1", deb["depends"])
        self.assertNotIn("externalBin", config["bundle"])

    def test_rejects_wrong_architecture_missing_and_external_dependencies_transactionally(self):
        original = self.prepare(self.archive())
        for binary in (elf(machine=183), elf("libmissing.so"), elf("/tmp/libbad.so")):
            with self.subTest(binary=binary), self.assertRaises(ValueError):
                self.prepare(self.archive({"llama-server": binary}))
            self.assertEqual((original / "backend/llama-server").read_bytes(),
                             elf("libllama-server-impl.so", "libc.so.6"))

    def test_rejects_truncated_headers_segments_and_names(self):
        for binary in (b"", elf()[:50], elf("libc.so.6")[:-1],
                       elf()[:64] + bytes(112), elf("bad\0name")[:176]):
            with self.subTest(binary=binary), self.assertRaises(ValueError):
                ubuntu.elf_dependencies(binary, 62)


if __name__ == "__main__":
    unittest.main()
