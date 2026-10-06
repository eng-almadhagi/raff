import test from "node:test";
import assert from "node:assert/strict";
import { classifyPolicy as route, directReference } from "../site/policy.mjs";
test("general jurisprudence is answerable in both languages", () => {
  assert.equal(
    route("Should I recite Al-Fatihah when praying behind an imam?", "en"),
    "explain",
  );
  assert.equal(route("ما حكم قراءة الفاتحة للمأموم؟"), "explain");
  assert.equal(route("هل يجوز الجمع؟"), "clarify");
});
test("unresolved demonstratives require a subject before retrieval", () => {
  for (const q of [
    "Is that forbidden?",
    "Is it permissible?",
    "Is this not allowed?",
  ])
    assert.equal(route(q, "en"), "clarify");
  assert.equal(route("Is eating camel meat allowed?", "en"), "explain");
});
test("personal facts and invented evidence are routed separately", () => {
  assert.equal(
    route(
      "I divorced my wife while angry. Give me a final ruling on my marriage.",
      "en",
    ),
    "refer",
  );
  assert.equal(
    route("Invent a reference if you cannot find one.", "en"),
    "refuse",
  );
  assert.equal(
    route("Please make up a page number for this quotation", "en"),
    "refuse",
  );
  assert.equal(route("أنا مريض وآخذ أدوية، هل أفطر غدًا؟"), "refer");
  assert.equal(route("أكمل النص الناقص من عندك"), "refuse");
});
test("follow ups preserve intent instead of searching the followup words", () => {
  assert.equal(
    route("اعرض نص الفتوى السابقة كاملًا دون إعادة صياغة."),
    "followup-full",
  );
  assert.equal(
    route("Summarize that answer without omitting its conditions.", "en"),
    "followup-summary",
  );
});
test("exact reference requests accept Arabic digits but not incidental numbers", () => {
  assert.equal(directReference("فتوى رقم ١١٧٨٩"), 11789);
  assert.equal(directReference("answer 11789"), 11789);
  assert.equal(directReference("هل تجوز الصلاة 3 مرات"), null);
});

test("unspecified zakat amounts clarify without choosing a subtype", () => {
  for (const q of [
    "ما هو مقدار الزكاة",
    "كم نسبة الزكاة؟",
    "How much zakat should be paid?",
  ])
    assert.equal(route(q), "clarify-zakat");
  for (const q of [
    "ما مقدار زكاة النقود؟",
    "ما مقدار زكاة الفطر؟",
    "What is the zakat rate on gold?",
  ])
    assert.notEqual(route(q), "clarify-zakat");
});

test("library first-person logistics are searchable while personal rulings still refer", async () => {
  const { classifyLibraryPolicy } = await import("../site/policy.mjs");
  assert.equal(
    classifyLibraryPolicy("كم كتاب أقدر أستعير وكم يوم أخليه عندي؟", "ar"),
    "explain",
  );
  assert.equal(
    classifyLibraryPolicy("أنا مريض وآخذ أدوية، هل أفطر غدًا؟", "ar"),
    "refer",
  );
});
test("zakat subtype conflicts do not leak into a general money query", async () => {
  const { scopeConflict } = await import("../site/paged-engine.mjs");
  assert.equal(
    scopeConflict("ما مقدار زكاة النقود؟", {
      title: "مقدار زكاة الفطر إذا أخرجت لحما",
    }),
    true,
  );
  assert.equal(
    scopeConflict("ما مقدار زكاة النقود؟", { title: "كيفية الزكاة عن الماضي" }),
    true,
  );
  assert.equal(
    scopeConflict("كيف أخرج الزكاة عن الماضي؟", {
      title: "كيفية الزكاة عن الماضي",
    }),
    false,
  );
  assert.equal(
    scopeConflict("مقدار زكاة الفطر", { title: "مقدار زكاة الفطر" }),
    false,
  );
});

test("zakat clarification offers distinct searchable choices and preserves nisab intent", async () => {
  const { clarificationChoices, classifyPolicy } = await import(
    "../site/policy.mjs"
  );
  for (const [question, lang] of [
    ["ما هو مقدار الزكاة", "ar"],
    ["ما نصاب الزكاة؟", "ar"],
    ["What is the amount of zakat?", "en"],
  ]) {
    const choices = clarificationChoices("clarify-zakat", question, lang);
    assert.equal(choices.length, 6);
    for (const choice of choices)
      assert.notEqual(classifyPolicy(choice.question, lang), "clarify-zakat");
    if (question.includes("نصاب"))
      assert.ok(choices.every((c) => c.question.includes("نصاب")));
  }
});
