"""Dorar HTML -> unreviewed page draft. Never auto-approve or split legal context."""
import hashlib
from datetime import datetime, timezone
from .html import Node, Tree
from .text import digest


def parse_dorar_page(html, page):
    tree = Tree()
    tree.feed(html)
    containers = [n for n in tree.root.walk() if n.attrs.get("id") == "cntnt"]
    if len(containers) != 1:
        raise ValueError("Expected exactly one source content container")
    container = containers[0]
    bodies = [n for n in container.children if isinstance(n,Node)
              and {"w-100","mt-4"}.issubset(n.attrs.get("class","").split())]
    if len(bodies) != 1:
        raise ValueError("Source layout changed; inspect before extracting")
    body = bodies[0]
    pieces, notes = [], []
    length = 0

    def append(text):
        nonlocal length
        pieces.append(text)
        length += len(text)

    def walk(node):
        if isinstance(node,str):
            append(node)
            return
        if node.tag in {"script","style","button"} or node.attrs.get("id") == "enc-tip":
            return
        if node.tag == "br":
            append("\n")
            return
        footnote = "tip" in node.attrs.get("class","").split()
        start = length
        for child in node.children:
            walk(child)
        if footnote:
            notes.append({"id":f"fn-{len(notes)+1}","start":start,"end":length})
        if node.tag in {"p","li","div","h2","h3","h4"}:
            append("\n")

    walk(body)
    raw = "".join(pieces)
    leading = len(raw)-len(raw.lstrip())
    text = raw.strip()
    for note in notes:
        note["start"] -= leading
        note["end"] -= leading
        note["text"] = text[note["start"]:note["end"]]
        if not note["text"].strip():
            raise ValueError("Empty source footnote")
    expected_notes = sum("tip" in n.attrs.get("class","").split() for n in body.walk())
    if len(notes) != expected_notes or not text:
        raise ValueError("Incomplete source extraction")
    title = next((n.text() for n in container.walk() if n.tag == "h1"),page["title"])
    return {"book_id":page["book_id"],"id":f"page-{page['page_id']}","page_id":page["page_id"],
            "title":title,"path":page["path"],"url":page["url"],"text":text,"sha256":digest(text),
            "fetched_at":page.get("fetched_at") or datetime.now(timezone.utc).isoformat(),
            "footnotes":notes,"verification":"pending","reviewer":"",
            "previous_id":None,"next_id":None,
            "extraction":{"adapter":"dorar-html-v1","raw_html_sha256":hashlib.sha256(html.encode()).hexdigest(),
                          "footnotes_found":expected_notes,"full_page_unit":True,
                          "note":"Unreviewed draft. Check source, issue boundaries, and every condition before import."}}
