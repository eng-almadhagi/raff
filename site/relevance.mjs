import { terms, normalize } from "./core.mjs?v=0.16.0";
import { assessIntent, questionProfile } from "./query-intent.mjs?v=0.16.0";

// Presentation words carry little information about the requested subject.
// This layer never changes stored quotations or maps a question to an answer ID.
const framing = new Set(
  "ما ماذا هل حكم كم مقدار مذكور مصدر مصادر بحسب انقل مرجع اعرض اعطني فتوى فتاوي نص نصوص يقول قول اقوال مختلفة شروطها شرطها بالنسبة ذكر يتحدث المذكور استعمال استخدام اداء يتناول مستقيم should say says mentioned sources source according published explain ruling rulings permissible islam islamic islamqa answer answers evidence proof discussed please over using use".split(
    " ",
  ),
);
const numberWords = {
  ستة: "ست",
  الست: "ست",
  واحدة: "واحد",
  ثلاثة: "ثلاث",
  اربعة: "اربع",
  خمسة: "خمس",
  سبعة: "سبع",
  ثمانية: "ثمان",
  تسعة: "تسع",
  عشرة: "عشر",
};
const topicForms = {
  يقرا: "قراءة",
  اقرا: "قراءة",
  اسمع: "استماع",
  يستمع: "استماع",
  ينصت: "استماع",
  يحمل: "حمل",
  سجائر: "تدخين",
  سيجارة: "تدخين",
  دخان: "تدخين",
  تبغ: "تدخين",
  cigarette: "smoking",
  cigarettes: "smoking",
  tobacco: "smoking",
  اختلاف: "خلاف",
  اختلف: "خلاف",
  يختلف: "خلاف",
  تختلف: "خلاف",
  يختلفون: "خلاف",
  اختلفوا: "خلاف",
  مختلف: "خلاف",
  اختلافات: "خلاف",
  فتاوي: "فتوى",
  اجر: "فضل",
  ثواب: "فضل",
  فضيلة: "فضل",
  تفضل: "فضل",
  تفضيل: "فضل",
  اعطاء: "دفع",
  يفطر: "صوم",
  افطار: "صوم",
  مفطر: "صوم",
  مفطرا: "صوم",
  بخاخ: "استنشاق",
  بخاخات: "استنشاق",
  عطور: "عطر",
  طيب: "عطر",
  toothbrush: "brush",
  toothbrushes: "brush",
  brushing: "brush",
  asthma: "asthma",
  asthmatic: "asthma",
};
topicForms.امسح = "مسح";
topicForms.شربة = "مرق";

framing.add("minimum");
framing.add("number");
framing.add("many");
for (const word of ["معه", "ولا", "له", "لها", "لهم", "علي", "عليه", "عليها"])
  framing.add(word);
framing.add("while");
framing.add("through");
framing.add("ادلة");
framing.add("دليل");
for (const word of [
  "consist",
  "consists",
  "single",
  "لماذا",
  "why",
  "مقارنة",
  "مقارنه",
  "فرق",
])
  framing.add(word);
for (const word of [
  "معد",
  "معدة",
  "يتم",
  "بعده",
  "بعدها",
  "قبله",
  "قبلها",
  "ايام",
  "أيام",
  "خلاف",
  "اختلاف",
  "disagreement",
  "opinions",
])
  framing.add(word);
for (const topic of ["اختلاف", "خلاف", "فتوى", "فتاوي", "opinions"])
  framing.delete(topic);
const canonical = (t) =>
  numberWords[t] ||
  topicForms[t] ||
  (/^[a-z]+$/u.test(t) && t.length > 3
    ? t.replace(/(?:ing|s)$/u, "").replace(/e$/u, "")
    : t);
const lexicalVocabularies = new WeakMap();
export function intentTerms(text, vocabulary) {
  text = text.replace(/rak[’'‘-]?a[’']?h?s?/giu, "rakah");
  if (!lexicalVocabularies.has(vocabulary))
    lexicalVocabularies.set(vocabulary, {
      ...vocabulary,
      concepts: { ...vocabulary.concepts, اجر: "فضل" },
    });
  const lexicalVocabulary = lexicalVocabularies.get(vocabulary);
  const filtered = terms(text, lexicalVocabulary).filter(
    (t) => !framing.has(t),
  );
  if (!filtered.length)
    return [...new Set(terms(text, vocabulary).map(canonical))];
  return [...new Set(filtered.map(canonical))];
}

