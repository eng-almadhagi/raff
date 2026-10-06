import { importBook, searchLibrary } from "./library-core.mjs";
self.onmessage = ({ data }) => {
  try {
    const result =
      data.type === "import"
        ? importBook(data.payload)
        : searchLibrary(data.books, data.question, data.scope);
    self.postMessage({ id: data.id, result });
  } catch (e) {
    self.postMessage({ id: data.id, error: e.message });
  }
};
