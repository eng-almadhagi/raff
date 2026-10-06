"""Technical structure labels; never infer a missing answer or scholarly approval."""
import re
from .book_import import QUESTION, ANSWER
from .text import normalize


def annotate(unit, decisions=None):
    text=unit['text']
    questions=list(QUESTION.finditer(text))
    # Repeated printed 'س س' and a TOC label prefixed by 'س' are not two questions.
    questions=[q for i,q in enumerate(questions) if not (
        i+1<len(questions) and (questions[i+1].start()-q.end()<4 or
        (q.start()==0 and questions[i+1].start()<len(unit['title'])+5)))]
    questions=[q for q in questions if not text[max(0,q.start()-5):q.start()].endswith('النا ')]
    answers=list(ANSWER.finditer(text))
    compact=lambda value: re.sub(r'[^\w]','',normalize(value))
    remainder=compact(text).replace(compact(unit['title']),'')
    structure='qa' if len(questions)==1 and answers else 'qa_group' if questions and answers else 'source_document'
    if not questions and not answers and (len(remainder)<8 or not remainder.strip('0123456789٠١٢٣٤٥٦٧٨٩')):
        structure='heading'
    if not questions and not answers and len(text)<160 and re.match(r'\s*(?:[﴿(]|من قرارات|انتهى الجزء|وحول هذا الموضوع|كتاب )',text):
        structure='heading'
    decision=(decisions or {}).get(unit['sha256'],{})
    if decision.get('status')=='source_incomplete':structure='source_incomplete'
    if decision.get('status')=='front_matter':structure='front_matter'
    unit['content_type']=structure
    unit['retrievable']=structure not in {'heading','front_matter','source_incomplete'}
    unit['structure_review']={'method':'source-boundary-and-layout-v2','status':structure,
                              'note':decision.get('reason','Technical layout classification; not scholarly approval')}
    unit['boundary_review_required']=structure=='source_incomplete'
    unit['question']=None;unit['answer']=None
    unit['qa_spans']=[]
    # Keep multi-question/shared answers as one context; never pair by guessing.
    if structure=='qa':
        q=questions[0];a=next((a for a in answers if a.start()>q.end()),None)
        if a:
            unit['question']=text[q.end():a.start()].strip()
            unit['answer']=text[a.end():].strip()
            unit['qa_spans']=[{'question_start':q.end(),'question_end':a.start(),
                               'answer_start':a.end(),'answer_end':len(text)}]
    elif structure=='qa_group':
        unit['question']='\n'.join(text[q.end():min([a.start() for a in answers if a.start()>q.end()]+[len(text)])].strip() for q in questions)
    return unit
