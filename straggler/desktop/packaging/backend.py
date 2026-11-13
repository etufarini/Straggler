"""Checksum-verified, transactional backend preparation shared by packagers."""

import argparse
from datetime import datetime
import fcntl
import hashlib
import json
from pathlib import Path, PurePosixPath
import os
import re
import shutil
import tarfile
import tempfile
import urllib.request

BUNDLE_RESOURCES = ("LICENSE.Straggler", "LICENSE.llama.cpp", "backend-provenance.json")


def validate_release_metadata(manifest):
    version = manifest.get("version")
    number = manifest.get("buildNumber")
    date = manifest.get("releaseDate")
    if not isinstance(version, str) or not re.fullmatch(r"\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?", version):
        raise ValueError("Pin the backend version before packaging")
    if type(number) is not int or number < 0 or manifest.get("tag") != f"b{number}":
        raise ValueError("The backend buildNumber must match its pinned bNNNN tag")
    try:
        published = datetime.fromisoformat(date.replace("Z", "+00:00"))
        if published.tzinfo is None:
            raise ValueError("Missing release timezone")
    except (AttributeError, TypeError, ValueError) as error:
        raise ValueError("Pin the GitHub published_at releaseDate before packaging") from error


def refresh_release_metadata(path, version):
    """Explicit build-time operation; installed applications never call GitHub."""
    manifest = json.loads(path.read_text())
    tag = manifest["tag"]
    if not re.fullmatch(r"b\d+", tag):
        raise ValueError("Expected a pinned bNNNN release tag")
    url = f"https://api.github.com/repos/{manifest['repository']}/releases/tags/{tag}"
    request = urllib.request.Request(url, headers={"User-Agent": "Straggler-packaging"})
    with urllib.request.urlopen(request, timeout=30) as response:
        release = json.load(response)
    if release.get("tag_name") != tag or release.get("draft"):
        raise ValueError("GitHub did not return the pinned published release")
    manifest.update(version=version, buildNumber=int(tag[1:]), releaseDate=release.get("published_at"))
    validate_release_metadata(manifest)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as output:
            temporary = Path(output.name)
            json.dump(manifest, output, indent=2)
            output.write("\n")
            output.flush()
            os.fsync(output.fileno())
        temporary.chmod(path.stat().st_mode & 0o777)
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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
    validate_release_metadata(manifest)
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
            provenance = {key: manifest[key] for key in (
                "repository", "tag", "commit", "purpose", "version", "buildNumber", "releaseDate"
            )}
            provenance.update(target=target, archive=artifact["name"], sha256=digest, url=url)
            (stage / "backend-provenance.json").write_text(json.dumps(provenance, indent=2) + "\n")
            (stage / "LICENSE.Straggler").write_bytes((Path(__file__).resolve().parents[3] / "LICENSE").read_bytes())
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


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Refresh pinned backend metadata before packaging")
    parser.add_argument("--refresh-release-metadata", action="store_true", required=True)
    parser.add_argument("--version", required=True, help="Version reported by the pinned llama-server --version")
    arguments = parser.parse_args()
    refresh_release_metadata(Path(__file__).with_name("llama-runtime.json"), arguments.version)
