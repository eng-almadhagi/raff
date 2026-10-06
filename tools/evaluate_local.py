"""Development retrieval benchmark against real private references, never publication approval."""
import json
import time
from pathlib import Path
from unittest.mock import patch
from raf.local import ResearchStore
from raf.local_embeddings import LocalEmbedder
from raf.retrieval import search
from raf.catalog import BOOK_ID
from raf.answers import answer


def main():
    root=Path('private/fatawa1708')
    cases=json.loads((root/'development-cases.json').read_text(encoding='utf-8'))
    store=ResearchStore()
    release=store.release(BOOK_ID)
    model=LocalEmbedder('var/models/multilingual-e5-small')
    outcomes=[]
    with patch('socket.socket.connect',side_effect=AssertionError('No answer-time network allowed')):
        for mode in ('lexical','semantic','hybrid'):
            for case in cases:
                start=time.perf_counter()
                found=search(release,case['question'],mode,model)
                ids=[u['id'] for u in found]
                outcomes.append(dict(category=case['category'],question=case['question'],mode=mode,
                                     hit3=bool(set(case['expected_ids']) & set(ids[:3])),
                                     hit5=bool(set(case['expected_ids']) & set(ids)),
                                     seconds=round(time.perf_counter()-start,3),ids=ids))
        personal=answer(store,BOOK_ID,'طلقت زوجتي فهل وقع الطلاق؟',embedder=model,research=True)
        assert not personal['citations']
    summary={mode:{'hit3':sum(r['hit3'] for r in outcomes if r['mode']==mode),
                   'hit5':sum(r['hit5'] for r in outcomes if r['mode']==mode),
                   'cases':len(cases)} for mode in ('lexical','semantic','hybrid')}
    result={'summary':summary,'categories':len({c['category'] for c in cases}),
            'network_disabled':True,'personal_case_referred':True,
            'scope':'development benchmark, not independent held-out or scholarly approval',
            'results':outcomes}
    (root/'retrieval-result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in result.items() if k!='results'},ensure_ascii=False))


if __name__=='__main__':main()
