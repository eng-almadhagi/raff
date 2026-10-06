"""Unified local import -> index -> evaluate -> publish lifecycle for every book."""
import json
import re
import time
import statistics
from datetime import datetime
from urllib.parse import urlparse
from .answers import verified_citation
from .embeddings import valid_vector
from .retrieval import search, active_mode
from .text import digest, normalize
from .rights import require_grants, require_public_display
from .indexing import index_chunks
from .catalog import BOOK_ID, EXPECTED_RECORDS, SOURCE_IDS

IDENTIFIER = re.compile(r"^[a-z][a-z0-9_-]{1,63}$")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(bundle):
    m, units = bundle["manifest"], bundle["units"]
    for key in ("book_id", "release_id"):
        require(isinstance(m[key], str) and IDENTIFIER.fullmatch(m[key]), f"Invalid {key}")
    for key in ("title", "scope", "source_name"):
        require(isinstance(m[key], str) and bool(m[key].strip()), f"Missing {key}")
    require(isinstance(units, list) and 0 < len(units) <= 20000, "Empty or oversized corpus")
    hosts = m["allowed_hosts"]
    require(isinstance(hosts, list) and hosts and all(isinstance(x,str) and x for x in hosts), "Missing hosts")
    coverage = m["coverage"]
    expected = coverage["expected_page_ids"]
    require(isinstance(expected, list) and expected and all(isinstance(x,str) and x for x in expected), "Missing inventory")
    require(len(set(expected)) == len(expected), "Duplicate inventory page")
    require(type(coverage["complete"]) is bool, "Invalid completeness flag")
    require(isinstance(coverage["note"], str) and coverage["note"].strip(), "Missing coverage note")
    seen = set()
    pages = set()
    for u in units:
        require(isinstance(u["id"],str) and IDENTIFIER.fullmatch(u["id"]), "Invalid unit id")
        require(u["id"] not in seen, "Duplicate unit id")
        seen.add(u["id"])
        require(u["book_id"] == m["book_id"], "Cross-book unit")
        for key in ("title", "text", "page_id", "fetched_at", "reviewer"):
            require(isinstance(u[key],str) and bool(u[key].strip()), f"Invalid unit {key}")
        require(len(u["text"]) <= 30000, "Unit too long; split only at reviewed issue boundaries")
        require(u["page_id"] in expected, "Unit outside declared inventory")
        pages.add(u["page_id"])
        for ref in u.get("source_refs",[]):
            require(isinstance(ref,dict) and str(ref.get("page_id")) in expected, "Source reference outside inventory")
            pages.add(str(ref["page_id"]))
        require(isinstance(u["path"],list) and u["path"] and all(isinstance(p,str) and p for p in u["path"]), "Missing scholarly path")
        require(u["verification"] == "reviewed", "Unreviewed unit")
        require(u.get("boundary_review_required") is not True, "Unreviewed source boundary")
        require(u.get("url_verification") in (None,"verified"), "Cross-source URL mapping needs verification")
        require(isinstance(u["footnotes"],list), "Missing footnotes")
        for footnote in u["footnotes"]:
            require(isinstance(footnote,dict) and isinstance(footnote.get("text"),str)
                    and bool(footnote["text"].strip()), "Invalid footnote")
            if "start" in footnote or "end" in footnote:
                start,end = footnote.get("start"),footnote.get("end")
                require(type(start) is int and type(end) is int and 0 <= start < end <= len(u["text"]),
                        "Invalid footnote offsets")
                require(u["text"][start:end] == footnote["text"], "Footnote text does not match its position")
            else:
                marker=footnote.get("marker")
                require(isinstance(marker,str) and bool(marker) and marker in u["text"], "Unlinked footnote")
        parsed = urlparse(u["url"])
        require(parsed.scheme == "https" and parsed.hostname in hosts and not parsed.username
                and not parsed.password and parsed.port in (None,443), "Unsafe/unapproved source URL")
        require(not any(c.isspace() or ord(c)<32 for c in u["url"]), "Invalid URL characters")
        require(u["sha256"] == digest(u["text"]), "Content hash mismatch")
        datetime.fromisoformat(u["fetched_at"].replace("Z", "+00:00"))
    for u in units:
        for key in ("previous_id", "next_id"):
            require(u.get(key) is None or u[key] in seen, "Broken context link")
    if coverage["complete"]:
        require(pages == set(expected), "Incomplete page coverage")
        require(coverage.get("structure_reviewed") is True, "Completeness needs structural review")
    require(isinstance(m["rights"]["evidence"], str), "Missing rights evidence field")
    mode=m.get("retrieval",{}).get("mode")
    require(mode in (None,"lexical","semantic","hybrid"), "Invalid retrieval mode")
    return m, units


