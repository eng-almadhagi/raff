"""Fielded Arabic retrieval; normalization is restricted to search representations."""
import math
import re
from collections import Counter
from .text import tokens
from .embeddings import ProviderError

STOP=set('من في على عن الى الي ان انه انها هذا هذه ذلك تلك هو هي هل ما ماذا متى متي كيف كم ثم او ام مع لا لم لن قد لقد يجوز حكم الحكم شرعا شرعي الشرع الذي التي الذين اللي فيه فيها فيهما به بها لهم عليه عليها هناك يكون كان تكون يمكن ورد الكتاب النصوص المتعلقة ارجو اريد ابغى وش شلون عند بعد قبل بين كل بعض فما وهل وما وكيف اذا'.split())
STOP.update('تجوز كيفية متعلق استثناء تفاصيل نقدر'.split())

# Reusable word-level search vocabulary, not answers or query-to-document rules.
# These expansions never change the quotation or determine a religious ruling.
CONCEPTS={}
for family in (
    'توكيل وكالة انابة نيابة تفويض', 'تقسيط اقساط قسط اقساطا',
    'صوم صيام صائم صايم', 'جورب جوارب جوربين جوربان',
    'مسح ينمسح يمسح مسحه', 'صلاة نصليه يصلي نصلي',
    'حيض حائض حايض', 'مراة نساء امراة', 'تيمم يتيمم',
    'سواك استياك تسوك', 'وضوء يتوضا توضؤ',
    'نكاح زواج تزويج', 'طلاق تطليق', 'شراء ابتياع',
    'قرض اقتراض', 'سداد تسديد', 'اجرة اجر',
    'تصدق صدقة', 'صغير اطفال طفل', 'حامل حوامل',
    'مرضع مرضعات', 'فدية فداء', 'اغتسال غسل',
    'مريض مرضي', 'قديم مستعمل', 'سعر ثمن',
    'سيارة سيارات', 'عملة عملات', 'سهم اسهم', 'مال اموال',
):
    words=family.split()
    CONCEPTS.update({word:words[0] for word in words})


def stem(word):
    # Light clitic normalization, not root extraction (which conflates legal terms).
    if word.startswith(('وال','فال','بال','كال')) and len(word)>5:word=word[1:]
    if word.startswith('لل') and len(word)>4:word='ال'+word[2:]
    if word.startswith('ال') and len(word)>4:word=word[2:]
    if len(word)>4:
        word=re.sub(r'(?:تها|ته|تي)$','ة',word)
        word=re.sub(r'(?:هم|ها|كم|نا)$','',word)
    return word


def terms(text):
    result=[]
    for token in tokens(text):
        if token in STOP or token.isdigit() or len(token)<2:continue
        word=stem(token)
        if word in STOP:continue
        # Attached conjunctions/prepositions are stripped only for known vocabulary.
        if word not in CONCEPTS and word[:1] in 'وبفل' and word[1:] in CONCEPTS:
            word=word[1:]
        result.append(CONCEPTS.get(word,word))
    return result


def prepare(release):
    if '_fielded' in release:return release['_fielded']
    units=release['units'];fields=[]
    for u in units:
        fields.append([Counter(terms(u['title'])),Counter(terms(u.get('question') or '')),
                       Counter(terms(u['text']))])
    df=Counter(t for f in fields for t in set().union(*[set(x) for x in f]))
    averages=[sum(sum(f[j].values()) for f in fields)/max(1,len(fields)) for j in range(3)]
    data={'fields':fields,'df':df,'averages':averages}
    release['_fielded']=data
    return data


def ranked(release,query,mode,embedder,limit=5):
    data=prepare(release);units=release['units'];wanted=set(terms(query))
    count=len(units)
    weights={t:math.log(1+(count-data['df'][t]+.5)/(data['df'][t]+.5)) for t in wanted}
    rows=[]
    for i,(unit,fields) in enumerate(zip(units,data['fields'])):
        if unit.get('retrievable') is False:continue
        lexical=0
        for j,field in enumerate(fields):
            length=sum(field.values())
            for term in wanted:
                tf=field[term]
                if tf:lexical+=(2.0,2.5,1.0)[j]*weights[term]*tf*2.2/(tf+1.2*(.25+.75*length/max(data['averages'][j],1)))
        covered=sum(w for t,w in weights.items() if any(t in f for f in fields))/max(sum(weights.values()),1)
        rows.append({'index':i,'lexical':lexical,'coverage':covered,'dense':0.0,'focus':0.0})
    if mode!='lexical':
        if not embedder or not embedder.enabled or embedder.model!=release['model']:
            raise ProviderError('Release needs matching embeddings')
        from .retrieval import chunk_similarities
        import numpy as np
        query_vector=embedder.embed_query(query)
        scores=chunk_similarities(release,query_vector)
        best={}
        for chunk,score in zip(release['chunks'],scores):
            uid=chunk['unit_id'];best[uid]=max(best.get(uid,-1),score)
        if '_focus_matrix' not in release:
            matrix=np.asarray([u.get('vector') or [0.0]*len(query_vector) for u in units],dtype=np.float32)
            norms=np.linalg.norm(matrix,axis=1,keepdims=True)
            release['_focus_matrix']=matrix/np.maximum(norms,1e-12)
        q=np.asarray(query_vector,dtype=np.float32);focus=release['_focus_matrix']@(q/np.linalg.norm(q))
        for row in rows:
            i=row['index'];row.update(dense=best.get(units[i]['id'],0),focus=float(focus[i]))
    maxlex=max((r['lexical'] for r in rows),default=1) or 1
    for row in rows:
        semantic=.8*row['focus']+.2*row['dense']
        if mode=='lexical':row['score']=row['lexical']
        elif mode=='semantic':row['score']=semantic
        else:
            # Preserve rare subject terms and question intent; source length cannot
            # alone make a multi-page discussion outrank a specific source question.
            row['score']=.1*row['lexical']/maxlex+.8*max(0,(semantic-.65)/.35)+.1*row['coverage']
    rows.sort(key=lambda r:(-r['score'],r['index']))
    result=[];seen=set()
    for row in rows:
        if mode=='lexical' and row['lexical']<=0:continue
        unit=units[row.pop('index')]
        # Repeated identical fatwas retain every original location, but occupy one result.
        key=re.sub(r'\W','',(unit.get('question') or '')+(unit.get('answer') or unit['text']))
        if key in seen:continue
        seen.add(key)
        result.append((unit,row))
        if len(result)>=limit:break
    return result


def sufficient(signal):
    """Conservative development gate, not a probability of religious correctness."""
    return ((signal['coverage']>=.4 and signal['focus']>=.84)
            or (signal['coverage']>=.25 and signal['focus']>=.875)
            or (signal['coverage']>=.4 and signal['dense']>=.855))
