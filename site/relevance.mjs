import { terms } from "./core.mjs";

// Presentation words carry little information about the requested subject.
// This layer never changes stored quotations or maps a question to an answer ID.
const framing = new Set(
  "مذكور مصدر مصادر بحسب انقل مرجع اعرض اعطني فتوى فتاوي نص نصوص يقول قول اقوال مختلفة شروطها شرطها بالنسبة ذكر يتحدث المذكور استعمال استخدام اداء يتناول مستقيم should say says mentioned sources source according published explain ruling rulings permissible islam islamic islamqa answer answers evidence proof discussed please over using use".split(
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
  اختلاف: "خلاف",
  اختلف: "خلاف",
  يختلف: "خلاف",
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
framing.add("while");
framing.add("through");
framing.add("ادلة");
framing.add("دليل");
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
export function intentTerms(text, vocabulary) {
  text = text.replace(/rak[’'‘-]?a[’']?h?s?/giu, "rakah");
  const filtered = terms(text, vocabulary).filter((t) => !framing.has(t));
  if (!filtered.length)
    return [...new Set(terms(text, vocabulary).map(canonical))];
  return [...new Set(filtered.map(canonical))];
}

export function answerSupportsQuestion(unit, question, vocabulary) {
  const answer = unit.answer || unit.text;
  if (!question || !answer) return false;
  if (
    /قبل.+بعد/u.test(question) &&
    (!(answer.includes("قبل") && answer.includes("بعد")) ||
      /لا[^.\n]{0,100}قبل[^.\n]{0,100}ولا بعد/u.test(answer))
  )
    return false;
  const requested = intentTerms(question, vocabulary);
  const body = intentTerms(answer, vocabulary);
  // Requested comparisons and numeric limits need affirmative textual support.
  if (
    /minimum|least|fewest/iu.test(question) &&
    !/minimum|least|fewest/iu.test(answer)
  )
    return false;
  if (requested.includes("فضل") && !body.includes("فضل")) return false;
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
  if (answer.length <= 850) return true;
  const subject = intentTerms(question, vocabulary)[0];
  if (!subject) return true;
  // A question may list several issues while its answer addresses only some.
  // Do not mistake a mention in that question for evidence in the long answer.
  const bodyTerms = intentTerms(answer, vocabulary);
  return (
    bodyTerms.includes(subject) ||
    (requested.length >= 2 &&
      requested.filter((t) => bodyTerms.includes(t)).length /
        requested.length >=
        0.75)
  );
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
