"""Convert saved HTML into a private unreviewed draft without network requests."""
import argparse
import json
from pathlib import Path
from raf.source_adapter import parse_dorar_page


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory")
    parser.add_argument("page_id")
    parser.add_argument("html")
    parser.add_argument("output")
    args=parser.parse_args()
    inventory=json.loads(Path(args.inventory).read_text(encoding="utf-8"))
    matches=[p for p in inventory["pages"] if p["page_id"]==args.page_id]
    if len(matches)!=1:
        parser.error("Page id must occur exactly once in the selected book inventory")
    draft=parse_dorar_page(Path(args.html).read_text(encoding="utf-8"),matches[0])
    output=Path(args.output)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(draft,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"page_id":draft["page_id"],"characters":len(draft["text"]),
                      "footnotes":len(draft["footnotes"]),"verification":draft["verification"]},ensure_ascii=False))


if __name__ == "__main__":main()
