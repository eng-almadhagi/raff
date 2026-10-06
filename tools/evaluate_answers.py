"""Evaluate frozen new questions, full quotations, source spans, references and routing."""
import json
import argparse
from pathlib import Path
from unittest.mock import patch
from raf.answers import answer
from raf.local import ResearchStore
from raf.local_embeddings import LocalEmbedder
from raf.catalog import BOOK_ID


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--cases',default='unseen-cases.json')
    parser.add_argument('--output',default='unseen-result-first.json')
    args=parser.parse_args()
    root=Path('private/fatawa1708')
    cases=json.loads((root/args.cases).read_text(encoding='utf-8'))
    source=json.loads((root/'full-export.json').read_text(encoding='utf-8'))
    pages={p['page_id']:p for p in source['pages']}
    groups={}
    for p in source['pages']:
        group=int(p['part'])-1
        groups[group]=groups.get(group,'')+p['body']+'\n'+(p.get('footnotes','')+'\n' if p.get('footnotes') else '')
    store=ResearchStore();release=store.release(BOOK_ID)
    units={u['id']:u for u in release['units']}
    model=LocalEmbedder('var/models/multilingual-e5-small')
    results=[]
    with patch('socket.socket.connect',side_effect=AssertionError('No external fetch during answers')):
        for case in cases:
            response=answer(store,BOOK_ID,case['question'],embedder=model,research=True)
            citations=response['citations'];integrity=True
            for citation in citations:
                unit=units[citation['id']]
                integrity &= citation['quote']==unit['text']==groups[unit['source_group']][unit['stream_start']:unit['stream_end']]
                integrity &= citation['source_refs']==unit['source_refs']
                for ref in citation['source_refs']:
                    integrity &= all(ref[k]==pages[ref['page_id']].get(k) for k in ('part','page_num','sequence_num'))
                integrity &= citation['url']==f"https://app.turath.io/book/1708?page={unit['source_refs'][0]['sequence_num']}"
                integrity &= unit.get('retrievable') is True
                integrity &= all(citation['quote'][n['start']:n['end']]==n['text'] for n in citation['footnotes'])
            selected=[c for c in citations if c['id'] in case.get('ids',[])]
            if case['expected']=='citation':
                passed=bool(selected) and all(any(t in c['quote'] for c in selected) for t in case['constraints'])
                if case['type']=='multiple':passed &= len(selected)>=2
            else:passed=response['kind']==case['expected'] and not citations
            results.append(dict(case,passed=bool(passed and integrity),integrity=bool(integrity),
                                kind=response['kind'],actual_ids=[c['id'] for c in citations],
                                titles=[c['title'] for c in citations],message=response['message']))
    output={'passed':sum(r['passed'] for r in results),'total':len(results),
            'quote_and_reference_integrity':all(r['integrity'] for r in results),
            'network_disabled':True,'results':results,
            'scope':'source-grounded technical/content checks by developer; no independent scholar approval'}
    target=root/args.output
    if target.exists():raise ValueError('Preserve first-run results; choose another output name')
    target.write_text(json.dumps(output,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(output,ensure_ascii=False))


if __name__=='__main__':main()
