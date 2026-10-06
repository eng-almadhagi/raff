// Verify the complete exported corpus, one text shard at a time.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { preview, evidence } from "../site/core.mjs";
const root = path.resolve(process.argv[2] || "private/pages-preview/raf-v07");
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const hash = (b) => crypto.createHash("sha256").update(b).digest("hex");
const report = [];
for (const meta of read(path.join(root, "catalog.json"))) {
  const base = path.join(root, "data", meta.id),
    packed = meta.compression === "gzip";
  const load = (name) => {
    const filename = name + (packed && name.endsWith(".json") ? ".gz" : "");
    const p = path.resolve(base, filename);
    assert.ok(p.startsWith(base + path.sep));
    const bytes = fs.readFileSync(p);
    assert.equal(hash(bytes), meta.hashes[name]);
    return name.endsWith(".json")
      ? JSON.parse(packed ? zlib.gunzipSync(bytes) : bytes)
      : bytes;
  };
  const index = load("index.json");
  assert.equal(index.length, meta.units);
  assert.equal(new Set(index.map((u) => u.id)).size, index.length);
  assert.equal(load("focus.i8").length, meta.units * 384);
  let units = 0,
    quotes = 0,
    evidenceSpans = 0,
    short = 0;
  const indexed = new Map(index.map((u) => [u.id, u]));
  for (const name of Object.keys(meta.hashes)) {
    if (name.startsWith("text/"))
      for (const u of Object.values(load(name))) {
        assert.equal(u.book_id, meta.id);
        assert.equal(u.language, meta.language);
        assert.equal(hash(JSON.stringify(u.text)), u.sha256);
        assert.equal(indexed.get(u.id)?.sha256, u.sha256);
        const p = u.site_summary
          ? { text: u.site_summary, complete: false }
          : preview(u);
        if (!u.site_summary) {
          assert.ok(u.text.includes(p.text));
          quotes++;
        }
        for (const span of evidence(u)) {
          assert.equal(u.text.slice(span.start, span.end), span.text);
          evidenceSpans++;
        }
        if (p.complete) short++;
        if (meta.id.startsWith("islamqa-")) {
          assert.equal(u.id, `${meta.id}-${u.reference}`);
          assert.equal(
            u.url,
            `https://islamqa.info/${meta.language}/answers/${u.reference}`,
          );
        }
        if (u.content_type === "source_incomplete")
          assert.equal(u.retrievable, false);
        units++;
      }
    else if (name !== "index.json" && name !== "focus.i8") load(name);
  }
  assert.equal(units, meta.units);
  assert.equal(index.filter((u) => u.has_vector).length, meta.semantic_units);
  report.push({
    source: meta.id,
    units,
    semanticUnits: meta.semantic_units,
    exactExcerpts: quotes,
    evidenceSpans,
    completeShortAnswers: short,
    files: Object.keys(meta.hashes).length,
  });
  console.log(meta.id, units, "verified");
}
fs.writeFileSync(
  "private/multisource-integrity.json",
  JSON.stringify(
    {
      passed: true,
      scope:
        "byte integrity and quotation spans; not answer relevance or scholarly certification",
      sources: report,
    },
    null,
    2,
  ),
);
