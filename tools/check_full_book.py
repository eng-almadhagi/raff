"""Private corpus integrity checks. No source text is written to public reports."""
import json
from pathlib import Path
from raf.book_import import validate_export, archive_source
from raf.text import digest


def main():
    root=Path('private/fatawa1708')
    payload=json.loads((root/'full-export.json').read_text(encoding='utf-8'))
    pages=validate_export(payload,True)
    bundle=json.loads((root/'candidate.json').read_text(encoding='utf-8'))
    report=json.loads((root/'import-manifest.json').read_text(encoding='utf-8'))
    _,sha=archive_source(payload,root/'raw')
    assert sha==report['raw_sha256'], 'Raw archive differs from staging report'
    units=sorted(bundle['units'],key=lambda u:u['order'])
    assert len({u['id'] for u in units})==len(units)
    assert all(digest(u['text'])==u['sha256'] for u in units)
    expected=''.join(p['body']+'\n'+(p.get('footnotes','')+'\n' if p.get('footnotes') else '') for p in pages)
    assert ''.join(u['text'] for u in units)==expected, 'Exact source stream differs'
    refs={str(r['page_id']) for u in units for r in u['source_refs']}
    assert refs=={str(p['page_id']) for p in pages}
    assert all(u['book_id']==bundle['manifest']['book_id'] for u in units)
    for u in units:
        for note in u['footnotes']:
            assert u['text'][note['start']:note['end']]==note['text']
    result={'passed':True,'source_records':len(pages),'units':len(units),
            'exact_stream_characters':len(expected),'raw_sha256':sha,
            'boundary_review_required':sum(u['boundary_review_required'] for u in units),
            'unmatched_headings':len(report['unmatched_headings']),
            'scope':'source integrity only; not scholarly review or retrieval evaluation'}
    (root/'integrity-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(result,ensure_ascii=False))


if __name__=='__main__':main()
