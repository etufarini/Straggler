"""Checksum-verified, transactional backend preparation shared by packagers."""

import fcntl
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import tempfile
import urllib.request

BUNDLE_RESOURCES = ("LICENSE.Mir.cpp", "LICENSE.llama.cpp", "backend-provenance.json")


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


def prepare_backend(packaging, target, archive_path, populate, variant=""):
    manifest = json.loads((packaging / "llama-runtime.json").read_text())
    artifact = manifest["artifacts"][target]
    url = (f"https://github.com/{manifest['repository']}/releases/download/"
           f"{manifest['tag']}/{artifact['name']}")
    generated = packaging / "generated"
    generated.mkdir(exist_ok=True)
    destination = generated / (target + variant)
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
            provenance = {key: manifest[key] for key in ("repository", "tag", "commit", "purpose")}
            provenance.update(target=target, archive=artifact["name"], sha256=digest, url=url)
            (stage / "backend-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
            (stage / "LICENSE.Mir.cpp").write_bytes((Path(__file__).resolve().parents[3] / "LICENSE").read_bytes())
            populate(source, stage, destination, manifest)
            previous = generated / (target + variant + ".previous")
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
