"""Fetch an explicitly selected, checksummed public-content release for Pages CI.

This does not approve rights. assemble_pages still validates each source approval.
"""
import argparse
import hashlib
import re
import stat
import tempfile
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

MAX_BYTES = 900 * 1024 * 1024
ROOT_FILES = {"catalog.json", "settings.json", "vocabulary.json"}


def unpack(archive: Path, destination: Path) -> None:
    if destination.exists():
        raise ValueError("Content destination must be new")
    with zipfile.ZipFile(archive) as bundle:
        entries = [entry for entry in bundle.infolist() if not entry.is_dir()]
        if sum(entry.file_size for entry in entries) > MAX_BYTES:
            raise ValueError("Content release exceeds size limit")
        names = set()
        for entry in entries:
            name = entry.filename
            valid = name in ROOT_FILES or re.fullmatch(
                r"data/[a-z0-9-]+/(?:[a-zA-Z0-9_-]+/)*[a-zA-Z0-9_.-]+", name
            )
            if (not valid or ".." in name.split("/") or name in names
                    or stat.S_ISLNK(entry.external_attr >> 16)):
                raise ValueError("Unsafe or duplicate content path")
            names.add(name)
        if not ROOT_FILES.issubset(names):
            raise ValueError("Incomplete content release")
        destination.mkdir(parents=True)
        for entry in entries:
            target = destination / entry.filename
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(entry) as source, target.open("wb") as output:
                while chunk := source.read(1024 * 1024):
                    output.write(chunk)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--sha256", required=True)
    args = parser.parse_args()
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != "https" or not url.hostname or url.username or url.password:
        raise SystemExit("A public HTTPS release URL is required")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", args.sha256):
        raise SystemExit("A SHA-256 digest is required")
    with tempfile.TemporaryDirectory() as temporary:
        archive = Path(temporary) / "content.zip"
        digest = hashlib.sha256()
        size = 0
        with urllib.request.urlopen(args.url, timeout=60) as response, archive.open("wb") as output:
            if urllib.parse.urlsplit(response.url).scheme != "https":
                raise ValueError("HTTPS downgrade refused")
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_BYTES:
                    raise ValueError("Download exceeds size limit")
                digest.update(chunk)
                output.write(chunk)
        if digest.hexdigest() != args.sha256.lower():
            raise ValueError("Content release checksum mismatch")
        unpack(archive, Path("pages-content"))


if __name__ == "__main__":
    main()
