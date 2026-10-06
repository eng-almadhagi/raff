import test from "node:test";
import assert from "node:assert/strict";
import {
  pdfPageText,
  validateDocxArchive,
  extractDocument,
} from "../site/document-import.mjs";

test("PDF text keeps logical Arabic strings and explicit line breaks", () => {
  assert.equal(
    pdfPageText([
      { str: "النص الأصلي", hasEOL: true },
      { str: "إلا عند الضرورة", hasEOL: false },
      {},
    ]),
    "النص الأصلي\nإلا عند الضرورة",
  );
});
test("broken DOCX archives and decompression bombs are rejected before extraction", () => {
  assert.throws(
    () => validateDocxArchive(new ArrayBuffer(4)),
    /document-invalid/,
  );
  const buffer = new ArrayBuffer(68),
    v = new DataView(buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint32(24, 40_000_000, true);
  v.setUint32(46, 0x06054b50, true);
  v.setUint16(56, 1, true);
  assert.throws(() => validateDocxArchive(buffer), /document-limit/);
});
test("file limits and unsupported formats fail without importing a parser", async () => {
  await assert.rejects(
    extractDocument(new ArrayBuffer(20_000_001), "a.pdf"),
    /document-limit/,
  );
  await assert.rejects(
    extractDocument(new ArrayBuffer(1), "a.doc"),
    /document-format/,
  );
});
