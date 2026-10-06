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
