import test from "node:test";
import assert from "node:assert/strict";
import {
  answerSupportsQuestion,
  intentTerms,
  prepareSubjects,
  subjectQuery,
  subjectMatch,
} from "../site/relevance.mjs";
import { focusedPreview } from "../site/core.mjs";
const vocabulary = {
  stop: ["the", "how", "to", "a", "of", "is", "what"],
  concepts: {},
};
test("a numerical detail may be supported by the full answer beneath a broader title", () => {
  assert.equal(
    answerSupportsQuestion(
      {
        title: "Borrowing",
        answer: "The minimum borrowing period is one day.",
      },
      "What is the minimum borrowing period?",
      vocabulary,
    ),
    true,
  );
  assert.equal(
    answerSupportsQuestion(
      { title: "Borrowing", answer: "Borrowing is available." },
      "What is the minimum borrowing period?",
      vocabulary,
    ),
    false,
  );
});
test("incidental mentions and unrequested contexts are not direct evidence across domains", () => {
  assert.equal(
    answerSupportsQuestion(
      {
        title: "Water damage during camera cleaning",
        answer: "Camera cleaning requires care. ".repeat(50),
      },
      "Camera cleaning",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      {
        title: "Book registration at prisons",
        answer: "Book registration is available.",
      },
      "Book registration",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      {
        title: "قراءة القرآن عند القبر",
        answer: "قراءة القرآن عند القبر موضوع هذا الجواب.",
      },
      "قراءة القرآن",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      {
        title: "Camera cleaning",
        answer: "Camera cleaning requires a soft cloth.",
      },
      "Camera cleaning",
      vocabulary,
    ),
    true,
  );
});
test("inflected English activity words match without changing quotations", () => {
  assert.deepEqual(
    intentTerms("wiping socks", vocabulary),
    intentTerms("wipe sock", vocabulary),
  );
});
test("a direct subject is preferred to a secondary mention in a case title", () => {
  const index = [
    { title: "Camera lens cleaning", question: "Camera lens cleaning" },
    {
      title: "Water damage during camera lens cleaning",
      question: "Camera lens cleaning",
    },
  ];
  const prepared = prepareSubjects(index, vocabulary);
  const query = subjectQuery(
    "Camera lens cleaning",
    prepared.frequencies,
    index.length,
    vocabulary,
  );
  assert.ok(
    subjectMatch(query, index[0], prepared.documents[0]).score >
      subjectMatch(query, index[1], prepared.documents[1]).score,
  );
});
test("distant qualifications remain in full quoted answers", () => {
  const answer =
    "A synthetic answer about a telescope. ".repeat(50) +
    "\n\nExcept in the following circumstances: " +
    "qualification ".repeat(500);
  const text = "Source question\n\n" + answer;
  const result = focusedPreview({ text, answer }, "telescope", vocabulary);
  assert.equal(result.text, answer);
  assert.equal(result.complete, true);
  assert.ok(result.text.includes("Except in the following circumstances"));
  const incomplete = focusedPreview(
    { text, answer, content_type: "source_incomplete" },
    "telescope",
    vocabulary,
  );
  assert.equal(incomplete.complete, false);
});

test("a topic listed only in a multi-part question is not answer evidence", () => {
  assert.equal(
    answerSupportsQuestion(
      {
        question: "Telescope and microscope",
        answer: "Microscope cleaning. ".repeat(80),
      },
      "Telescope",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      { answer: "Telescope cleaning. ".repeat(80) },
      "Telescope",
      vocabulary,
    ),
    true,
  );
});

test("transliterated unit spellings match without altering the source", () => {
  assert.deepEqual(
    intentTerms("rakahs", vocabulary),
    intentTerms("rak’ahs", vocabulary),
  );
  assert.equal(
    answerSupportsQuestion(
      { answer: "A telescope has three lenses." },
      "minimum lenses",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      { answer: "The minimum is two lenses." },
      "minimum lenses",
      vocabulary,
    ),
    true,
  );
});

test("a negative exception does not explain a requested before/after comparison", () => {
  assert.equal(
    answerSupportsQuestion(
      { answer: "لا يلزم هذا الإجراء لا قبل الاختبار ولا بعده." },
      "الإجراء قبل الاختبار وبعده",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      {
        answer:
          "قبل الاختبار يستعمل الإجراء الأول، وبعده يستعمل الإجراء الثاني.",
      },
      "الإجراء قبل الاختبار وبعده",
      vocabulary,
    ),
    true,
  );
});