export function answerSupportsQuestion(unit, question, vocabulary) {
  // Some retained book units contain their original س/ج markers rather than a
  // separate answer field. Validate against the answer, not the quoted question.
  // The displayed source text is left intact.
  const answer =
    unit.answer ||
    unit.text?.match(/\sس\s[\s\S]+?\sج\s+([\s\S]+)/u)?.[1] ||
    unit.text;
  if (!question || !answer) return false;
  if (
    /زكا[ةهت].*فطر|\bzaka[th].*\bfitr\b/iu.test(question) &&
    !/فطر|\bfitr\b/iu.test((unit.question || "") + " " + answer)
  )
    return false;
  const temporalObject = normalize(question).match(
    /قبل\s+([\p{L}]+).+بعد/u,
  )?.[1];
  if (temporalObject && !normalize(answer).includes("قبل " + temporalObject))
    return false;
  const comparedWith = question.match(/مقارنة\s+ب(.+)/u)?.[1];
  if (comparedWith) {
    const answerTerms = intentTerms(answer, vocabulary);
    const alternatives = { منفرد: ["منفرد", "فذ", "الفذ", "وحده"] };
    if (
      intentTerms(comparedWith, vocabulary).some(
        (t) => !(alternatives[t] || [t]).some((a) => answerTerms.includes(a)),
      )
    )
      return false;
  }
  if (
    /(?:مقارن|الفرق|compare|compared|versus)/iu.test(question) &&
    !/(?:افضل|أفضل|تفضل|اكثر|أكثر|درجة|ازكي|أزكى|اما|أما|بينما|قبل|بعد|than|compar|whereas)/iu.test(
      answer,
    )
  )
    return false;
  // A general numerical question must not be answered by an unrelated accident
  // or personal exception merely because the answer mentions that quantity.
  if (
    /(?:single|minimum|least|fewest)/iu.test(question) &&
    /^(?:if |when |my |should he |should she |إذا|اذا|حكم من )/iu.test(
      unit.title || "",
    ) &&
    !/^(?:if |when |my |إذا|اذا)/iu.test(question)
  )
    return false;
  if (
    /قبل.+بعد/u.test(question) &&
    (!(answer.includes("قبل") && answer.includes("بعد")) ||
      /لا[^.\n]{0,100}قبل[^.\n]{0,100}ولا بعد/u.test(answer))
  )
    return false;
  const requested = intentTerms(question, vocabulary);
  const body = intentTerms(answer, vocabulary);
  const titleTerms = intentTerms(unit.title || "", vocabulary);
  const titleCoverage =
    requested.filter((t) => titleTerms.includes(t)).length /
    Math.max(1, requested.length);
  // A shared incidental word in a long answer cannot establish its subject.
  // Require the source's stated topic to cover a substantial part of the query.
  const statedTerms = new Set([
    ...titleTerms,
    ...intentTerms(unit.question || "", vocabulary),
  ]);
  const statedCoverage =
    requested.filter((t) => statedTerms.has(t)).length /
    Math.max(1, requested.length);
  const supportedQuantity =
    questionProfile(question).type === "quantity" &&
    titleCoverage >= 0.5 &&
    requested.every((t) => body.includes(t));
  if (
    titleTerms.length &&
    (titleCoverage < 0.3 ||
      (titleCoverage < 0.75 && statedCoverage < 0.75 && !supportedQuantity))
  )
    return false;
  if (
    requested.length <= 2 &&
    titleCoverage >= 0.99 &&
    !(
      requested.length >= 2 && requested.every((t, i) => titleTerms[i] === t)
    ) &&
    requested.length / Math.max(1, titleTerms.length) < 0.5
  )
    return false;
  const context = normalize(unit.title || "").match(
    /(?:^|\s)(?:عند|اثناء|بشكل|during|at)\s+(.+)$/iu,
  )?.[1];
  if (context) {
    const contextTerms = intentTerms(context, vocabulary).filter(
      (t) => !framing.has(t),
    );
    if (contextTerms.length && !contextTerms.some((t) => requested.includes(t)))
      return false;
  }
  // Requested comparisons and numeric limits need affirmative textual support.
  if (
    /minimum|least|fewest/iu.test(question) &&
    !/minimum|least|fewest/iu.test(answer)
  )
    return false;
  if (requested.includes("فضل") && !body.includes("فضل")) return false;
  if (
    requested.includes("فضل") &&
    /مقارنة/u.test(question) &&
    !/(?:درجة|درجه|تفضل|أزكى|ازكي|أكثر أجرا|اكثر اجرا)/u.test(answer)
  )
    return false;
  if (
    requested.includes("خلاف") &&
    requested.includes("فتوى") &&
    !(
      body.includes("خلاف") &&
      (body.includes("فتوى") || body.includes("علماء"))
    )
  )
    return false;
  if (
    /(?:forget|نسيان|ناسيا)/iu.test(question) &&
    !/(?:forget|forgot|نسي|ناسيا)/iu.test(answer)
  )
    return false;
  if (
    /(?:يخطب|اثناء الخطبه|أثناء الخطبة)/u.test(question) &&
    !/(?:خطب|خطبة|خطبه)/u.test(answer)
  )
    return false;
  const supplied = intentTerms(
    (unit.question || "") + " " + answer,
    vocabulary,
  );
  // Explicit purification conditions must be supported, even in a short answer.
  for (const condition of ["وضوء", "وضو", "طهارة", "طهاره"]) {
    if (
      requested.includes(condition) &&
      !supplied.some((t) => /وض|طهر|طهار|حدث/u.test(t))
    )
      return false;
  }
  if (answer.length <= 850) {
    if (!requested.length) return false;
    const context = intentTerms(
      (unit.title || "") + " " + (unit.question || ""),
      vocabulary,
    );
    const overlap = (list) =>
      requested.filter((t) => list.includes(t)).length / requested.length;
    // A short answer is not automatically sufficient. A contextual yes/no may
    // qualify only when the source's own question/title supplies the subject.
    return overlap(body) >= 0.5 || overlap(context) >= 0.75;
  }
  const subject = intentTerms(question, vocabulary)[0];
  if (!subject) return true;
  // A question may list several issues while its answer addresses only some.
  // Do not mistake a mention in that question for evidence in the long answer.
  const bodyTerms = intentTerms(answer, vocabulary);
  return (
    (bodyTerms.includes(subject) &&
      requested.filter((t) => bodyTerms.includes(t)).length /
        requested.length >=
        0.5) ||
    (requested.length >= 2 &&
      requested.filter((t) => bodyTerms.includes(t)).length /
        requested.length >=
        0.75)
  );
}

