"""Read a saved public table of contents; never fetch or republish source bodies."""
import argparse
import json
from collections import Counter
from pathlib import Path
from raf.text import normalize, digest
from raf.html import Node, Tree


def discover(html):
    parser = Tree()
    parser.feed(html)
    tree = next(n for n in parser.root.walk() if n.attrs.get("id") == "mtree")
    books = [n for n in tree.children if isinstance(n,Node) and n.tag == "li"]
    selected = None
    for book in books:
        anchor = next(n for n in book.children if isinstance(n,Node) and n.tag == "a")
        if normalize(anchor.text()).strip() == "كتاب الصلاة":
            selected = book
            break
    if selected is None:
        raise ValueError("Exact prayer book boundary not found; inspect source structure")
    rows,chapters = [],[]
    def visit(node,path):
        if node.tag == "li":
            anchor = next((n for n in node.children if isinstance(n,Node) and n.tag == "a"),None)
            if anchor:
                title = anchor.text()
                path = path + [title]
                href = anchor.attrs.get("href","")
                if len(path)==2:
                    chapters.append(title)
                if href.startswith("/feqhia/"):
                    rows.append({"book_id":"salah","page_id":href.split("/")[2],"url":"https://dorar.net"+href,
                                 "title":title,"path":path,"status":"discovered","fetched_at":None,
                                 "parsed":False,"reviewed":False})
        for child in node.children:
            if isinstance(child,Node) and child.tag in {"li","ul"}:
                visit(child,path)
    visit(selected,[])
    counts = Counter(r["page_id"] for r in rows)
    return {"source":"https://dorar.net/feqhia","snapshot_sha256":digest(html),"book_id":"salah",
            "chapters":chapters,"link_count":len(rows),"unique_pages":len(counts),
            "duplicate_page_ids":[p for p,n in counts.items() if n>1],"pages":rows}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("html")
    parser.add_argument("output")
    args = parser.parse_args()
    data = discover(Path(args.html).read_text(encoding="utf-8"))
    Path(args.output).write_text(json.dumps(data,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({k:v for k,v in data.items() if k != "pages"},ensure_ascii=False,indent=2))
