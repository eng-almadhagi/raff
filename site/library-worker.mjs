import { importBook } from "./library-core.mjs?v=0.17.0";
import { extractDocument } from "./document-import.mjs?v=0.17.0";
import { semanticLibrarySearch } from "./library-semantic.mjs?v=0.17.0";
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
        : await semanticLibrarySearch(
            data.books,
            data.question,
            data.scope,
            (stage, detail) =>
              self.postMessage({ id: data.id, progress: { stage, ...detail } }),
          );
    if (extraction) {
      result.extraction = extraction;
      result.filename = data.payload.filename;
    }
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
