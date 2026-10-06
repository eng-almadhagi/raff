import test from "node:test";
import assert from "node:assert/strict";
import { assessIntent, questionProfile } from "../site/query-intent.mjs";
const verdict = (q, title, answer = "جواب المصدر", question = "") =>
  assessIntent(q, { title, answer, question }).kind;
test("actions distinguish a general topic from carrying, selling, delaying and transferring", () => {
  for (const [q, title] of [
    ["حكم السجائر", "حكم حمل السجائر في الصلاة"],
    ["حكم المصحف", "حكم بيع المصحف"],
    ["حكم الصدقة", "حكم تأخير الصدقة"],
    ["حكم الكتب", "حكم نقل الكتب إلى بلد آخر"],
    ["Ruling on cigarettes", "Carrying cigarettes during prayer"],
  ])
    assert.equal(verdict(q, title), "related", q);
  assert.equal(verdict("حكم السجائر", "حكم شرب وبيع السجائر"), "direct");
  assert.equal(
    verdict("حكم حمل السجائر في الصلاة", "حكم حمل السجائر في الصلاة"),
    "direct",
  );
  assert.equal(verdict("حكم بيع المصحف", "حكم بيع المصحف"), "direct");
});
test("explicit actions and circumstances must be supported across topics", () => {
  for (const [q, title] of [
    ["حكم استعمال الذهب", "حكم استعمال المطلي بالذهب"],
    ["حكم قراءة القرآن", "قراءة القرآن من الحاسب الآلي"],
    ["حكم الصلاة في السفر", "صلاة الوتر في السفر"],
    ["حكم الصيام للمسافر", "الصيام أثناء العمرة"],
  ]) {
    assert.equal(verdict(q, title), "related");
    assert.equal(verdict(title, title), "direct");
  }
  assert.equal(verdict("حكم شراء الذهب", "حكم لبس الذهب"), "related");
  assert.equal(verdict("حكم الصيام", "الصيام للمسافر"), "related");
  assert.equal(verdict("حكم أكل الطعام ناسيًا", "حكم أكل الطعام"), "related");
  assert.equal(
    verdict("حكم أكل الطعام ناسيًا", "حكم أكل الطعام ناسيًا"),
    "direct",
  );
  assert.equal(
    verdict("حكم بيع وشراء الكتب", "حكم بيع الكتب", "جواب عن البيع فقط"),
    "related",
  );
});
test("amount and time requests require evidence of that answer type in public and private passages", () => {
  assert.equal(
    verdict(
      "متى تُرسل الهدية؟",
      "نوع الهدية",
      "الهدية كتاب يفيد الطفل يوم العيد.",
    ),
    "related",
  );
  assert.equal(
    verdict("كم مدة الاستعارة؟", "مدة الاستعارة", "يجب المحافظة على الكتاب."),
    "related",
  );
  assert.equal(
    verdict(
      "كم مدة الاستعارة؟",
      "مدة الاستعارة",
      "مدة الاستعارة أربعة عشر يومًا.",
    ),
    "direct",
  );
  assert.equal(
    assessIntent(
      "متى تصل الشهادة؟",
      { text: "ترسل الشهادة إلى البريد الإلكتروني." },
      { passage: true },
    ).kind,
    "related",
  );
  assert.equal(
    assessIntent(
      "متى تصل الشهادة؟",
      { text: "ترسل الشهادة بعد ثلاثة أيام." },
      { passage: true },
    ).kind,
    "direct",
  );
  assert.equal(questionProfile("What is the borrowing deadline?").type, "time");
});

test("question-type evidence and word boundaries work outside the motivating topics", () => {
  assert.deepEqual(questionProfile("حكم المشاكل الطبيعية").actions, []);
  assert.equal(questionProfile("حكم الكتب").type, "general");
  assert.equal(
    verdict("لماذا يحظر الدخول؟", "سبب منع الدخول", "الدخول ممنوع."),
    "related",
  );
  assert.equal(
    verdict(
      "لماذا يحظر الدخول؟",
      "سبب منع الدخول",
      "الدخول ممنوع بسبب أعمال الصيانة.",
    ),
    "direct",
  );
  assert.equal(verdict("هل يجوز إتلاف الأوراق؟", "حكم بيع الأوراق"), "related");
  assert.equal(
    verdict("حكم الاستماع إلى التسجيل", "حكم بيع التسجيل"),
    "related",
  );
  assert.equal(verdict("هل يجوز لبس الخاتم؟", "لبس الخاتم للصبي"), "related");
});

test("sermon greetings do not supply a date but explicit years do", () => {
  assert.equal(
    assessIntent(
      "متى كانت الرحلة؟",
      { text: "الرحلة — أيام الإجازة\n\nالحمد لله رب العالمين، أما بعد:" },
      { passage: true },
    ).kind,
    "related",
  );
  assert.equal(
    assessIntent(
      "متى كانت الرحلة؟",
      { text: "كانت الرحلة في السنة العاشرة." },
      { passage: true },
    ).kind,
    "direct",
  );
  assert.equal(
    assessIntent(
      "When did the expedition happen?",
      { text: "The expedition happened in 1920." },
      { passage: true },
    ).kind,
    "direct",
  );
});

test("prayer roles cannot silently be exchanged in relevant-looking sources", () => {
  assert.equal(
    assessIntent("نسي قراءة الفاتحة — المنفرد", {
      title: "إذا نسي المأموم قراءة الفاتحة",
      answer: "إذا نسي المأموم القراءة.",
    }).kind,
    "related",
  );
  assert.equal(
    assessIntent("نسي قراءة الفاتحة — المأموم", {
      title: "إذا نسي المأموم قراءة الفاتحة",
      answer: "إذا نسي المأموم القراءة.",
    }).kind,
    "direct",
  );
});
