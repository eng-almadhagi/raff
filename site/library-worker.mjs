import { importBook, searchLibrary } from "./library-core.mjs";
import { extractDocument } from "./document-import.mjs";
self.onmessage = async ({ data }) => {
  try {
    let extraction;
    let payload = data.payload;
    if (data.type === "import" && payload.buffer) {
      const extracted = await extractDocument(payload.buffer, payload.filename);
      extraction = extracted.extraction;
      payload = {
        ...payload,
        content: JSON.stringify({ sections: extracted.sections }),
        filename: payload.filename + ".json",
      };
    }
    const result =
      data.type === "import"
        ? importBook(payload)
        : searchLibrary(data.books, data.question, data.scope);
    if (extraction) {
      result.extraction = extraction;
      result.filename = data.payload.filename;
    }
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
