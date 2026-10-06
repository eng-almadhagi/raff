"""Conservative baseline routing. Heuristics are not a scholarly/semantic classifier."""
import re
from .text import normalize

LEVELS = {"information":"أ", "explain":"ب", "qualified":"ج", "refer":"د",
          "verify":"ج", "refuse":"ج", "clarify":None}


def classify(question):
    q = normalize(question)
    if re.fullmatch(r'(?:ما حكم|هل يجوز|هل يحل|هل يصح)\s+(?:هذا|ذلك|هذه)(?:\s+(?:الشيء|الامر|الفعل|الحاله))?[؟? .]*',q):
        return 'clarify'
    if q.strip('؟? .') in ('وش اسوي الحين','ما حكم هذا','هل يجوز ذلك','ما الحكم هنا','هل هذا حرام','هل هذا حلال','هل يجوز هذا','هل فيه زكاه','ما حكم العمل','ما حكم المال'):
        return 'clarify'
    if any(x in q for x in ("تجاهل التعليمات", "اخترع", "بدون مصدر", "احذف الخلاف", "ignore instructions")):
        return "refuse"
    # Explicit non-religious factual requests; this is not a universal topic classifier.
    religious = ("حكم", "شرع", "حلال", "حرام", "يجوز", "فتوي", "فتاوي", "زكاه")
    unrelated = ("عاصمه", "عاصمة", "حاله الطقس", "درجة الحراره", "درجه الحراره",
                 "نتيجه المباراه", "اكتب كود", "اكتب برنامج", "سعر السهم", "اسعار الاسهم")
    if any(term in q for term in unrelated) and not any(term in q for term in religious):
        return "insufficient"
    # Broad collection: personal decisions include family, contracts, health and worship.
    personal = ("زوجتي", "زوجي", "طلقت", "طلاقي", "عقدي", "راتبي", "قرضي", "ميراثي",
                "ورثت", "اشتريت", "بعت", "اقترضت", "حلفت", "نذرت", "اجهضت", "دوائي",
                "صيامي", "زكاتي", "حجي", "نكاحي", "علي كفاره", "انا مريض")
    personal += ("اني ", "عندي ", "عندي؟", "صار لي", "علي شي", "وش اسوي", "ولدي", "بنتي", "نسيت", "سويت", "دفعت", "تزوجت", "ابي اعرف اذا")
    if re.search(r'\bانا\b',q) and not re.search(r'انا (?:ابحث|اسال عن|اريد معرفه|اريد تعريف)',q):
        return 'refer'
    if any(re.search(r'(?<!\w)'+re.escape(x.strip())+r'(?!\w)',q) for x in personal):
        return "refer"
    if any(x in q for x in ("قال الرسول", "قال النبي", "صحه حديث", "صحة حديث", "قال الله")):
        return "verify"
    if any(x in q for x in ("صلاتي صحيحه", "صلاتي صحيحة", "اعيد صلاتي", "علي اعاده", "افطني", "افتني")):
        return "refer"
    if re.search(r"(صليت|نسيت|فاتتني|تركت|سويت|سافرت|نسى|نسي|صلي).*(هل|وش|ماذا|يعيد|اعيد|يعمل)", q):
        return "refer"
    if len(q.split()) < 2 or q in ("ما حكم هذا", "هل يجوز ذلك", "وش اسوي الحين", "ما الحكم هنا", "هل هذا حرام", "هل هذا حلال", "هل يجوز هذا", "هل فيه زكاه", "ما حكم العمل", "ما حكم المال"):
        return "clarify"
    if any(x in q for x in ("خلاف", "المذاهب", "اختلف", "الراجح", "تكفير", "الردة", "الرده", "العقيده التفصيليه")):
        return "qualified"
    if any(x in q for x in ("ما تعريف", "ما معني", "ما هي", "ما هو")):
        return "information"
    return "explain"


MESSAGES = {
    "refuse": "لا أستطيع اختراع دليل أو إخفاء خلاف ورد في المصدر. يمكنني مساعدتك في الوصول إلى نص موثّق.",
    "verify": "لا أبني جوابًا على نص منسوب إلى القرآن أو السنة دون التحقق منه. راجع النص في مصدره الأصلي أولًا.",
    "refer": "هذا السؤال يتعلق بحالة شخصية تحتاج إلى مختص مؤهل يطّلع على تفاصيلها. لا يطبّق رَف فتوى الكتاب على حالتك، ولا يحكم على صحة عبادتك أو عقدك أو نزاعك. يمكنك البحث بصياغة عامة عن النص المنقول في الكتاب.",
    "clarify": "ما المسألة المقصودة تحديدًا؟ اذكر الفعل والسياق حتى أبحث في الموضع المناسب.",
    "unavailable": "لم تُتح بعد نسخة معتمدة من هذا الكتاب. لا أستطيع تقديم جواب موثّق من محتوى لم يكتمل فحصه.",
    "insufficient": "لم أعثر في النسخة المتاحة على مادة كافية لهذا السؤال. هذا لا يعني عدم وجود دليل في المصادر الأخرى.",
}
