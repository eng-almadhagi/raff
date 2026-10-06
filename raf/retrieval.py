"""BM25 lexical retrieval and optional dense retrieval with reciprocal rank fusion."""
import math
from collections import Counter
from .embeddings import cosine, ProviderError
from .text import tokens


def active_mode(release):
    default = "hybrid" if release["model"] else "lexical"
    return release["manifest"].get("retrieval",{}).get("mode",default)


def search(release, query, mode="lexical", embedder=None, limit=5):
    if mode not in {"lexical", "semantic", "hybrid"}:
        raise ValueError("Unknown search mode")
    if release['manifest'].get('retrieval',{}).get('algorithm')=='fielded-v2':
        from .fielded_search import ranked
        return [unit for unit,_ in ranked(release,query,mode,embedder,limit)]
    units = release["units"]
    if "_lexical" not in release:
        docs = [tokens(u["title"] + " " + " ".join(u["path"]) + " " + u["text"]) for u in units]
        release["_lexical"] = ([Counter(doc) for doc in docs], [len(doc) for doc in docs],
                               Counter(term for doc in docs for term in set(doc)))
    docs, lengths, frequencies = release["_lexical"]
    terms = set(tokens(query))
    average = sum(lengths) / max(1, len(docs))
    scores = []
    for i, doc in enumerate(docs):
        counts = doc
        score = 0
        for term in terms:
            df = frequencies[term]
            tf = counts[term]
            if tf:
                idf = math.log(1 + (len(docs)-df+0.5)/(df+0.5))
                score += idf * tf * 2.2 / (tf + 1.2*(0.25+0.75*lengths[i]/max(average,1)))
        scores.append((i, score))
    lexical = sorted((x for x in scores if x[1] > 0), key=lambda x: (-x[1], x[0]))
    ranking = lexical
    if mode != "lexical":
        if not embedder or not embedder.enabled or release["model"] != embedder.model:
            raise ProviderError("Release needs a matching embedding model")
        vector = embedder.embed_query(query) if hasattr(embedder,"embed_query") else embedder.embed([query])[0]
        if release.get("chunks"):
            indices = {u["id"]:i for i,u in enumerate(units)}
            best = {}
            similarities = chunk_similarities(release,vector)
            for chunk, similarity in zip(release["chunks"],similarities):
                i = indices[chunk["unit_id"]]
                best[i] = max(best.get(i,-1), similarity)
            dense = sorted(best.items(), key=lambda x:(-x[1],x[0]))
        else:
            dense = sorted(((i, cosine(vector, u["vector"])) for i,u in enumerate(units)),
                           key=lambda x: (-x[1], x[0]))
        # Similarity is only a retrieval signal, never an answer confidence.
        dense = [x for x in dense if x[1] >= 0.35]
        if mode == "semantic":
            ranking = dense
        else:
            fused = Counter()
            for ranked in (lexical, dense):
                for rank,(i,_) in enumerate(ranked):
                    fused[i] += 1 / (60 + rank + 1)
            ranking = sorted(fused.items(), key=lambda x: (-x[1], x[0]))
    return [units[i] for i,_ in ranking[:limit]]


def chunk_similarities(release, vector):
    """Optional vectorized cosine; immutable release owns its in-memory cache."""
    try:
        import numpy as np
    except ImportError:
        return [cosine(vector,c["vector"]) for c in release["chunks"]]
    if "_matrix" not in release:
        matrix = np.asarray([c["vector"] for c in release["chunks"]],dtype=np.float32)
        norms = np.linalg.norm(matrix,axis=1,keepdims=True)
        if not np.isfinite(matrix).all() or (norms == 0).any():
            raise ProviderError("Invalid chunk embedding")
        release["_matrix"] = matrix/norms
    query = np.asarray(vector,dtype=np.float32)
    if query.ndim != 1 or query.size != release["_matrix"].shape[1] or not np.isfinite(query).all() or np.linalg.norm(query) == 0:
        raise ProviderError("Embedding dimension mismatch")
    return (release["_matrix"] @ (query/np.linalg.norm(query))).tolist()