def import_bundle(store, bundle, embedder=None):
    m, units = validate(bundle)
    require_grants(m, "index")
    vectors = [None] * len(units)
    model = ""
    chunks = []
    if embedder and embedder.enabled:
        require_grants(m, "embeddings")
        if getattr(embedder, "uses_network", False):
            require_grants(m, "provider_processing")
        model = embedder.model
        if m.get("retrieval",{}).get("chunk_chars"):
            chunks = index_chunks(store,m,units,embedder)
        for start in range(0, 0 if chunks else len(units), 16):
            batch = units[start:start+16]
            encode = getattr(embedder, "embed_documents", embedder.embed)
            result = encode([u["title"] + "\n" + " / ".join(u["path"]) + "\n" + u["text"] for u in batch])
            require(len(result) == len(batch) and all(valid_vector(v) for v in result), "Invalid embeddings")
            vectors[start:start+len(batch)] = result
        if not chunks:
            require(len({len(v) for v in vectors}) == 1, "Embedding dimensions changed")
    require(m.get("retrieval",{}).get("mode") not in {"semantic","hybrid"} or bool(model),
            "Semantic retrieval requires an embedding provider during import")
    fingerprint = digest({"manifest": m, "units": units, "model": model, "vectors": vectors,"chunks":chunks})
    with store.connect() as db:
        existing = db.execute("SELECT scope FROM books WHERE id=?", (m["book_id"],)).fetchone()
        # The initial placeholder can adopt its first declared scope. Published scopes are stable.
        count = db.execute("SELECT count(*) FROM releases WHERE book_id=?", (m["book_id"],)).fetchone()[0]
        require(not existing or not count or existing["scope"] == m["scope"], "Book scope is immutable; use a new book id")
        db.execute("INSERT OR IGNORE INTO books(id,title,scope) VALUES(?,?,?)", (m["book_id"],m["title"],m["scope"]))
        if not count:
            db.execute("UPDATE books SET title=?,scope=? WHERE id=?", (m["title"],m["scope"],m["book_id"]))
        require(not db.execute("SELECT 1 FROM releases WHERE book_id=? AND id=?", (m["book_id"],m["release_id"])).fetchone(), "Release already exists; choose a new release id")
        db.execute("INSERT INTO releases(book_id,id,manifest,fingerprint,model) VALUES(?,?,?,?,?)",
                   (m["book_id"],m["release_id"],json.dumps(m,ensure_ascii=False),fingerprint,model))
        for u,v in zip(units,vectors):
            db.execute("INSERT INTO units VALUES(?,?,?,?,?,?)", (m["book_id"],m["release_id"],u["id"],
                       json.dumps(u,ensure_ascii=False),normalize(u["text"]),json.dumps(v) if v else None))
        for c in chunks:
            db.execute("INSERT INTO chunks VALUES(?,?,?,?,?,?,?)",(m["book_id"],m["release_id"],c["unit_id"],c["ordinal"],c["start"],c["end"],json.dumps(c["vector"])))
        db.execute("INSERT INTO audit(book_id,release_id,action) VALUES(?,?,?)", (m["book_id"],m["release_id"],"import"))
    return {"book_id": m["book_id"], "release_id": m["release_id"], "units": len(units), "fingerprint": fingerprint}


