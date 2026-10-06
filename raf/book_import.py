"""Lossless local staging for Albahith exports. Never grants rights or scientific approval."""
import hashlib
import json
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from .catalog import BOOK_ID, TITLE, SCOPE, SOURCE_IDS
from .text import digest, normalize

QUESTION = re.compile(r"(?<!\S)س(?:[0-9٠-٩]+)?(?:\s*[-:ـ–]\s*|\s+)")
ANSWER = re.compile(r"(?<!\S)(?:ج(?:[0-9٠-٩]+)?(?:\s*[-:ـ–]\s*|\s+)|الجواب\s*[:：]?\s*|أجابت اللجنة\s*[:：]?\s*)|(?<=\n)فأجاب\s+")
SEPARATOR = re.compile(r"(?:\*\s*){3,}")
SIGNATURE = re.compile(r"(الشيخ\s+(?:ابن|أبن)\s+(?:باز|عثيمين|جبرين)|اللجنة الدائمة)\s*$")


def heading_position(body, title):
    """Map normalized heading matching back to exact untouched source offsets."""
    chars, offsets = [], []
    for index, char in enumerate(body):
        expanded = {"﵇":"عليه السلام", "﵁":"رضي الله عنه", "﵊":"عليهما السلام"}.get(char,char)
        for letter in normalize(expanded):
            if letter.isalnum():
                chars.append(letter);offsets.append(index)
    for glyph, expanded in {"﵇":"عليه السلام", "﵁":"رضي الله عنه", "﵊":"عليهما السلام"}.items():
        title=title.replace(glyph,expanded)
    needle = "".join(c for c in normalize(title) if c.isalnum())
    if not needle:return None
    compact = "".join(chars)
    candidates=[]
    position=compact.find(needle)
    while position>=0:
        start,end=offsets[position],offsets[position+len(needle)-1]+1
        prefix=body[:start].rstrip()
        score=3 if not prefix.strip('[]()﴿﴾+ *\n') or prefix.endswith('*') else 0
        if prefix.endswith(('[','(','﴿')):score+=2
        if QUESTION.match(body[end:].lstrip(' ]﴾).!؟')):score+=1
        candidates.append((score,-start,start))
        position=compact.find(needle,position+1)
    if not candidates:return None
    if len(needle)<5 and max(candidates)[0]==0:
        return None  # A lone word inside prose is not evidence of a heading.
    start=max(candidates)[2]
    while start and body[start-1] in '[﴿(':start-=1
    return start


def archive_source(payload, directory):
    """Content-addressed raw data; existing files are verified, never overwritten."""
    body = json.dumps(payload, ensure_ascii=False, sort_keys=True, indent=2).encode("utf-8")
    sha = hashlib.sha256(body).hexdigest()
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{sha}.json"
    if path.exists():
        if path.read_bytes() != body:
            raise ValueError("Raw snapshot was modified")
    else:
        with path.open("xb") as stream:
            stream.write(body)
    return path, sha


def validate_export(payload, complete=False):
    metadata, pages = payload["metadata"], payload["pages"]
    if (metadata.get("book_id") != SOURCE_IDS["albahith"]
            or normalize(metadata.get("title", "")) != normalize(TITLE)
            or "المسند" not in metadata.get("author", "")):
        raise ValueError("Wrong source identity: Albahith 1472 is required, not Albahith 1708")
    if not pages:
        raise ValueError("Empty export")
    seen, sequences = set(), set()
    for page in pages:
        seq, identity = page.get("sequence_num"), page.get("page_id")
        if (page.get("book_id") != SOURCE_IDS["albahith"] or type(seq) is not int
                or seq <= 0 or type(identity) is not int or identity in seen or seq in sequences
                or not isinstance(page.get("body"), str)
                or not isinstance(page.get("footnotes", ""), str)):
            raise ValueError("Mixed book, duplicate page, or invalid source record")
        seen.add(identity)
        sequences.add(seq)
    if complete:
        expected = metadata.get("page_count")
        if type(expected) is not int or sequences != set(range(1, expected + 1)):
            raise ValueError("Full import requires every source sequence exactly once")
        if any(not p["body"].strip() and not p.get("footnotes", "").strip() for p in pages):
            raise ValueError("Empty records require source review before complete import")
        counts = Counter(str(p.get("part")) for p in pages)
        declared = {str(p["part"]): p["page_count"] for p in payload["parts"]}
        if counts != declared:
            raise ValueError("Volume counts do not match source metadata")
    return sorted(pages, key=lambda p: p["sequence_num"])


