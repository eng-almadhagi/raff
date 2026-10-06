import test from "node:test";
import assert from "node:assert/strict";
import { route, preview, evidence, select, terms } from "../site/core.mjs";
test("personal cases and ambiguous queries do not become rulings", () => {
  assert.equal(route("أنا طلقت زوجتي هل يقع الطلاق؟"), "refer");
  assert.equal(route("هل يحل هذا الفعل؟"), "clarify");
  assert.equal(route("حكم الرمي في اليوم الثاني"), "explain");
  assert.equal(route("إني حلفت ثم نسيت"), "refer");
  assert.equal(route("قارن الفتاوى في مسألة عامة"), "qualified");
});
test("complete short answer preserves the exception verbatim", () => {
  const text = "يجوز ذلك إذا تحقق الشرط، إلا في الحالة المستثناة.";
  assert.deepEqual(preview({ text, answer: text }), {
    text,
    complete: true,
    label: "الجواب المختصر · منقول حرفيًا",
  });
  assert.equal(
    preview({ text, answer: text, content_type: "source_incomplete" }).complete,
    false,
  );
});
test("long answer never silently becomes a complete summary", () => {
  const text = "مقدمة الجواب ".repeat(100) + " إلا عند الضرورة.";
  const result = preview({ text, answer: text });
  assert.equal(result.complete, false);
  assert.ok(text.includes(result.text));
});
test("evidence can only be exact source spans; absent evidence stays absent", () => {
  const unit = {
    text: "نقل المصدر: «هذا نص اختباري وليس حديثا» ثم {نص اختباري آخر}",
  };
  for (const span of evidence(unit))
    assert.equal(unit.text.slice(span.start, span.end), span.text);
  assert.deepEqual(evidence({ text: "لا يوجد هنا دليل مقتبس" }), []);
  assert.equal(
    evidence({ text: "قال تعالى (نص اختباري وليس آية حقيقية)" }).length,
    1,
  );
  assert.equal(
    evidence({
      text: 'لقوله ﷺ في حديث اختبار "نص اصطناعي للاختبار لا يمثل حديثا"',
    }).length,
    1,
  );
});
test("unsupported first hit cannot be replaced with a lower accidental match", () => {
  const rows = [
    { index: 0, coverage: 0.1, focus: 0.8, dense: 0.8, score: 0.6 },
    { index: 1, coverage: 0.7, focus: 0.86, dense: 0.9, score: 0.5 },
  ];
  assert.equal(
    select([{ title: "A" }, { title: "B" }], rows, "ما حكم مسألة عامة").kind,
    "insufficient",
  );
});
test("concepts only normalize search text", () => {
  const vocabulary = { stop: [], concepts: { انابة: "توكيل", توكيل: "توكيل" } };
  assert.deepEqual(terms("الإنابة", vocabulary), terms("التوكيل", vocabulary));
});

test("a long collected page does not present its question list as an answer excerpt", () => {
  const text =
    "قائمة أسئلة طويلة ".repeat(20) +
    "\n\nالجواب:\n\nالحمد لله\n\nهذا جواب اصطناعي للاختبار مع شرط واستثناء. ".repeat(
      40,
    );
  const result = preview({ text, answer: text });
  assert.equal(result.complete, false);
  assert.ok(result.text.startsWith("الحمد لله"));
  assert.ok(text.includes(result.text));
});