def evaluate(store, book, release_id, cases, embedder=None):
    release = store.release(book, release_id)
    require(release is not None, "Unknown release")
    require(isinstance(cases,list) and cases, "Missing evaluation cases")
    ids = {u["id"] for u in release["units"]}
    modes = ["lexical", "semantic", "hybrid"] if release["model"] else ["lexical"]
    report = {"fingerprint": release["fingerprint"], "suite_sha256": digest(cases), "cases": len(cases),
              "created_at": datetime.now().astimezone().isoformat(), "modes": {}, "human_review": False}
    unique = set()
    for c in cases:
        require(isinstance(c.get("question"),str) and c["question"].strip(), "Missing evaluation question")
        require(c["question"] not in unique, "Duplicate evaluation question")
        unique.add(c["question"])
        require(c.get("split") == "heldout", "Publication suite must be held out")
        require(isinstance(c.get("expected_ids"),list) and all(x in ids for x in c["expected_ids"]), "Invalid evaluation gold ids")
    for mode in modes:
        rows = []
        for case in cases:
            start = time.perf_counter()
            found = search(release, case["question"], mode, embedder, limit=3)
            actual = [u["id"] for u in found]
            expected = case["expected_ids"]
            passed = bool(set(expected) & set(actual)) if expected else not actual
            for u in found:
                verified_citation(u,u["text"])
            rows.append({"question":case["question"],"expected":expected,"actual":actual,
                         "passed":passed,"top1":bool(actual and actual[0] in expected),
                         "reciprocal_rank":next((1/(i+1) for i,x in enumerate(actual) if x in expected),0),
                         "milliseconds":round((time.perf_counter()-start)*1000,2)})
        times = sorted(r["milliseconds"] for r in rows)
        positive = [r for r in rows if r["expected"]]
        report["modes"][mode] = {"passed":sum(r["passed"] for r in rows),"total":len(rows),
                                "positive_cases":len(positive),
                                "top1":sum(r["top1"] for r in positive),
                                "mrr_at_3":round(statistics.mean(r["reciprocal_rank"] for r in positive),4) if positive else None,
                                "median_ms":statistics.median(times),
                                "p95_ms":times[min(len(times)-1,int(len(times)*0.95))],"results":rows}
    # The lexical baseline is measured, not required to match the proposed hybrid system.
    # Otherwise semantic improvements on paraphrases would prevent publication.
    report["required_mode"] = active_mode(release)
    chosen = report["modes"][report["required_mode"]]
    report["passed"] = len(cases) >= 40 and chosen["passed"] == chosen["total"]
    with store.connect() as db:
        db.execute("UPDATE releases SET report=? WHERE book_id=? AND id=?", (json.dumps(report,ensure_ascii=False),book,release_id))
    return report


def publish(store, book, release_id, reviewer):
    require(isinstance(reviewer,str) and reviewer.strip(), "Reviewer identity is required")
    with store.connect() as db:
        row = db.execute("SELECT * FROM releases WHERE book_id=? AND id=?", (book,release_id)).fetchone()
        require(row is not None, "Unknown release")
        manifest = json.loads(row["manifest"])
        report = json.loads(row["report"]) if row["report"] else {}
        require(report.get("passed") and report.get("fingerprint") == row["fingerprint"], "Release has not passed evaluation")
        require_public_display(manifest)
        if book == BOOK_ID:
            require(manifest["coverage"].get("complete") is True, "The current book must be complete before publication")
            require(manifest.get("identity_review",{}).get("verified") is True
                    and bool(manifest.get("identity_review",{}).get("evidence")), "Book identity comparison is required")
            require(len(manifest["coverage"]["expected_page_ids"]) == EXPECTED_RECORDS
                    and manifest.get("source_ids") == SOURCE_IDS, "Full verified 1708 inventory is required")
            require(bool(row["model"]) and report.get("required_mode") in {"semantic","hybrid"},
                    "This book requires an evaluated semantic index")
        require(manifest.get("scientific_review",{}).get("approved") is True
                and bool(manifest["scientific_review"].get("reviewer", "").strip()), "Scientific review is required")
        db.execute("UPDATE books SET active_release=? WHERE id=?", (release_id,book))
        db.execute("INSERT INTO audit(book_id,release_id,action) VALUES(?,?,?)", (book,release_id,"publish:"+reviewer))
    return {"book_id":book,"active_release":release_id}
