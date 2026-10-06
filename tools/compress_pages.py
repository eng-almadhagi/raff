"""Compress an existing private static release without reimporting source data."""
import argparse,gzip,hashlib,json
from pathlib import Path
from tools.islamqa_import import save

def main(directory):
 root=Path(directory).resolve()
 if not root.is_relative_to(Path('private').resolve()):raise ValueError('Private artifact required')
 catalog=json.loads((root/'catalog.json').read_text(encoding='utf-8'))
 for meta in catalog:
  if meta.get('compression')=='gzip':continue
  for name in list(meta['hashes']):
   if not name.endswith('.json'):continue
   path=root/'data'/meta['id']/name
   if not path.resolve().is_relative_to(root):raise ValueError('Outside artifact')
   original=path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix(path.suffix+'.gz').read_bytes())
   if hashlib.sha256(original).hexdigest()!=meta['hashes'][name]:raise ValueError('Input checksum mismatch')
   packed=gzip.compress(original,compresslevel=6,mtime=0)
   target=path.with_suffix(path.suffix+'.gz');target.write_bytes(packed)
   if gzip.decompress(target.read_bytes())!=original:raise ValueError('Compression verification failed')
   meta['hashes'][name]=hashlib.sha256(packed).hexdigest()
   # Exact byte-for-byte recovery was verified before removing redundant bytes.
   if path.exists():path.unlink()
  meta['compression']='gzip'
  meta['bytes']=sum(p.stat().st_size for p in (root/'data'/meta['id']).rglob('*') if p.is_file())
  print(meta['id'],meta['bytes'],flush=True)
 save(root/'catalog.json',catalog)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('directory');main(p.parse_args().directory)
