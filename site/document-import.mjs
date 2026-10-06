const base = new URL("./vendor/documents/", import.meta.url);
const letters = (text) => (text.match(/\p{L}/gu) || []).length;

export function pdfPageText(items) {
  return items
    .filter((item) => typeof item.str === "string")
    .map((item) => item.str + (item.hasEOL ? "\n" : " "))
    .join("")
    .trim();
}

// Reject oversized expanded DOCX archives before the ZIP library allocates them.
export function validateDocxArchive(buffer) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw Error("document-invalid");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true),
    expanded = 0;
  if (count > 10000 || offset >= end) throw Error("document-limit");
  for (let i = 0; i < count; i++) {
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50)
      throw Error("document-invalid");
    expanded += view.getUint32(offset + 24, true);
    if (expanded > 30_000_000) throw Error("document-limit");
    offset +=
      46 +
      view.getUint16(offset + 28, true) +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
  }
  if (offset > end) throw Error("document-invalid");
}

export async function extractDocument(buffer, filename) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength > 20_000_000)
    throw Error("document-limit");
  let sections = [],
    warnings = [];
  if (/\.pdf$/i.test(filename)) {
    const pdfjs = await import(
      "./vendor/documents/pdfjs-dist/build/pdf.min.mjs"
    );
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      "pdfjs-dist/build/pdf.worker.min.mjs",
      base,
    ).href;
    const port = new Worker(pdfjs.GlobalWorkerOptions.workerSrc, {
      type: "module",
    });
    const pdfWorker = new pdfjs.PDFWorker({ port });
    let doc;
    try {
      doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        worker: pdfWorker,
        useWorkerFetch: true,
        isEvalSupported: false,
        cMapUrl: new URL("pdfjs-dist/cmaps/", base).href,
        cMapPacked: true,
        standardFontDataUrl: new URL("pdfjs-dist/standard_fonts/", base).href,
        wasmUrl: new URL("pdfjs-dist/wasm/", base).href,
      }).promise;
      if (doc.numPages > 2000) throw Error("document-limit");
      let size = 0;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        const text = pdfPageText((await page.getTextContent()).items);
        page.cleanup();
        if (letters(text) < 3) {
          warnings.push(n);
          continue;
        }
        size += text.length;
        if (size > 5_000_000 || text.length > 100000)
          throw Error("document-limit");
        sections.push({ text, reference: `PDF · ${n}`, heading: "" });
      }
    } catch (e) {
      if (e.name === "PasswordException") throw Error("document-password");
      if (e.message.startsWith("document-")) throw e;
      throw Error("document-invalid");
    } finally {
      await doc?.loadingTask.destroy();
      pdfWorker.destroy();
      port.terminate();
    }
  } else if (/\.docx$/i.test(filename)) {
    validateDocxArchive(buffer);
    await import("./vendor/documents/mammoth/mammoth.browser.min.js");
    let result;
    try {
      result = await globalThis.mammoth.extractRawText({ arrayBuffer: buffer });
    } catch {
      throw Error("document-invalid");
    }
    if (result.value.length > 5_000_000) throw Error("document-limit");
    sections = result.value
      .split(/\n\s*\n/u)
      .filter((text) => text.trim())
      .map((text, i) => ({
        text,
        reference: `DOCX · § ${i + 1}`,
        heading: "",
      }));
  } else throw Error("document-format");
  if (letters(sections.map((s) => s.text).join(" ")) < 20)
    throw Error("document-no-text");
  return {
    sections,
    extraction: {
      format: /\.pdf$/i.test(filename) ? "pdf" : "docx",
      pagesWithoutText: warnings,
    },
  };
}
