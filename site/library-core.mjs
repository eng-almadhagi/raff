import { normalize } from "./core.mjs?v=0.13.1";

export const LIBRARY_VERSION = 1;
const stop = new Set(
  "ما ماذا لماذا متى اين أين هل كيف حكم عن في من على إلى الي هذا هذه ذلك الذي التي هو هي ان إن كان يكون هي اشرح وضح اذكر بحسب وفقا الملف الكتاب المصدر ورد يقول تقول وش ايش ممكن the a an is are what how why when where of in on to for does do explain describe according document book source please"
    .split(" ")
    .map(normalize),
);
export function libraryTerms(text) {
  return [
    ...new Set(
      (normalize(text).match(/[\p{L}\p{N}]+/gu) || [])
        .filter((t) => t.length > 1 && !stop.has(t))
        .map((t) => (t.startsWith("ال") && t.length > 4 ? t.slice(2) : t)),
    ),
  ];
}
const textField = (value, max) =>
  typeof value === "string" && value.trim().length <= max ? value.trim() : "";
export function importBook({
  content,
  filename,
  title,
  author = "",
  language = "ar",
  shelfId,
}) {
  if (
    typeof content !== "string" ||
    content.length > 5_000_000 ||
    !["ar", "en"].includes(language)
  )
    throw Error("invalid");
  title = textField(title, 200);
  if (
    !title ||
    !shelfId ||
    content.includes("\u0000") ||
    content.includes("\ufffd")
  )
    throw Error("invalid");
  let sections;
  if (/\.json$/i.test(filename)) {
    const data = JSON.parse(content);
    if (!Array.isArray(data.sections)) throw Error("invalid");
    sections = data.sections.map((s, i) => ({
      text: typeof s.text === "string" ? s.text : "",
      reference: textField(s.reference, 300) || `§ ${i + 1}`,
      heading: textField(s.heading, 300),
    }));
  } else if (/\.(txt|md)$/i.test(filename)) {
    // Keep every paragraph whole. Locations are paragraph numbers, never invented pages.
    sections = content
      .replace(/\r\n?/g, "\n")
      .split(/\n\s*\n/u)
      .filter((s) => s.trim())
      .map((text, i) => ({ text, reference: `§ ${i + 1}`, heading: "" }));
  } else throw Error("format");
  if (
    !sections.length ||
    sections.length > 5000 ||
    sections.some((s) => !s.text.trim() || s.text.length > 100000)
  )
    throw Error("invalid");
  return {
    schemaVersion: LIBRARY_VERSION,
    id: `local-${crypto.randomUUID()}`,
    title,
    author: textField(author, 200),
    language,
    shelfId,
    filename: textField(filename, 250),
    createdAt: new Date().toISOString(),
    units: sections.map((s, i) => ({
      ...s,
      id: i + 1,
      tokens: libraryTerms(s.text),
    })),
  };
}
export function searchLibrary(books, question, { language, bookIds }) {
  const terms = libraryTerms(question);
  if (!terms.length || !bookIds.length) return [];
  const allowed = new Set(bookIds),
    hits = [];
  for (const book of books) {
    if (!allowed.has(book.id) || book.language !== language) continue;
    for (const unit of book.units) {
      const present = new Set(unit.tokens);
      const matched = terms.filter((t) => present.has(t)).length;
      // A lexical passage match is not a sufficient religious answer.
      if (matched !== terms.length) continue;
      hits.push({
        bookId: book.id,
        title: book.title,
        author: book.author,
        ...unit,
        score: matched / Math.sqrt(unit.tokens.length + 1),
      });
    }
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, 12);
}
