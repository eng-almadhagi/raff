"""Apply private source-review decisions and audit every previously flagged interval."""
import json
from collections import Counter
from pathlib import Path
from raf.structure import annotate


def main():
    root=Path('private/fatawa1708')
    bundle=json.loads((root/'candidate.json').read_text(encoding='utf-8'))
    decisions=json.loads((root/'structural-decisions.json').read_text(encoding='utf-8'))
    for unit in bundle['units']:annotate(unit,decisions)
    old=json.loads((root/'before-review/candidate.json').read_text(encoding='utf-8'))
    positions={};audit=[]
    for unit in old['units']:
        group=unit['source_group'];start=positions.get(group,0);end=start+len(unit['text']);positions[group]=end
        if not unit['boundary_review_required']:continue
        current=[u for u in bundle['units'] if u['source_group']==group and u['stream_start']<end and u['stream_end']>start]
        reconstructed=''.join(u['text'][max(0,start-u['stream_start']):min(len(u['text']),end-u['stream_start'])] for u in current)
        audit.append({'old_id':unit['id'],'old_title':unit['title'],'new_ids':[u['id'] for u in current],
                      'dispositions':sorted({u['content_type'] for u in current}),
                      'text_preserved':reconstructed==unit['text'],'review':'technical source layout; not scholarly certification'})
    assert len(audit)==315 and all(row['new_ids'] and row['text_preserved'] for row in audit)
    (root/'candidate.json').write_text(json.dumps(bundle,ensure_ascii=False,indent=2),encoding='utf-8')
    (root/'boundary-review.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2),encoding='utf-8')
    print(dict(Counter(u['content_type'] for u in bundle['units'])))


if __name__=='__main__':main()
