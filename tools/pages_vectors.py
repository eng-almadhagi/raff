"""Reference query vectors for portability regression, never published."""
import json
from pathlib import Path
from raf.local import ResearchStore
from raf.local_embeddings import LocalEmbedder
from raf.fielded_search import ranked

r=ResearchStore().loaded
embedder=LocalEmbedder('var/models/multilingual-e5-small')
cases=json.loads(Path('private/fatawa1708/development-cases.json').read_text(encoding='utf-8'))
if isinstance(cases,dict):
    cases=cases.get('cases',cases.get('questions'))
out=[]
for c in cases:
    q=c['question']
    out.append({'question':q,'vector':embedder.embed_query(q),
                'top':[u['id'] for u,_ in ranked(r,q,'hybrid',embedder,5)]})
Path('private/pages-query-vectors.json').write_text(json.dumps(out,ensure_ascii=False),encoding='utf-8')
print(f'Prepared {len(out)} reference queries')
