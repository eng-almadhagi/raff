"""Refresh vector files from resumable caches, without rebuilding text or lexical shards."""
import argparse,gzip,hashlib,json,sqlite3
from pathlib import Path
import numpy as np
from tools.islamqa_import import save

def main(directory):
 root=Path(directory).resolve()
 if not root.is_relative_to(Path('private').resolve()):raise ValueError('Private artifact required')
 catalog=json.loads((root/'catalog.json').read_text(encoding='utf-8'))
 for meta in catalog:
  if not meta['id'].startswith('islamqa-'):continue
  lang=meta['language'];base=root/'data'/meta['id'];compressed=meta.get('compression')=='gzip'
  path=base/('index.json.gz' if compressed else 'index.json')
  data=path.read_bytes();index=json.loads(gzip.decompress(data) if compressed else data)
  cache=Path('private/islamqa')/('vectors-ar.sqlite3' if lang=='ar' else 'vectors.sqlite3')
  manifest=json.loads(Path('var/models/multilingual-e5-small/manifest.json').read_text(encoding='utf-8'))
  expected_model='local-e5:'+hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()
  with sqlite3.connect(cache) as db:
   rows={uid:(sha,model,vector) for uid,sha,model,vector in db.execute('SELECT id,hash,model,vector FROM vectors WHERE id LIKE ?',(f'islamqa-{lang}-%',))}
  values=np.zeros((len(index),384),dtype='int8');count=0
  for i,u in enumerate(index):
   row=rows.get(u['id'])
   expected_hash=hashlib.sha256((u['title']+'\n'+u['question'])[:320].encode()).hexdigest()
   vector=row[2] if row and row[:2]==(expected_hash,expected_model) else None
   u['has_vector']=vector is not None
   if vector is not None:
    v=np.frombuffer(vector,dtype='<f4');values[i]=np.rint(v/max(np.linalg.norm(v),1e-12)*127).astype('int8');count+=1
  values.tofile(base/'focus.i8');meta['hashes']['focus.i8']=hashlib.sha256((base/'focus.i8').read_bytes()).hexdigest()
  data=json.dumps(index,ensure_ascii=False,separators=(',',':')).encode()
  path.write_bytes(gzip.compress(data,mtime=0) if compressed else data)
  meta['hashes']['index.json']=hashlib.sha256(path.read_bytes()).hexdigest();meta['semantic_units']=count
  print(meta['id'],count,'/',len(index),flush=True)
 save(root/'catalog.json',catalog)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('directory');main(p.parse_args().directory)
