"""Compare captured visible Turath samples with a local Albahith export; no network."""
import argparse
import json
import re
from difflib import SequenceMatcher
from pathlib import Path
from raf.text import normalize, digest


def comparable(text):
    # Only for comparison. Original files remain untouched.
    text = re.sub(r"\n[٠-٩0-9]+\s*\u200f?\s*/\s*[٠-٩0-9]+\s*$", "", text)
    for glyph, expanded in {"﵀":"رحمه الله","﷿":"عز وجل","﷾":"سبحانه وتعالى"}.items():
        text=text.replace(glyph,expanded)
    return re.sub(r"[^\w]", "", normalize(text))


def compare(export, visible):
    records={p["sequence_num"]:p for p in export["pages"]}
    results=[]
    for sample in visible:
        sequence=int(sample["id"].removeprefix("pg-"))
        page=records.get(sequence)
        if page is None:continue
        a,b=comparable(page["body"]),comparable(sample["text"])
        results.append({"sequence":sequence,"albahith_page_id":page["page_id"],
                        "part":page.get("part"),"printed_page":page.get("page_num"),
                        "normalized_equal":a==b,
                        "similarity":round(SequenceMatcher(None,a,b,autojunk=False).ratio(),6),
                        "albahith_sha256":digest(page["body"]),"turath_visible_sha256":digest(sample["text"])})
    return {"source_ids":{"turath":1708,"albahith":1472},"samples":results,
            "note":"Diagnostic comparison, not a scientific review or rights grant"}


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("export");parser.add_argument("visible");parser.add_argument("output")
    args=parser.parse_args()
    report=compare(json.loads(Path(args.export).read_text(encoding="utf-8")),
                   json.loads(Path(args.visible).read_text(encoding="utf-8")))
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps(report,ensure_ascii=False,indent=2))


if __name__ == "__main__":main()
