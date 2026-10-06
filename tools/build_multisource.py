"""Build private, language-separated static shards from existing imported data.

No text is fetched and no source is implicitly granted publication permission.
"""
import argparse
import hashlib
import json
import shutil
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from raf.store import Store
from raf.catalog import BOOK_ID
from raf.local_embeddings import LocalEmbedder
from raf.fielded_search import terms, STOP, CONCEPTS

EXTRA_FAMILIES=[
    'كتابة كتابه نقش نقوش تدوين', 'قبر قبور مقبرة مقابر',
    'جمل جمال ناقة نوق ابل', 'حليب لبن', 'شفاف شفافة شفافه شفافا',
    'استماع انصات انصاتا استمع يستمع', 'بخاخ بخاخات',
]
# General word equivalences; never query-to-answer mappings.
for family in EXTRA_FAMILIES:
    words=family.split();CONCEPTS.update({w:words[0] for w in words})
STOP.update('the a an is are was were be been being of to for with and or but this that these those do does did should can could would may i you we they it my your our their what how when where why in on at by from about as not if than then also please show tell according sources source answer question'.split())


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
    return hashlib.sha256(path.read_bytes()).hexdigest()


def bucket(term):
    value=0
    for char in term:value=(value*31+ord(char))&0xffffffff
    return value%64


def source(output,source_id,language,title,units,vectors,coverage,chunks=None):
    target=output/'data'/source_id;target.mkdir(parents=True,exist_ok=True)
    metadata=[];postings=[defaultdict(list) for _ in range(64)];full_shards=defaultdict(dict)
    matrix=np.zeros((len(units),384),dtype=np.float32);semantic=0
    for i,u in enumerate(units):
        u=dict(u);u.pop('vector',None);u['language']=language;u['book_id']=source_id
        shard=i//64;full_shards[shard][u['id']]=u
        fields=[Counter(terms(u['title'])),Counter(terms(u.get('question') or '')),Counter(terms(u['text']))]
        if u.get('retrievable',True):
            for j,f in enumerate(fields):
                for t,tf in f.items():postings[bucket(t)][t].append([i,j,tf])
        vector=vectors.get(u['id'])
        if vector is not None:
            arr=np.array(vector,dtype=np.float32);matrix[i]=arr/max(np.linalg.norm(arr),1e-12);semantic+=1
        metadata.append({'id':u['id'],'reference':u.get('reference'),'title':u['title'],
                         'question':(u.get('question') or '')[:600],'path':u['path'],'shard':shard,
                         'retrievable':u.get('retrievable',True),'content_type':u.get('content_type','qa'),
                         'lengths':[sum(f.values()) for f in fields],'has_vector':vector is not None,
                         'sha256':u['sha256']})
    hashes={}
    hashes['index.json']=write(target/'index.json',metadata)
    for number,full in full_shards.items():hashes[f'text/{number}.json']=write(target/f'text/{number}.json',full)
    for number,posting in enumerate(postings):hashes[f'lex/{number}.json']=write(target/f'lex/{number}.json',posting)
    # Quantized vectors reduce transfer 4x. Normalize after decoding in the worker.
    np.rint(matrix*127).astype('int8').tofile(target/'focus.i8')
    hashes['focus.i8']=hashlib.sha256((target/'focus.i8').read_bytes()).hexdigest()
    if chunks:
        positions={u['id']:i for i,u in enumerate(units)}
        values=np.array([c['vector'] for c in chunks],dtype=np.float32)
        values/=np.maximum(np.linalg.norm(values,axis=1,keepdims=True),1e-12)
        np.rint(values*127).astype('int8').tofile(target/'chunks.i8')
        hashes['chunks.i8']=hashlib.sha256((target/'chunks.i8').read_bytes()).hexdigest()
        hashes['chunk-units.json']=write(target/'chunk-units.json',[positions[c['unit_id']] for c in chunks])
    counts=Counter(u.get('content_type','qa') for u in units)
    return {'id':source_id,'language':language,'title':title,'enabled':True,'research':True,
            'format':'sharded-v1','units':len(units),'dimension':384,'semantic_units':semantic,
            'retrievable':sum(u.get('retrievable',True) for u in units),'has_chunks':bool(chunks),
            'average_lengths':np.mean([u['lengths'] for u in metadata],axis=0).tolist(),
            'hashes':hashes,'coverage':coverage,'types':dict(counts),
            'bytes':sum(p.stat().st_size for p in target.rglob('*') if p.is_file())}


def main(output, database='var/local-research.sqlite3', book_ids=None):
    output=Path(output).resolve()
    if not output.is_relative_to(Path('private').resolve()):raise ValueError('Private build only')
    output.mkdir(parents=True,exist_ok=True);shutil.copytree('site',output,dirs_exist_ok=True)
    catalog=[];store=Store(database);expected_model=LocalEmbedder('var/models/multilingual-e5-small').model
    for book_id in dict.fromkeys(book_ids or [BOOK_ID]):
        r=store.release(book_id)
        if not r:raise ValueError(f'No active tested release for {book_id}')
        if r['model']!=expected_model:raise ValueError('The release uses a different embedding model')
        manifest=r['manifest']
        coverage={'records':len(manifest.get('coverage',{}).get('expected_page_ids',[])),
                  'incomplete_units':sum(u.get('content_type')=='source_incomplete' for u in r['units']),
                  'note':'Imported release coverage; not independent scholarly validation'}
        catalog.append(source(output,book_id,manifest.get('language','ar'),manifest['title'],r['units'],
                       {u['id']:u['vector'] for u in r['units'] if u.get('vector')},coverage,r['chunks']))
    for lang in ('ar','en'):
        paths=sorted(Path(f'private/islamqa/clean/{lang}').glob('*.json'),key=lambda p:int(p.stem))
        if not paths:continue
        print(f'Loading {len(paths)} {lang} answers',flush=True)
        units=[json.loads(p.read_text(encoding='utf-8')) for p in paths]
        expected_hashes={u['id']:hashlib.sha256((u['title']+'\n'+u['question'])[:320].encode()).hexdigest() for u in units}
        vectors={}
        for db_path in [Path('private/islamqa/vectors.sqlite3'),Path(f'private/islamqa/vectors-{lang}.sqlite3')]:
            if db_path.exists():
                with sqlite3.connect(db_path) as db:
                    for uid,sha,vec in db.execute('SELECT id,hash,vector FROM vectors WHERE id LIKE ? AND model=?',(f'islamqa-{lang}-%',expected_model)):
                        if expected_hashes.get(uid)==sha:vectors[uid]=np.frombuffer(vec,dtype='<f4')
        report=json.loads(Path(f'private/islamqa/report-{lang}.json').read_text(encoding='utf-8'))
        catalog.append(source(output,'islamqa-'+lang,lang,'الإسلام سؤال وجواب' if lang=='ar' else 'Islam Question & Answer',units,vectors,report))
    write(output/'catalog.json',catalog)
    write(output/'vocabulary.json',{'stop':sorted(STOP),'concepts':CONCEPTS})
    write(output/'settings.json',{'competitionMode':False,'disabledSources':[],'competitionUnconfirmed':['islamqa-ar','islamqa-en'],'release':'0.7-research'})
    (output/'.nojekyll').touch()
    print('Built isolated language/source shards at '+str(output),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',default='private/pages-preview/raf-v07')
    p.add_argument('--database',default='var/local-research.sqlite3');p.add_argument('--book',action='append')
    a=p.parse_args();main(a.output,a.database,a.book)
