"""Stage a provided Albahith JSON export locally; never fetches or publishes content."""
import argparse
import json
from pathlib import Path
from raf.book_import import archive_source, stage_book


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("export")
    parser.add_argument("--output", default="private/fatawa1708")
    parser.add_argument("--complete", action="store_true")
    args = parser.parse_args()
    payload = json.loads(Path(args.export).read_text(encoding="utf-8-sig"))
    bundle, report = stage_book(payload, complete=args.complete)
    root = Path(args.output)
    raw, sha = archive_source(payload, root/"raw")
    report.update(raw_file=str(raw), raw_sha256=sha)
    for name, data in (("candidate.json",bundle),("import-manifest.json",report)):
        (root/name).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == "__main__":
    main()
