"""Import a complete private export into an isolated local research database."""
import json
from pathlib import Path
from raf.book_import import validate_export
from raf.indexing import index_chunks
from raf.local_embeddings import LocalEmbedder
from raf.store import Store
from raf.text import digest


def main():
    from tools.check_full_book import main as verify_integrity
    verify_integrity()
    root = Path("private/fatawa1708")
    source = json.loads((root/"full-export.json").read_text(encoding="utf-8"))
    validate_export(source, True)
    bundle = json.loads((root/"candidate.json").read_text(encoding="utf-8"))
    report = json.loads((root/"import-manifest.json").read_text(encoding="utf-8"))
    if not report["complete_records"] or report["staged_characters"] != report["stream_characters"]:
        raise ValueError("Incomplete staged source")
    units, manifest = bundle["units"], bundle["manifest"]
    if {str(p['page_id']) for p in source['pages']} != {str(r['page_id']) for u in units for r in u['source_refs']}:
        raise ValueError("Staged page coverage mismatch")
    version=digest([(u['sha256'],u.get('content_type')) for u in units])[:12]
    manifest.update(research_only=True, release_id="local-v2-"+version)
    manifest["coverage"].update(complete=True, note="تجربة محلية: 1816 سجلًا؛ تمت مراجعة البنية تقنيًا مع عزل النصوص الناقصة. ليست مراجعة علمية أو إذن نشر عام.")
    manifest["retrieval"] = {"mode":"hybrid", "chunk_chars":300, "algorithm":"fielded-v2"}
    store, embedder = Store("var/local-research.sqlite3"), LocalEmbedder("var/models/multilingual-e5-small")
    if store.release(manifest["book_id"],manifest["release_id"]):
        print("Local release already imported; no re-embedding.",flush=True)
        return
    def progress(done,total):
        if done % 160 == 0 or done == total:
            print(f"Embeddings {done}/{total}",flush=True)
    chunks = index_chunks(store,manifest,units,embedder,progress)
    # A separate short title/question representation prevents long answers from
    # drowning the actual issue. Original source text is never shortened for display.
    pending=[]
    with store.connect() as db:
        for unit in units:
            if unit.get('retrievable') is False:continue
            focus=(unit['title']+'\n'+(unit.get('question') or unit['text']))[:360]
            key=digest(focus)
            row=db.execute('SELECT vector FROM embedding_cache WHERE book_id=? AND model=? AND text_hash=?',
                           (manifest['book_id'],embedder.model,key)).fetchone()
            if row:unit['_focus_vector']=json.loads(row[0])
            else:pending.append((unit,key,focus))
    for offset in range(0,len(pending),16):
        batch=pending[offset:offset+16]
        vectors=embedder.embed_documents([item[2] for item in batch])
        with store.connect() as db:
            for (unit,key,_),vector in zip(batch,vectors):
                unit['_focus_vector']=vector
                db.execute('INSERT OR IGNORE INTO embedding_cache VALUES(?,?,?,?)',
                           (manifest['book_id'],embedder.model,key,json.dumps(vector)))
        if offset%160==0:print(f'Focus vectors {min(offset+16,len(pending))}/{len(pending)}',flush=True)
    fingerprint = digest(json.dumps(bundle,ensure_ascii=False,sort_keys=True))
    book, release = manifest["book_id"], manifest["release_id"]
    with store.connect() as db:
        db.execute("INSERT INTO releases(book_id,id,manifest,fingerprint,model,report) VALUES(?,?,?,?,?,?)",
                   (book,release,json.dumps(manifest,ensure_ascii=False),fingerprint,embedder.model,json.dumps(report)))
        db.executemany("INSERT INTO units VALUES(?,?,?,?,?,?)",[(book,release,u["id"],json.dumps({k:v for k,v in u.items() if k!='_focus_vector'},ensure_ascii=False),u["text"],json.dumps(u['_focus_vector']) if '_focus_vector' in u else None) for u in units])
        db.executemany("INSERT INTO chunks VALUES(?,?,?,?,?,?,?)",[(book,release,c["unit_id"],c["ordinal"],c["start"],c["end"],json.dumps(c["vector"])) for c in chunks])
        db.execute("UPDATE books SET active_release=? WHERE id=?",(release,book))
    print(json.dumps({"records":report["records"],"units":len(units),"chunks":len(chunks),"research_only":True}),flush=True)


if __name__ == "__main__":
    main()
