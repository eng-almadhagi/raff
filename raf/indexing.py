"""Persistent embeddings for exact source windows; responses retain the full parent unit."""
import json
from .embeddings import valid_vector
from .text import digest


def index_chunks(store, manifest, units, embedder, progress=None):
    size = manifest["retrieval"]["chunk_chars"]
    if type(size) is not int or not 100 <= size <= 400:
        raise ValueError("chunk_chars must be between 100 and 400")
    records, pending = [], {}
    with store.connect() as db:
        for unit in units:
            ordinal, start = 0, 0
            while start < len(unit["text"]):
                end = min(len(unit["text"]), start+size)
                content = unit["text"][start:end]
                if not content.strip():
                    if end == len(unit["text"]): break
                    start = end
                    continue
                key = digest(content)
                row = db.execute("SELECT vector FROM embedding_cache WHERE book_id=? AND model=? AND text_hash=?",
                                 (manifest["book_id"],embedder.model,key)).fetchone()
                vector = json.loads(row[0]) if row else None
                if vector is not None and not valid_vector(vector):
                    raise ValueError("Invalid cached embedding")
                records.append({"unit_id":unit["id"],"ordinal":ordinal,"start":start,"end":end,"key":key,"vector":vector})
                if vector is None: pending[key] = content
                ordinal += 1
                if end == len(unit["text"]): break
                start = end - min(60, size//4)
    items, computed = list(pending.items()), {}
    for offset in range(0,len(items),16):
        batch = items[offset:offset+16]
        encode = getattr(embedder,"embed_documents",embedder.embed)
        vectors = encode([text for _,text in batch])
        if len(vectors) != len(batch) or not all(valid_vector(v) for v in vectors):
            raise ValueError("Invalid chunk embeddings")
        computed.update(zip((key for key,_ in batch),vectors))
        # Durable incremental cache: interruptions do not require encoding completed batches again.
        with store.connect() as db:
            db.executemany("INSERT OR IGNORE INTO embedding_cache VALUES(?,?,?,?)",
                           [(manifest["book_id"],embedder.model,key,json.dumps(v)) for (key,_),v in zip(batch,vectors)])
        if progress:
            progress(min(offset+16,len(items)),len(items))
    for record in records:
        if record["vector"] is None: record["vector"] = computed[record["key"]]
    if len({len(r["vector"]) for r in records}) != 1:
        raise ValueError("Chunk embedding dimensions changed")
    return records
