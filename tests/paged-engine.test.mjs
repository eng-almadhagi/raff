import test from "node:test";
import assert from "node:assert/strict";
import {
  PagedEngine,
  checked,
  bucket,
  searchQuery,
} from "../site/paged-engine.mjs";
const vocabulary = { stop: [], concepts: {} };
const metas = ["ar", "en"].map((language) => ({
  id: "islamqa-" + language,
  language,
  title: language,
  units: 1,
  hashes: {},
}));
const unit = (language) => ({
  id: `islamqa-${language}-42`,
  book_id: `islamqa-${language}`,
  language,
  reference: 42,
  title: "Synthetic test",
  text: "Synthetic question\n\nSynthetic answer with a condition.",
  answer: "Synthetic answer with a condition.",
  sha256: "same",
  retrievable: true,
});
function fixture() {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const lang = url.includes("islamqa-en") ? "en" : "ar",
      u = unit(lang);
    return new Response(
      JSON.stringify(
        url.endsWith("index.json") ? [{ ...u, shard: 0 }] : { [u.id]: u },
      ),
    );
  };
  return calls;
}
test("direct number uses only the selected language and never invokes a model", async () => {
  const calls = fixture();
  const e = new PagedEngine(metas, vocabulary, () => {
    throw Error("should not embed");
  });
  const r = await e.ask(
    "IslamQA 42",
    "en",
    metas.map((m) => m.id),
  );
  assert.equal(r.sources.length, 1);
  assert.equal(r.sources[0].citations[0].language, "en");
  assert.ok(calls.every((c) => c.includes("islamqa-en")));
});
test("followup retrieves prior source again and clears after a new unrelated refusal", async () => {
  fixture();
  const e = new PagedEngine(metas, vocabulary, () => []);
  await e.ask("IslamQA 42", "en", ["islamqa-en"]);
  const r = await e.ask("Show the full previous answer", "en", ["islamqa-en"]);
  assert.equal(r.sources[0].citations[0].reference, 42);
  await e.ask("I divorced my wife. Is my divorce valid?", "en", ["islamqa-en"]);
  assert.equal(e.last.has("en"), false);
});
test("source failure is explicit and never becomes another language answer", async () => {
  globalThis.fetch = async () => new Response("", { status: 503 });
  const e = new PagedEngine(metas, vocabulary, () => []);
  const r = await e.ask("IslamQA 42", "en", ["islamqa-en"]);
  assert.equal(r.sources[0].kind, "error");
  assert.deepEqual(r.sources[0].citations, []);
});
test("corrupt file and source identity mismatch are rejected", async () => {
  globalThis.fetch = async () => new Response("{}");
  await assert.rejects(checked("/file", "00"), /checksum/);
  fixture();
  const e = new PagedEngine(metas, vocabulary, () => []);
  const b = await e.load(metas[1]);
  b.index[0].sha256 = "wrong";
  await assert.rejects(e.citation(metas[1], unit("en").id), /mismatch/);
});

test("an interrupted passage download does not cache a partial vector index", async () => {
  let fail = true;
  const meta = { ...metas[1], has_chunks: true };
  globalThis.fetch = async (url) => {
    if (url.endsWith("index.json"))
      return new Response(JSON.stringify([{ ...unit("en"), shard: 0 }]));
    if (url.endsWith("chunk-units.json")) return new Response("[0]");
    if (url.endsWith("chunks.i8") && fail)
      return new Response("", { status: 503 });
    return new Response(new Int8Array(384).fill(1));
  };
  const engine = new PagedEngine([meta], vocabulary, () => []);
  await assert.rejects(engine.load(meta, true), /503/);
  assert.equal(engine.loaded.get(meta.id).focus, undefined);
  fail = false;
  const book = await engine.load(meta, true);
  assert.equal(book.focus.length, 384);
  assert.equal(book.chunks.length, 384);
});
test("query normalization is reusable and leaves source strings untouched", () => {
  assert.match(
    searchQuery("ينفع أمسح على الشراب الخفيف؟", "ar"),
    /الجوارب الرقيق الشفاف/,
  );
  assert.equal(bucket("abc"), 34);
  assert.equal(
    searchQuery("minimum rak’ahs", "en"),
    searchQuery("least rakahs", "en"),
  );
});

// Synthetic examples validate scope logic without embedding evaluation cases.
test("travel/residence conflicts are symmetric and comparative sources remain eligible", async () => {
  const { scopeConflict } = await import("../site/paged-engine.mjs");
  assert.equal(
    scopeConflict("صوم المسافر", { title: "صوم المقيم", question: "بدون سفر" }),
    true,
  );
  assert.equal(
    scopeConflict("Prayer for residents", {
      title: "Prayer while travelling",
      question: "",
    }),
    true,
  );
  assert.equal(
    scopeConflict("أحكام السفر", { title: "المقيم والمسافر", question: "" }),
    false,
  );
});
test("focused excerpts retain original text and a following exception paragraph", async () => {
  const { focusedPreview } = await import("../site/core.mjs");
  const text =
    "Unrelated introduction. ".repeat(45) +
    "\n\n" +
    "Synthetic passage about the requested telescope. ".repeat(3) +
    "\n\nHowever, this synthetic exception must be retained.";
  const result = focusedPreview({ text, answer: text }, "requested telescope", {
    stop: [],
    concepts: {},
  });
  assert.ok(result.text.includes("However"));
  assert.ok(text.includes(result.text));
  assert.equal(result.complete, true);
  assert.equal(result.text, text);
});