test("temporal evidence must refer to the requested event", () => {
  assert.equal(
    answerSupportsQuestion(
      { answer: "يبدأ العمل قبل السفر وينتهي بعد العودة." },
      "العمل قبل الاختبار وبعده",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      { answer: "يبدأ العمل قبل الاختبار ثم يراجع بعد الاختبار." },
      "العمل قبل الاختبار وبعده",
      vocabulary,
    ),
    true,
  );
});

test("a retained question marker is not evidence from the answer", () => {
  assert.equal(
    answerSupportsQuestion(
      { text: "عنوان س ما فضل الاختبار؟ ج هذا وصف الجهاز." },
      "فضل الاختبار",
      vocabulary,
    ),
    false,
  );
});

test("deployment-prepared subjects reproduce runtime scoring inputs exactly", async () => {
  const { prepareSubjects, restoreSubjects } = await import(
    "../site/relevance.mjs"
  );
  const index = [
    { title: "زكاة النقود", question: "ما مقدار زكاة النقود؟" },
    { title: "An independent title", question: "How does this work?" },
  ];
  const prepared = prepareSubjects(index, { stop: [], concepts: {} });
  assert.deepEqual(
    restoreSubjects(
      prepared.documents.map((d) => [[...d.title], [...d.question]]),
      index.length,
    ),
    prepared,
  );
  assert.throws(() => restoreSubjects([], 2), /Incomplete/);
  assert.throws(() => restoreSubjects([[["valid"], [42]]], 1), /Invalid/);
});

test("narrow zakat cases are suggestions unless the user requested that case", async () => {
  const { isRelatedCase } = await import("../site/relevance.mjs");
  assert.equal(
    isRelatedCase("ما مقدار زكاة النقود؟", {
      title: "زكاة أجرة السكن والمحلات",
    }),
    true,
  );
  assert.equal(
    isRelatedCase("What is zakat on money?", {
      title: "Zakat on rental income",
    }),
    true,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة أجرة السكن؟", {
      title: "زكاة أجرة السكن والمحلات",
    }),
    false,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة الفطر؟", {
      title: "مقدار زكاة الفطر إذا أخرجت لحما",
    }),
    true,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة الفطر؟", { title: "حكم زكاة الفطر ومقدارها" }),
    false,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة النقود؟", { title: "نصاب النقدين" }),
    false,
  );
});

test("a named zakat subtype cannot be replaced with a money-saving answer", async () => {
  const { scopeConflict } = await import("../site/paged-engine.mjs");
  assert.equal(
    scopeConflict("ما مقدار زكاة الفطر؟", {
      title: "نص من الكتاب — عنوان غير متاح",
      question: "هل تجب زكاة المال المرصود للزواج؟",
    }),
    true,
  );
  assert.equal(
    scopeConflict("ما مقدار زكاة الفطر؟", {
      title: "حكم زكاة الفطر ومقدارها",
      question: "هل تجب على المحتاج؟",
    }),
    false,
  );
});

test("rejecting one narrow case does not admit another narrower replacement", async () => {
  const { isRelatedCase } = await import("../site/relevance.mjs");
  assert.equal(
    isRelatedCase("ما مقدار زكاة النقود؟", { title: "زكاة الدور والسيارات" }),
    true,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة أجرة السكن؟", {
      title: "نصاب الذهب عيار 21",
      question: "ما مقدار نصابه؟",
    }),
    true,
  );
  assert.equal(
    isRelatedCase("ما مقدار زكاة النقود؟", {
      title: "نص من الكتاب — عنوان غير متاح",
      question: "هل تجب الزكاة في مال الزواج؟",
    }),
    true,
  );
});

test("short unrelated answers are not evidence simply because they are short", () => {
  assert.equal(
    answerSupportsQuestion(
      { title: "شروط الاستعارة", answer: "تفتح المكتبة صباحًا." },
      "كم مقدار زكاة النقود؟",
      vocabulary,
    ),
    false,
  );
  assert.equal(
    answerSupportsQuestion(
      {
        title: "قراءة الفاتحة",
        question: "هل تجوز قراءة الفاتحة؟",
        answer: "نعم.",
      },
      "قراءة الفاتحة",
      vocabulary,
    ),
    true,
  );
});
