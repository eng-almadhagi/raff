"""Build a static browser release from the existing index; never fetch book text.

The default output is PRIVATE and must not be uploaded to Pages. A public build
requires the existing rights/scientific release gate. Python is a build tool only.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

import numpy as np

from raf.store import Store
from raf.catalog import BOOK_ID
from raf.fielded_search import STOP, CONCEPTS
from raf.rights import require_public_display
from raf.local_embeddings import LocalEmbedder
from tools.check_full_book import main as check_book

ROOT = Path(__file__).resolve().parents[1]


def build(output, public=False, database='var/local-research.sqlite3', book_id=BOOK_ID):
    if book_id == BOOK_ID:
        check_book()
    if not Path(database).is_file():
        raise ValueError('Index database does not exist')
    release = Store(database).release(book_id)
    if not release:
        raise ValueError('No active release for requested book')
    if release['model'] != LocalEmbedder(ROOT/'var/models/multilingual-e5-small').model:
        raise ValueError('Browser model must match the indexed model exactly')
    if public:
        require_public_display(release['manifest'])
    output = Path(output).resolve()
    if not output.is_relative_to(ROOT / 'private') and not public:
        raise ValueError('Research output must stay in private/')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(ROOT / 'site', output, dirs_exist_ok=True)
    data = output / 'data' / release['book_id']
    data.mkdir(parents=True, exist_ok=True)
    units = release['units']
    ids = {u['id']: i for i, u in enumerate(units)}
    exported = [{k: v for k, v in u.items() if k != 'vector'} for u in units]
    # All units, including incomplete passages and headings, remain browsable.
    (data / 'units.json').write_text(json.dumps(exported, ensure_ascii=False), encoding='utf-8')
    dim = len(next(u['vector'] for u in units if u.get('vector')))
    for name, rows in [('focus', [u.get('vector') or [0]*dim for u in units]),
                       ('chunks', [c['vector'] for c in release['chunks']])]:
        matrix = np.array(rows, dtype='<f4')
        matrix /= np.maximum(np.linalg.norm(matrix, axis=1, keepdims=True), 1e-12)
        matrix.tofile(data / (name + '.f32'))
    (data / 'chunk-units.json').write_text(json.dumps([ids[c['unit_id']] for c in release['chunks']]), encoding='utf-8')
    if public:
        (data / 'approval.json').write_text(json.dumps(release['manifest'],ensure_ascii=False),encoding='utf-8')
    manifest = dict(id=release['book_id'], title=release['manifest']['title'],
                    release=release['id'], units=len(units), dimension=dim,
                    retrievable=sum(u.get('retrievable', True) for u in units),
                    records=len({str(r['page_id']) for u in units for r in u.get('source_refs',[])}), research=not public,
                    parts=len({str(r['part']) for u in units for r in u.get('source_refs',[]) if r.get('part')}),
                    hashes={p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in data.iterdir() if p.is_file()})
    catalog_path=output / 'catalog.json'
    catalog=json.loads(catalog_path.read_text(encoding='utf-8')) if catalog_path.exists() else []
    catalog=[b for b in catalog if b['id']!=book_id]+[manifest]
    catalog_path.write_text(json.dumps(catalog, ensure_ascii=False), encoding='utf-8')
    (output / 'vocabulary.json').write_text(json.dumps({'stop': sorted(STOP), 'concepts': CONCEPTS}, ensure_ascii=False), encoding='utf-8')
    vendor = output / 'vendor'
    vendor.mkdir(exist_ok=True)
    package = ROOT / 'private/transformers-package/package'
    for name in ['transformers.min.js', 'ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']:
        shutil.copy2(package / 'dist' / name, vendor / name)
    shutil.copy2(package / 'LICENSE', vendor / 'TRANSFORMERS-LICENSE.txt')
    model = output / 'models/e5'
    (model / 'onnx').mkdir(parents=True, exist_ok=True)
    source = ROOT / 'var/models/multilingual-e5-small'
    for name in ['tokenizer.json', 'config.json', 'tokenizer_config.json', 'manifest.json']:
        shutil.copy2(source / name, model / name)
    shutil.copy2(source / 'model.onnx', model / 'onnx/model_quantized.onnx')
    (output / '.nojekyll').touch()
    print(f'Static artifact: {output}; research={not public}; no backend required')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', default='private/pages-preview/raf')
    parser.add_argument('--public', action='store_true')
    parser.add_argument('--database', default='var/local-research.sqlite3')
    parser.add_argument('--book', default=BOOK_ID)
    args = parser.parse_args()
    build(args.output, args.public, args.database, args.book)

