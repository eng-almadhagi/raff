"""Compare retrieval modes on a frozen original corpus without publishing a book."""
import argparse
import json
import statistics
import time
from pathlib import Path
from raf.embeddings import create_embedder
from raf.retrieval import search
from raf.text import digest


def run(corpus, embedder):
    units = []
    for document in corpus["documents"]:
        units.append({"id":document["id"],"title":document["title"],"text":document["text"],
                      "path":[],"vector":None})
    start = time.perf_counter()
    vectors = embedder.embed_documents([u["title"]+"\n"+u["text"] for u in units])
    for unit,vector in zip(units,vectors):
        unit["vector"] = vector
    index_seconds = time.perf_counter()-start
    release = {"model":embedder.model,"units":units,"manifest":{}}
    report = {"dataset_sha256":digest(corpus),"model":embedder.model,"documents":len(units),
              "index_seconds":round(index_seconds,3),"scope":"synthetic engineering examples, not fiqh",
              "human_review":False,"modes":{}}
    for mode in ("lexical","semantic","hybrid"):
        results = []
        for doc in corpus["documents"]:
            for query in doc["queries"]:
                start = time.perf_counter()
                ids = [u["id"] for u in search(release,query,mode,embedder,limit=3)]
                results.append({"question":query,"expected":doc["id"],"actual":ids,
                                "top1":bool(ids and ids[0]==doc["id"]),"top3":doc["id"] in ids,
                                "milliseconds":round((time.perf_counter()-start)*1000,2)})
        times = sorted(r["milliseconds"] for r in results)
        report["modes"][mode] = {"cases":len(results),"top1":sum(r["top1"] for r in results),
                                 "top3":sum(r["top3"] for r in results),
                                 "median_ms":statistics.median(times),
                                 "p95_ms":times[min(len(times)-1,int(len(times)*0.95))],"results":results}
    return report


if __name__ == "__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--corpus",default="evaluation/semantic-benchmark.json")
    parser.add_argument("--output",default="var/semantic-benchmark-result.json")
    args=parser.parse_args()
    report=run(json.loads(Path(args.corpus).read_text(encoding="utf-8")),create_embedder())
    Path(args.output).parent.mkdir(parents=True,exist_ok=True)
    Path(args.output).write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({**report,"modes":{k:{n:v for n,v in m.items() if n!="results"} for k,m in report["modes"].items()}},ensure_ascii=False,indent=2))
