"""Local administration only; there is no public write API."""
import argparse
import json
import os
from pathlib import Path
from .embeddings import create_embedder
from .pipeline import import_bundle, evaluate, publish
from .store import Store


def main():
    parser = argparse.ArgumentParser(description="Raf book lifecycle")
    parser.add_argument("--db", default=os.getenv("RAF_DB", "var/raf.sqlite3"))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("books")
    coverage = commands.add_parser("coverage")
    coverage.add_argument("inventory")
    ingest = commands.add_parser("import")
    ingest.add_argument("file")
    for name in ("evaluate", "publish"):
        command = commands.add_parser(name)
        command.add_argument("book")
        command.add_argument("release")
        if name == "publish":
            command.add_argument("--reviewer", required=True)
        else:
            command.add_argument("cases")
    args = parser.parse_args()
    try:
        store, embedder = Store(args.db), create_embedder()
        if args.command in ("init", "books"):
            result = store.books()
        elif args.command == "coverage":
            result = store.record_coverage(json.loads(Path(args.inventory).read_text(encoding="utf-8-sig")))
        elif args.command == "import":
            result = import_bundle(store,json.loads(Path(args.file).read_text(encoding="utf-8-sig")),embedder)
        elif args.command == "evaluate":
            result = evaluate(store,args.book,args.release,json.loads(Path(args.cases).read_text(encoding="utf-8-sig")),embedder)
        else:
            result = publish(store,args.book,args.release,args.reviewer)
        print(json.dumps(result,ensure_ascii=False,indent=2))
        if args.command == "evaluate" and not result["passed"]:
            raise SystemExit(1)
    except (ValueError,KeyError,TypeError,RuntimeError) as exc:
        parser.exit(1, f"Validation failed: {exc}\n")


if __name__ == "__main__":
    main()
