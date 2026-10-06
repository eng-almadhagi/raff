import { normalize } from "./core.mjs?v=0.16.1";

export const policyMessages = {
  ar: {
    "clarify-zakat": "اختر نوع الزكاة لعرض النصوص التي تجيب عن سؤالك:",
    refer:
      "هذا السؤال يتطلب معرفة تفاصيل حالتك من مختص مؤهل. لا يصدر رَفّ حكمًا شخصيًا نهائيًا. يمكنك البحث بصياغة عامة عن النصوص المنشورة ذات الصلة.",
    clarify:
      "ما المقصود تحديدًا؟ اذكر المسألة والسياق دون بيانات شخصية حتى أبحث في النص المناسب.",
    insufficient:
      "لم نعثر على جواب مناسب في هذا المصدر. لا نكمل الجواب من معرفة عامة.",
    refuse:
      "لا نختلق دليلًا أو إجماعًا أو مرجعًا، ولا نكمل النص الناقص بالتوليد. نعرض ما ورد في المصادر مع نسبته إليها.",
    verify:
      "لا أستطيع إثبات صحة هذا النص المنسوب بمجرد الطلب. يلزم نص موثّق ومصدر وتحقق مستقل؛ لن أختلق حديثًا يوافق العبارة.",
    identity:
      "رَفّ أداة بحث ومساعدة بالذكاء الاصطناعي، تعرض نصوص المصادر ومراجعها، ولا تصدر فتوى شخصية.",
    profile:
      "لا أستنتج درجة التزامك الديني من أسئلتك. أستطيع مساعدتك في الوصول إلى المصادر دون الحكم عليك.",
    context:
      "لا توجد فتوى سابقة في هذه اللغة يمكن الرجوع إليها. اطرح المسألة أولًا أو افتح نتيجة موثّقة.",
    language:
      "اللغة المختارة هي الإنجليزية. لن أترجم جوابًا عربيًا لملء نتيجة إنجليزية؛ اختر العربية إن أردت مصادرها.",
  },
  en: {
    "clarify-zakat":
      "Choose the type of zakat to find source texts that answer your question:",
    refer:
      "Your circumstances need a qualified scholar who can examine the details. Raff does not issue a final personal ruling. You may ask a general question to find relevant published source texts.",
    clarify:
      "Which issue do you mean? Please specify the action and context without sharing personal details.",
    insufficient:
      "No suitable answer was found in this source. We do not fill the gap with general knowledge or translated Arabic answers.",
    refuse:
      "We do not invent evidence, consensus, references, or missing passages. We present published texts with attribution.",
    verify:
      "I cannot authenticate the attributed wording merely because it was requested. A documented source and independent verification are needed.",
    identity:
      "Raff is an AI-assisted search tool that presents source texts and references. It does not issue personal fatwas.",
    profile:
      "I do not infer your level of religious commitment from your questions. I can help you find sources without judging you.",
    context:
      "There is no previous answer in this language to return to. Ask a question or open a documented result first.",
    language:
      "English mode uses only officially published English source content. Switch to Arabic to search Arabic sources.",
  },
};