// A source may mention the requested amount while answering a different,
// narrower case. Keep that case discoverable, but never present it as the answer.
export function isRelatedCase(question, unit) {
  if (assessIntent(question, unit).kind !== "direct") return true;
  const q = normalize(question),
    title = normalize(
      /عنوان غير متاح|untitled/iu.test(unit.title || "")
        ? unit.question || ""
        : unit.title || "",
    );
  const facets = [
    /اجر[ةه]|ايجار|تاجير|السكن|المحلات|\b(?:rent|rental|tenancy)\b/iu,
    /راتب|رواتب|\b(?:salary|salaries|wages)\b/iu,
    /سيار|عقار|الدور|الاراضي|\b(?:cars?|property|properties|land)\b/iu,
    /زواج|تزوج|للبناء|\b(?:marriage|wedding|construction)\b/iu,
    /(?:^|\s)(?:ال)?(?:دين|ديون|قرض|قروض)(?=\s|[،؟:]|$)|\b(?:debt|debts|loan|loans)\b/iu,
    /لحم|لحما|\bmeat\b/iu,
    /الماضي|سنوات سابق|سنين|\b(?:past years|previous years|missed)\b/iu,
  ];
  if (!/زكا[ةهت]|\bzaka[th]/iu.test(q)) return false;
  const topic = title + " " + normalize(unit.question || "");
  if (facets.some((facet) => facet.test(q) && !facet.test(topic))) return true;
  return facets.some((facet) => facet.test(title) && !facet.test(q));
}