def stage_book(payload, release_id="candidate-v1", complete=False):
    pages = validate_export(payload, complete)
    # Never join samples across omitted pages or cross a volume boundary.
    groups = []
    for page in pages:
        if (not groups or page["sequence_num"] != groups[-1][-1]["sequence_num"] + 1
                or page.get("part") != groups[-1][-1].get("part")):
            groups.append([])
        groups[-1].append(page)
    units, exceptions = [], []
    toc = payload.get("toc",[])
    headings = {}
    for heading in toc:
        headings.setdefault(heading["page_id"], {})[heading["title_text"]] = heading
    missing_headings = []
    by_id = {h["title_id"]:h for h in toc}
    original_chars = sum(len(p["body"]) + len(p.get("footnotes", "")) for p in pages)
    stream_chars = 0
    for group_number, group in enumerate(groups):
        stream, spans, notes = "", [], []
        for page in group:
            start = len(stream)
            stream += page["body"]
            if page.get("footnotes"):
                stream += "\n"
                note_start = len(stream)
                stream += page["footnotes"]
                notes.append((note_start, len(stream)))
            spans.append((start, len(stream), page))
            stream += "\n"
        stream_chars += len(stream)
        anchors = {}
        for page_start,_,page in spans:
            for title,heading in headings.get(page["page_id"],{}).items():
                offset = heading_position(page["body"],title)
                if offset is None:
                    missing_headings.append({"page_id":page["page_id"],"title":title})
                else:
                    anchors[page_start+offset] = heading
        cuts = [0] + list(anchors) + [m.end() for m in SEPARATOR.finditer(stream)] + [len(stream)]
        cuts = sorted(set(cuts))
        # A TOC entry can quote the second half of a question on the next page.
        # Keep the source question and its answer together instead of cutting there.
        retained=[cuts[0]]
        for cut in cuts[1:-1]:
            before=stream[retained[-1]:cut]
            tail=stream[cut:]
            questions=list(QUESTION.finditer(before))
            awaiting=questions and ANSWER.search(before,questions[0].end()) is None
            next_q,next_a=QUESTION.search(tail),ANSWER.search(tail)
            continuation = (awaiting and next_a and (not next_q or next_a.start()<next_q.start())
                            and not before.rstrip().endswith('*'))
            if (not questions and next_a and next_a.start()<150 and not before.rstrip().endswith('*')
                    and cut in anchors and anchors[cut]['title_text'].startswith(('و','إلا','لم '))
                    and '?' not in before and '؟' not in before):
                continuation=True
            if not before.strip() or continuation:
                continue
            retained.append(cut)
        cuts=retained+[len(stream)]
        # Distinct signed fatwas can share one TOC heading and have no star separator.
        extra=[]
        for start,end in zip(cuts,cuts[1:]):
            section=stream[start:end]
            qs=list(QUESTION.finditer(section))
            for left,right in zip(qs,qs[1:]):
                between=section[left.end():right.start()]
                signatures=list(re.finditer(r'(?:الشيخ\s+(?:ابن|أبن)\s+(?:باز|عثيمين|جبرين)|اللجنة الدائمة)',between))
                if ANSWER.search(between) and signatures:
                    signature=signatures[-1]
                    if len(between)-signature.end()<180:
                        extra.append(start+left.end()+signature.end())
        cuts=sorted(set(cuts+extra))
        orphan_starts=set()
        for start,end in zip(cuts,cuts[1:]):
            for a,b in notes:
                if start<=a and b<=end and not stream[start:a].strip() and not stream[b:end].strip():
                    orphan_starts.add(start)
        cuts=[c for c in cuts if c==0 or c not in orphan_starts]
        for start, end in zip(cuts, cuts[1:]):
            text = stream[start:end]
            if not text:
                continue
            refs = [p for a,b,p in spans if a < end and b > start]
            if not refs:  # trailing layout separator belongs to the preceding record
                refs = [group[-1]]
            q = list(QUESTION.finditer(text))
            answer = ANSWER.search(text, q[0].end()) if q else None
            issue = len(q) != 1 or answer is None
            if issue:
                exceptions.append({"unit": len(units), "reason": "boundary_review_required",
                                   "questions_detected":len(q)})
            clean_end = SEPARATOR.sub("", text).rstrip()
            signature = SIGNATURE.search(clean_end) if not issue else None
            # Metadata is only an exact substring; no correction of source typos.
            heading = anchors.get(start)
            title = heading["title_text"] if heading else (text[:q[0].start()].strip() if q and q[0].start() else "")
            title = title if title and len(title) <= 180 else "نص من الكتاب — عنوان غير متاح"
            path, ancestor, visited = [], heading, set()
            while ancestor and ancestor["title_id"] not in visited:
                visited.add(ancestor["title_id"]);path.insert(0,ancestor["title_text"])
                ancestor = by_id.get(ancestor.get("parent_id"))
            path = [TITLE, f"الجزء {refs[0].get('part') or 'غير متاح'}"] + path
            footnotes = [{"start":a-start,"end":b-start,"text":stream[a:b]}
                         for a,b in notes if start <= a and b <= end]
            if any(a < end and b > start and not (start <= a and b <= end) for a,b in notes):
                exceptions.append({"unit":len(units), "reason":"footnote_crosses_boundary"})
            uid = "record-" + digest({"ids":[p["page_id"] for p in refs],"start":start,"text":text})[:20]
            units.append({"id":uid,"book_id":BOOK_ID,"title":title,"path":path,
                          "page_id":str(refs[0]["page_id"]), "text":text,"sha256":digest(text),
                          "url":f"https://app.turath.io/book/1708?page={refs[0]['sequence_num']}",
                          "url_verification":"pending_cross_source_comparison",
                          "fetched_at":payload.get("retrieved_at") or datetime.now(timezone.utc).isoformat(),
                          "verification":"pending","reviewer":"", "footnotes":footnotes,
                          "mufti":signature.group(1) if signature else None,"fatwa_number":None,
                          "question":text[q[0].end():answer.start()].strip() if not issue else None,
                          "answer":text[answer.end():].strip() if not issue else None,
                          "order":len(units), "source_group":group_number, "boundary_review_required":issue,
                          "stream_start":start,"stream_end":end,
                          "source_refs":[{k:p.get(k) for k in ("page_id","bahith_page_id","sequence_num","part","page_num")} for p in refs],
                          "previous_id":None,"next_id":None})
    for index, unit in enumerate(units):
        if index and units[index-1]["source_group"] == unit["source_group"]:
            unit["previous_id"] = units[index-1]["id"]
        if index+1 < len(units) and units[index+1]["source_group"] == unit["source_group"]:
            unit["next_id"] = units[index+1]["id"]
    report = {"book_id":BOOK_ID,"source_ids":SOURCE_IDS,"records":len(pages),
              "expected_records":payload["metadata"]["page_count"], "complete_records":complete,
              "volumes":dict(Counter(str(p.get("part")) for p in pages)),
              "source_characters":original_chars,"staged_characters":sum(len(u["text"]) for u in units),
              "stream_characters":stream_chars,"units":len(units),
              "fatwa_candidates":sum(not u["boundary_review_required"] for u in units),"exceptions":exceptions,
              "duplicate_body_count":sum(n-1 for n in Counter(p["body"] for p in pages).values() if n>1),
              "unmatched_headings":missing_headings,
              "identity_verified":False,"scientific_review":False,"publication_allowed":False}
    if report["staged_characters"] != stream_chars:
        raise ValueError("Staging lost source text")
    manifest = {"book_id":BOOK_ID,"release_id":release_id,"title":TITLE,"scope":SCOPE,
                "source_name":"فتاوى إسلامية — نسخة الباحث؛ مطابقة تراث قيد التحقق",
                "source_ids":SOURCE_IDS,"allowed_hosts":["app.turath.io"],
                "rights":{"publish_allowed":False,"evidence":"","operations":{}},
                "scientific_review":{"approved":False,"reviewer":""},
                "coverage":{"expected_page_ids":[str(p["page_id"]) for p in pages],"complete":False,
                            "structure_reviewed":False,"note":"مسودة خاصة غير متاحة للمستخدمين"},
                "retrieval":{"mode":"hybrid","chunk_chars":300}}
    return {"manifest":manifest,"units":units}, report