export function classifyPolicy(question, language = "ar") {
  const q = normalize(question).replace(/ة/gu, "ه").trim(),
    words = q.split(/[^\p{L}\p{N}_]+/u);

  if (
    /(?:اختلق|اخترع|من عندك|تجاهل (?:المصادر|التعليمات)|بدون مصدر|رقم صفحه يبدو|حتي لو المصدر|invent|fabricate|fake reference|ignore (?:sources|instructions)|make up (?:a |an )?(?:reference|page number|citation|source))/u.test(
      q,
    )
  )
    return "refuse";
  if (
    /(?:زكا[هت]|\bzaka[th])/iu.test(q) &&
    /مقدار|كم|نسب[هت]|حساب|احسب|نصاب|\b(?:amount|much|rate|calculate|nisab)\b/iu.test(
      q,
    ) &&
    !/ايجار|اجر[هت]|عقار|رواتب|راتب|ديون|قرض|فطر|نقود|مال|اموال|ذهب|فض[هت]|تجار[هت]|زروع|زرع|ثمار|ماشية|ماشيه|انعام|ابل|بقر|غنم|\b(?:fitr|money|wealth|cash|gold|silver|trade|crops?|livestock|rent|rental|income|salary|debt|loan)\b/iu.test(
      q,
    )
  )
    return "clarify-zakat";
  if (
    /(?:هل انت مفت|هل جوابك فتوي شخصيه|are you a mufti|are you a scholar|is this a personal fatwa)/u.test(
      q,
    )
  )
    return "identity";
  if (
    /(?:تعتبرني ملتزم|التزامي الديني|دين.*من اسئلتي|my religious commitment|am i religious|judge my faith)/u.test(
      q,
    )
  )
    return "profile";
  if (
    /(?:حديثا? صحيحا? يقول|صحه حديث|صحة حديث|قال الرسول|قال النبي|قال الله|authenticate.*hadith|sahih hadith.*says)/u.test(
      q,
    )
  )
    return "verify";
  if (
    /(?:سعر الذهب اليوم|اسعار.*اليوم|gold price today|today.s gold price|الطقس|اكتب برنامج|اكتب كود)/u.test(
      q,
    )
  )
    return "insufficient";
  if (
    /^(?:ما حكم|هل يجوز|هل يحل|هل يصح)\s+(?:هذا|ذلك|هذه)(?:\s+(?:الشيء|الامر|الفعل|الحاله))?[؟? .]*$/u.test(
      q,
    )
  )
    return "clarify";
  if (
    [
      "هل يجوز الجمع",
      "هل هذا حرام",
      "هل هذا حلال",
      "هل فيه زكاه",
      "ما حكم العمل",
      "ما حكم المال",
      "وش اسوي الحين",
      "is this haram",
      "is this allowed",
      "can i combine",
    ].includes(q.replace(/[؟?.]+$/u, ""))
  )
    return "clarify";
  if (
    /^is\s+(?:this|that|it)\s+(?:not\s+)?(?:allowed|permissible|forbidden|haram|halal)[? .]*$/iu.test(
      q,
    )
  )
    return "clarify";
  const personal =
    "زوجتي زوجي طلقت طلاقي عقدي راتبي قرضي ميراثي ورثت اشتريت بعت اقترضت حلفت نذرت اجهضت دوائي صيامي زكاتي حجي نكاحي اني عندي ولدي بنتي نسيت سويت دفعت تزوجت افتني".split(
      " ",
    );
  if (
    personal.some((t) => words.includes(t)) ||
    /انا (?!ابحث|اسال عن|اريد معرفه|اريد تعريف)|نصيبي النهائي|حكما? نهائيا?|i divorced|my marriage|my inheritance|i am ill|i.m ill|my medication|final ruling|should i break my fast tomorrow/u.test(
      q,
    )
  )
    return "refer";
  if (
    /(?:الفتوي السابقه|الفتوى السابقه|جوابك السابق|الجواب السابق|that answer|previous answer|original english answer)/u.test(
      q,
    )
  )
    return /(?:كامل|دون اعاده|original|full)/u.test(q)
      ? "followup-full"
      : "followup-summary";
  if (words.filter(Boolean).length < 2 && !/^\d+$/u.test(q)) return "clarify";
  if (
    /(?:قارن|خلاف|اختلاف|اقوال مختلفه|المذاهب|اختلف|الراجح|تكفير|الرده|different opinions|disagreement|compare)/u.test(
      q,
    )
  )
    return "qualified";
  return /(?:ما تعريف|ما معني|ما هي|ما هو|what is|define)/u.test(q)
    ? "information"
    : "explain";
}

export function clarificationChoices(kind, question, language = "ar") {
  if (kind !== "clarify-zakat") return [];
  const types =
    language === "en"
      ? [
          ["Money", "zakat on money"],
          ["Zakat al-Fitr", "zakat al-fitr"],
          ["Gold and silver", "zakat on gold and silver"],
          ["Trade goods", "zakat on trade goods"],
          ["Crops", "zakat on crops"],
          ["Livestock", "zakat on livestock"],
        ]
      : [
          ["زكاة النقود", "زكاة النقود"],
          ["زكاة الفطر", "زكاة الفطر"],
          ["الذهب والفضة", "زكاة الذهب والفضة"],
          ["عروض التجارة", "زكاة عروض التجارة"],
          ["الزروع والثمار", "زكاة الزروع والثمار"],
          ["الماشية", "زكاة الماشية"],
        ];
  return types.map(([label, subject]) => ({
    label,
    question:
      language === "en"
        ? question.replace(/\bzaka[th](?:ah)?\b/iu, subject)
        : question.replace(/(?:ال)?زكا[ةه]/u, subject),
  }));
}

export function classifyLibraryPolicy(question, language) {
  const policy = classifyPolicy(question, language);
  // Personal libraries also contain ordinary manuals. First-person wording alone
  // must not turn a question about borrowing a book into a personal fatwa.
  const religiousCase =
    /فتو|فتاو|شرع|حلال|حرام|حكم|صلا|صوم|صيام|زكا|حج|عمر[ةه]|طلاق|طلقت|زوج|نكاح|ميراث|ورث|ربا|قرض|حلف|نذر|كفار|وضوء|وضوئي|طهار|حيض|دين|افطر|أفطر|\b(?:fatwa|ruling|halal|haram|prayer|fast|fasting|zakat|hajj|divorce|marriage|inheritance|interest|oath)\b/iu;
  return policy === "refer" && !religiousCase.test(question)
    ? "explain"
    : policy;
}

export function directReference(question) {
  const q = question
    .trim()
    .replace(/[٠-٩]/gu, (c) => String(c.charCodeAt(0) - 0x660));
  const m = q.match(
    /^(?:(?:فتوى|فتوي|رقم|فتوى رقم|فتوي رقم|islamqa|fatwa|answer|question|answer number|fatwa number)\s*#?\s*)?(\d{1,8})[؟?.]*$/iu,
  );
  return m ? Number(m[1]) : null;
}
