"""Export only allowlisted public code, never private corpora or runtime databases."""
import argparse
import re
from pathlib import Path
from zipfile import ZipFile,ZIP_DEFLATED

ROOT = Path(__file__).resolve().parent.parent
DIRECTORIES = ("raf","web","site","tests","tools","docs","evaluation","examples",".github")
FILES = ("README.md","LICENSE","NOTICE.md","pyproject.toml","requirements.txt","requirements-semantic.txt","Dockerfile",
         "compose.yaml","compose.local-model.yaml",".gitignore",".dockerignore",".env.example")
SECRET = re.compile(r"(?:sk-[A-Za-z0-9_-]{24,}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----)")


def public_files():
    paths=[ROOT/name for name in FILES if (ROOT/name).is_file()]
    for directory in DIRECTORIES:
        paths.extend(p for p in (ROOT/directory).rglob("*") if p.is_file()
                     and "__pycache__" not in p.parts and p.suffix not in {".pyc",".sqlite3",".db",".pdf"})
    for path in paths:
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT):
            raise ValueError("Symlink/outside path in public package")
        text=path.read_text(encoding="utf-8")
        if SECRET.search(text):
            raise ValueError(f"Possible secret in {path.relative_to(ROOT)}")
    return sorted(paths)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--check",action="store_true")
    args=parser.parse_args()
    paths=public_files()
    if not args.check:
        output=ROOT/"dist"/"raf-github-ready.zip"
        output.parent.mkdir(exist_ok=True)
        with ZipFile(output,"w",ZIP_DEFLATED) as archive:
            for path in paths:archive.write(path,path.relative_to(ROOT).as_posix())
        print(output)
    print(f"Checked {len(paths)} public files; private data excluded. Pattern scan is not a guarantee against all secrets.")


if __name__ == "__main__":main()
