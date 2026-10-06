"""Extractive responses only: no unverified religious claim is generated."""
from .policy import classify, MESSAGES, LEVELS
from .retrieval import search, active_mode
from .text import normalize, digest
from .rights import require_public_display


def resolve_query(question, history=None):
    """Resolve short explicit follow-ups from user context only, never model prose."""
    q = normalize(question).strip()
    followup = q.startswith(("وماذا", "وهل", "ومتي", "واين", "وكيف"))
    if followup and history and len(question.split()) <= 8:
        return history[-1] + "\nسؤال المتابعة: " + question
    return question


def verified_citation(unit, quote):
    if not quote or quote not in unit["text"] or (unit.get('sha256') and digest(unit['text'])!=unit['sha256']):
        raise ValueError("Quotation does not match source")
    return {"id": unit["id"], "title": unit["title"], "path": unit["path"],
            "source_refs":unit.get("source_refs",[]), "mufti":unit.get("mufti"),
            "question":unit.get("question"), "answer":unit.get("answer"),
            "content_type":unit.get('content_type','qa'),
            "url": unit["url"], "quote": quote, "footnotes": unit["footnotes"],
            "attribution": "نقلًا عن المصدر المسجل؛ لم تُراجع الكتب المحال إليها مباشرة"}


def answer(store, book, question, history=None, embedder=None, research=False):
    query = resolve_query(question, history)
    kind = classify(query)
    result = {"kind": kind, "level": LEVELS.get(kind), "citations": [], "book_id": book}
    if kind in MESSAGES:
        return dict(result, message=MESSAGES[kind])
    release = store.release(book)
    if release is None:
        return dict(result, kind="unavailable", message=MESSAGES["unavailable"])
    try:
        if not (research and release["manifest"].get("research_only")):
            require_public_display(release["manifest"])
    except ValueError:
        return dict(result, kind="unavailable", message=MESSAGES["unavailable"])
    mode = active_mode(release)
    if release['manifest'].get('retrieval',{}).get('algorithm')=='fielded-v2':
        from .fielded_search import ranked, sufficient
        candidates=ranked(release,query,mode,embedder,limit=8)
        plural=kind=='qualified' or any(word in normalize(question) for word in ('فتاوي','النصوص','اكثر من','قارن'))
        if (not plural and len(candidates)>1 and sufficient(candidates[0][1]) and candidates[0][1]['focus']<.88
                and candidates[0][1]['score']-candidates[1][1]['score']<.025):
            return dict(result,kind='clarify',level=None,
                        message='وجدت مواضع متقاربة، ولم أتحقق من أن أحدها يطابق قصدك. اختر المسألة المقصودة أو أعد صياغة السؤال.',
                        suggestions=[u['title'] for u,_ in candidates[:3]])
        # Never skip an unsupported best match and substitute a lower, incidental hit.
        found=[]
        if candidates and sufficient(candidates[0][1]):
            best=candidates[0][1]['focus']
            found=[unit for unit,signal in candidates if sufficient(signal) and signal['focus']>=best-.02]
    else:
        found = search(release, query, mode, embedder)
    if not found:
        return dict(result, kind="insufficient", level=None, message="لم أجد جوابًا موثوقًا في «" + release["manifest"]["title"] + "» لهذا السؤال. لا أستكمل الإجابة من معرفة عامة.")
    plural=kind=='qualified' or any(word in normalize(question) for word in ('فتاوي','النصوص','اكثر من','قارن'))
    citations = [verified_citation(u, u["text"]) for u in found[:3 if plural else 1]]
    if research:
        for citation, unit in zip(citations,found):
            citation["attribution"] += " — تجربة محلية؛ البنية مفحوصة تقنيًا وليست اعتمادًا علميًا."
    message = "هذه فتاوى ونصوص منقولة من الكتاب، وليست فتوى جديدة أو تطبيقًا على حالتك. اقرأ السؤال الأصلي وقيود الجواب وحواشيه؛ كل نتيجة مستقلة عن الأخرى."
    if kind == "qualified":
        message = "هذه المادة المتاحة في المصدر. لا تعني أنها تستوعب جميع الأقوال، ولا يرجّح رَف بينها من عنده."
    if research:
        message = "نتائج بحث محلي تجريبي في النص المحفوظ؛ ليست إجابة معتمدة على السؤال. " + message
    return dict(result, message=message, citations=citations, release_id=release["id"],
                mode=mode, response_mode="extractive")
