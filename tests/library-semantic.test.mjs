import test from "node:test";
import assert from "node:assert/strict";
import {
  passageWindows,
  selectSemanticPassages,
} from "../site/library-semantic.mjs";

test("long passages are covered beyond the model window without changing original units", () => {
  const book = {
    units: [{ id: 1, text: "بداية ".repeat(400) + "شرط أخير لا يجوز إسقاطه." }],
  };
  const windows = passageWindows(book);
  assert.ok(windows.length > 2);
  assert.ok(windows.at(-1).text.includes("شرط أخير"));
  assert.ok(windows.every((w) => w.text.length <= 900 && w.unitIds[0] === 1));
});
test("a standalone source question includes the following answer, retaining both references", () => {
  const windows = passageWindows({
    units: [
      { id: 1, text: "كيف تقدم طلب العضوية؟" },
      { id: 2, text: "يسجل المتقدم بياناته ويؤكد بريده الإلكتروني." },
    ],
  });
  assert.deepEqual(windows[0].unitIds, [1, 2]);
  assert.ok(windows[0].text.includes("يؤكد"));
});
test("semantic paraphrases qualify without forcing every query word, while distant matches do not", () => {
  const rows = [
    {
      bookId: "a",
      unitIds: [1],
      text: "تغلق المكتبة يوم الجمعة.",
      similarity: 0.92,
    },
    {
      bookId: "b",
      unitIds: [1],
      text: "كمية الوقود في الطائرة.",
      similarity: 0.73,
    },
  ];
  const found = selectSemanticPassages(rows, "متى تكون المكتبة مغلقة؟");
  assert.equal(found.length, 1);
  assert.equal(found[0].bookId, "a");
});
test("high semantic similarity does not turn opening hours into financial evidence", () => {
  const rows = [
    {
      bookId: "a",
      unitIds: [1],
      text: "تفتح المكتبة الساعة التاسعة صباحًا.",
      similarity: 0.94,
    },
  ];
  assert.equal(selectSemanticPassages(rows, "كم راتب موظف المكتبة؟").length, 0);
});
