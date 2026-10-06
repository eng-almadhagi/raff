"""Incremental, restartable E5 question/title indexing; no network calls."""
import argparse
import hashlib
import json
import sqlite3
import time
from pathlib import Path
import numpy as np
from raf.local_embeddings import LocalEmbedder
from tools.islamqa_import import save


def main(lang, maximum=None):
    root=Path('private/islamqa'); db=sqlite3.connect(root/('vectors-ar.sqlite3' if lang=='ar' else 'vectors.sqlite3'))
    db.execute('CREATE TABLE IF NOT EXISTS vectors (id TEXT PRIMARY KEY, hash TEXT, model TEXT, vector BLOB)')
    model=LocalEmbedder('var/models/multilingual-e5-small')
    rows=[]
    paths=sorted((root/'clean'/lang).glob('*.json'),key=lambda p:int(p.stem))
    for position,p in enumerate(paths):
        if position%500==0:save(root/f'vector-scan-{lang}.json',{'scanned':position,'total':len(paths)})
        u=json.loads(p.read_text(encoding='utf-8'))
        if not u['retrievable']:continue
        representation=(u['title']+'\n'+u['question'])[:320]
        sha=hashlib.sha256(representation.encode()).hexdigest()
        old=db.execute('SELECT hash,model FROM vectors WHERE id=?',(u['id'],)).fetchone()
        if old==(sha,model.model):continue
        rows.append((u['id'],sha,representation))
    pending=len(rows);start=time.monotonic();done=0
    if maximum:rows=rows[:maximum]
    for offset in range(0,len(rows),16):
        batch=rows[offset:offset+16]
        vectors=model.embed_documents([r[2] for r in batch])
        db.executemany('INSERT OR REPLACE INTO vectors VALUES (?,?,?,?)',[(r[0],r[1],model.model,np.array(v,dtype='<f4').tobytes()) for r,v in zip(batch,vectors)])
        db.commit();done+=len(batch)
        save(root/f'vector-progress-{lang}.json',{'language':lang,'new':done,'pending_at_start':pending,'remaining':pending-done,'elapsed_seconds':round(time.monotonic()-start,1),'running':done<len(rows)})
        if done%128==0:print(f'{lang}: {done}/{pending}',flush=True)
    db.close()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--lang',choices=['ar','en'],required=True);p.add_argument('--max',type=int);a=p.parse_args();main(a.lang,a.max)
