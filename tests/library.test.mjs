import test from "node:test";
import assert from "node:assert/strict";
import { importBook, searchLibrary } from "../site/library-core.mjs";

const make = (content, shelfId = "a", language = "ar", filename = "book.txt") =>
  importBook({ content, title: "كتاب اختبار", shelfId, language, filename });
test("imports complete paragraphs with honest paragraph references and independent IDs", () => {
  const text = "حكم التجارة بشروطها\nويستثنى منها ما يلي.\n\nفقرة ثانية.";
  const a = make(text),
    b = make(text);
  assert.notEqual(a.id, b.id);
  assert.equal(a.units[0].text, text.split("\n\n")[0]);
  assert.equal(a.units[1].reference, "§ 2");
});
test("structured importer preserves complete wording and explicit source reference", () => {
  const b = make(
    JSON.stringify({
      sections: [{ text: "  النص\nإلا عند الضرورة.  ", reference: "ج 2 ص 15" }],
    }),
    "a",
    "ar",
    "b.json",
  );
  assert.equal(b.units[0].text, "  النص\nإلا عند الضرورة.  ");
  assert.equal(b.units[0].reference, "ج 2 ص 15");
});
test("invalid, oversized, broken encoding and unsupported books never index", () => {
  for (const [content, name] of [
    ["", "a.txt"],
    ["%PDF", "a.pdf"],
    ["\ufffd", "a.txt"],
    ['{"sections":[{"text":""}]}', "a.json"],
    ["x".repeat(100001), "a.txt"],
  ]) {
    assert.throws(() => make(content, "a", "ar", name));
  }
});
test("scope isolates books and languages and requires all query terms", () => {
  const a = make("البيع جائز بشرط التراضي ولا يجوز الإكراه."),
    b = make("البيع جائز بشرط التراضي.", "b"),
    en = make("Trade requires mutual consent.", "a", "en");
  const found = searchLibrary([a, b, en], "البيع التراضي", {
    language: "ar",
    bookIds: [a.id],
  });
  assert.equal(found.length, 1);
  assert.equal(found[0].bookId, a.id);
  assert.equal(found[0].text, a.units[0].text);
  assert.equal(
    searchLibrary([a, b], "البيع الميراث", {
      language: "ar",
      bookIds: [a.id, b.id],
    }).length,
    0,
  );
  assert.equal(
    searchLibrary([en], "trade consent", { language: "ar", bookIds: [en.id] })
      .length,
    0,
  );
  assert.equal(
    searchLibrary([a], "البيع التراضي", { language: "ar", bookIds: [] }).length,
    0,
  );
});