test("ambiguous zakat never downloads data or invokes the model", async () => {
  globalThis.fetch = () => {
    throw Error("must not fetch");
  };
  const engine = new PagedEngine(metas, vocabulary, () => {
    throw Error("must not embed");
  });
  const result = await engine.ask("ما هو مقدار الزكاة", "ar", ["islamqa-ar"]);
  assert.equal(result.kind, "clarify-zakat");
  assert.equal(result.sources.length, 0);
});

test("concurrent index preparation shares one validated download", async () => {
  const calls = fixture();
  const engine = new PagedEngine(metas, vocabulary, () => []);
  const [a, b] = await Promise.all([
    engine.load(metas[0]),
    engine.load(metas[0]),
  ]);
  assert.equal(a, b);
  assert.equal(calls.filter((c) => c.endsWith("index.json")).length, 1);
});
test("a direct title and supported answer avoid model and vectors", async () => {
  const u = {
    ...unit("en"),
    title: "Synthetic subject",
    question: "Synthetic subject",
    answer: "Synthetic subject includes an explicit condition.",
    text: "Synthetic subject includes an explicit condition.",
  };
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return new Response(
      JSON.stringify(
        url.endsWith("index.json") ? [{ ...u, shard: 0 }] : { [u.id]: u },
      ),
    );
  };
  const engine = new PagedEngine(metas, vocabulary, () => {
    throw Error("must not embed");
  });
  const result = await engine.ask("Synthetic subject", "en", ["islamqa-en"]);
  assert.equal(result.sources[0].citations[0].text, u.text);
  assert.ok(calls.every((c) => !c.endsWith(".i8")));
});

test("a qualified source case is a suggestion, never a forced per-source answer or follow-up", async () => {
  const engine = new PagedEngine(metas, vocabulary, () => Array(384).fill(0));
  engine.load = async () => ({
    index: [],
    subjects: { frequencies: new Map(), documents: [] },
  });
  engine.rank = async () => ({
    missing: [],
    rows: [
      {
        id: "rental",
        score: 1,
        focus: 0.95,
        dense: 0.95,
        coverage: 1,
        subject: { anchor: true, titleCoverage: 1, questionCoverage: 1 },
      },
    ],
  });
  engine.citation = async () => ({
    ...unit("ar"),
    id: "rental",
    title: "زكاة أجرة السكن والمحلات",
    answer:
      "إذا حال الحول على النقود وبلغت النصاب وجبت زكاتها بمقدار ربع العشر.",
    text: "إذا حال الحول على النقود وبلغت النصاب وجبت زكاتها بمقدار ربع العشر.",
  });
  const result = await engine.ask("ما مقدار زكاة النقود؟", "ar", [
    "islamqa-ar",
  ]);
  assert.deepEqual(result.sources[0].citations, []);
  assert.deepEqual(result.sources[0].suggestions, [
    { id: "rental", title: "زكاة أجرة السكن والمحلات" },
  ]);
  assert.equal(engine.last.has("ar"), false);
  const targeted = await engine.ask("ما مقدار زكاة أجرة السكن؟", "ar", [
    "islamqa-ar",
  ]);
  assert.equal(targeted.sources[0].citations[0].id, "rental");
});

test("personal source lookup remains explicit and cannot bypass fabricated-evidence refusal", async () => {
  const engine = new PagedEngine([], vocabulary, async () => []);
  const before = await engine.ask("نسيت قراءة الفاتحة", "ar", []);
  assert.equal(before.kind, "refer");
  const lookup = await engine.ask("نسيت قراءة الفاتحة", "ar", [], {
    sourceLookup: true,
  });
  assert.equal(lookup.kind, "source-lookup");
  assert.equal(lookup.level, "D");
  assert.match(lookup.message, /ليست حكمًا/);
  assert.deepEqual(lookup.sources, []);
  assert.equal(
    (await engine.ask("اختلق مرجعًا", "ar", [], { sourceLookup: true })).kind,
    "refuse",
  );
});

test("personal phrasing is normalized without dropping the stated condition", () => {
  assert.equal(
    searchQuery("نسيت قراءة الفاتحة بعد الركوع", "ar"),
    "نسي قراءة الفاتحة بعد الركوع",
  );
  assert.equal(
    searchQuery("سهوت عن أم الكتاب وأنا أصلي وحدي", "ar"),
    "نسي الفاتحة المنفرد",
  );
  assert.equal(searchQuery("نسيت التشهد الأول", "ar"), "نسي التشهد الأول");
});

test("omission paraphrases preserve the omitted act and prayer role", () => {
  assert.equal(
    searchQuery("تركت التشهد سهوا وأنا منفرد في الصلاة", "ar"),
    "نسي التشهد منفرد",
  );
  assert.equal(
    searchQuery("أريد النصوص عن نسيان قراءة الفاتحة للإمام", "ar"),
    "نسي قراءة الفاتحة للإمام",
  );
});
