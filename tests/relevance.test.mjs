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
  assert.equal(answerSupportsQuestion({text:"عنوان س ما فضل الاختبار؟ ج هذا وصف الجهاز."},"فضل الاختبار",vocabulary),false);
});