export function prepareSubjects(index, vocabulary) {
  const documents = index.map((u) => ({
    title: new Set(intentTerms(u.title, vocabulary)),
    question: new Set(intentTerms(u.question || "", vocabulary)),
  }));
  const frequencies = new Map();
  for (const d of documents)
    for (const t of d.title) frequencies.set(t, (frequencies.get(t) || 0) + 1);
  return { documents, frequencies };
}

export function restoreSubjects(rows, count) {
  if (!Array.isArray(rows) || rows.length !== count)
    throw Error("Incomplete prepared subjects");
  const documents = rows.map((row) => {
    if (
      !Array.isArray(row) ||
      row.length !== 2 ||
      row.some(
        (tokens) =>
          !Array.isArray(tokens) || tokens.some((t) => typeof t !== "string"),
      )
    )
      throw Error("Invalid prepared subjects");
    return { title: new Set(row[0]), question: new Set(row[1]) };
  });
  const frequencies = new Map();
  for (const d of documents)
    for (const t of d.title) frequencies.set(t, (frequencies.get(t) || 0) + 1);
  return { documents, frequencies };
}

export function subjectQuery(question, frequencies, count, vocabulary) {
  const wanted = intentTerms(question, vocabulary);
  const weight = (t) =>
    Math.min(
      6,
      Math.max(1, Math.log(1 + count / (frequencies.get(t) || count))),
    );
  const weights = new Map(wanted.map((t) => [t, weight(t)]));
  const total = [...weights.values()].reduce((a, b) => a + b, 0) || 1;
  const anchor = [...wanted].sort((a, b) => weights.get(b) - weights.get(a))[0];
  return { question, wanted, weights, total, anchor };
}
export function subjectMatch(query, entry, document) {
  const { question, wanted, weights, total } = query;
  const coverage = (set) =>
    wanted.reduce((n, t) => n + (set.has(t) ? weights.get(t) : 0), 0) / total;
  const titleCoverage = coverage(document.title),
    questionCoverage = coverage(document.question);
  const precision =
    wanted.filter((t) => document.title.has(t)).length /
    Math.max(document.title.size, 1);
  const titleTerms = [...document.title];
  const lead = titleTerms[0] === wanted[0] ? 1 : 0;
  const prefix =
    wanted.length > 1 && wanted.every((t, i) => titleTerms[i] === t) ? 1 : 0;
  const ordered =
    wanted.length > 1 &&
    wanted.every(
      (t, i) =>
        document.title.has(t) &&
        (!i || titleTerms.indexOf(t) > titleTerms.indexOf(wanted[i - 1])),
    )
      ? 1
      : 0;
  const conditional =
    /^(?:إذا|اذا|من |حكم من |نسي|نسيت|نذر|نذرت|he |she |if |my )/iu.test(
      entry.title,
    );
  // Unrequested case-specific titles lose priority to direct subject matches.
  const penalty =
    conditional && !/^(?:اذا|إذا|من |if |when |my )/iu.test(question)
      ? 0.08
      : 0;
  return {
    titleCoverage,
    questionCoverage,
    precision,
    lead,
    prefix,
    ordered,
    anchor:
      document.title.has(query.anchor) || document.question.has(query.anchor),
    score:
      0.3 * titleCoverage +
      0.2 * questionCoverage +
      0.1 * precision +
      0.15 * lead +
      0.1 * prefix +
      0.15 * ordered -
      penalty -
      (/(?:^|\s)(?:عن|for|over)(?:\s|$)/iu.test(question) &&
      titleCoverage > 0.95 &&
      wanted.length > 1 &&
      !ordered
        ? 0.12
        : 0) +
      (/(?:خلاف|اختلاف|opinions|disagree)/iu.test(question) &&
      /(?:خلاف|اختلاف|اختلف|اقوال|أقوال|opinions|disagree)/iu.test(
        entry.title + " " + (entry.question || ""),
      )
        ? 0.16
        : 0),
  };
}
