"""CI assembly only: requires a separately approved static content bundle.

No book is downloaded by this tool, and no Python service is deployed.
"""
import json
import shutil
import re
import hashlib
from pathlib import Path
from raf.rights import require_publication_decision
from tools.pages_runtime import install


def main():
    content=Path('pages-content')
    if not (content/'catalog.json').is_file():
        raise SystemExit('No approved pages-content bundle. Do not publish the private research preview.')
    catalog=json.loads((content/'catalog.json').read_text(encoding='utf-8'))
    if not catalog:
        raise SystemExit('Empty content release')
    approved_files=[content/name for name in ('catalog.json','vocabulary.json','settings.json')]
    for book in catalog:
        if not re.fullmatch(r'[a-z0-9-]+',book['id']) or book.get('format')!='sharded-v1':
            raise SystemExit('A current source-isolated sharded content release is required')
        approval=json.loads((content/'data'/book['id']/'approval.json').read_text(encoding='utf-8'))
        approved_files.append(content/'data'/book['id']/'approval.json')
        mode = require_publication_decision(approval, book['id'])
        if book.get('research', True) and mode != 'operator-directed-preview':
            raise SystemExit('Research release cannot be published without an operator decision')
        base=(content/'data'/book['id']).resolve()
        for name,expected in book['hashes'].items():
            filename=name+('.gz' if name.endswith('.json') and book.get('compression')=='gzip' else '')
            path=(base/filename).resolve()
            if not path.is_relative_to(base) or not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest()!=expected:
                raise SystemExit('Missing or corrupt approved content file')
            approved_files.append(path)
    if not (content/'settings.json').is_file():
        raise SystemExit('Source/competition settings are required')
    output=Path('_site')
    if output.exists():
        raise SystemExit('_site must be a new build directory')
    shutil.copytree('site',output)
    for path in approved_files:
        target=output/path.resolve().relative_to(content.resolve())
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(path,target)
    install(output)
    (output/'.nojekyll').touch()


if __name__=='__main__':main()
