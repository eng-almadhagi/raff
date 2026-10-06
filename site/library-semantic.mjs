import { libraryTerms } from "./library-core.mjs?v=0.12.0";
import { libraryDB } from "./library-store.mjs?v=0.12.0";

const VERSION = "e5-q8-passages-v3";
let encoder;
async function encode(texts, kind, progress) {
  if (!encoder) {
    progress("model");
    const { pipeline, env } = await import("./vendor/transformers.min.js");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL("./models/", import.meta.url).href;
    env.backends.onnx.wasm.wasmPaths = new URL(
      "./vendor/",
      import.meta.url,
    ).href;
    env.backends.onnx.wasm.numThreads = 1;
    encoder = await pipeline("feature-extraction", "e5", {
      dtype: "q8",
      device: "wasm",
      progress_callback: () => progress("model"),
    });
  }
  const result = await encoder(
    texts.map((text) => `${kind}: ${text}`),
    { pooling: "mean", normalize: true, truncation: true, max_length: 512 },
  );
  return result.tolist();
}

export function passageWindows(book) {
  const windows = [];
  for (let index = 0; index < book.units.length; index++) {
    const unit = book.units[index],
      context = [unit];
    const previous = book.units[index - 1],
      next = book.units[index + 1];
    // Keep a short heading/question attached to its following source answer.
    if (
      previous &&
      previous.text.length < 150 &&
      !/[.!。]\s*$/u.test(previous.text)
    )
      context.unshift(previous);
    if (next && (/[?؟]\s*$/u.test(unit.text) || unit.text.length < 80))
      context.push(next);
    const text = context.map((u) => u.text).join("\n\n");
    for (let start = 0; start < text.length; ) {
      let end = Math.min(start + 900, text.length);
      if (end < text.length) {
        const space = text.lastIndexOf(" ", end);
        if (space > start + 600) end = space;
      }
      windows.push({
        text: text.slice(start, end),
        unitIds: context.map((u) => u.id),
      });
      if (end === text.length) break;
      start = end - 150;
    }
  }
  return windows;
}

export function selectSemanticPassages(rows, question) {
  const query = libraryTerms(question);
  const ordered = [...rows].sort((a, b) => b.similarity - a.similarity);
  const best = ordered[0]?.similarity || 0;
  const scored = ordered
    .slice(0, 40)
    .map((row) => {
      const tokens = new Set(libraryTerms(row.text));
      const coverage = query.length
        ? query.filter((t) => tokens.has(t)).length / query.length
        : 0;
      const asksMoney =
        /راتب|رواتب|سعر|ثمن|تكلف|رسوم|مبلغ|كم.*ادفع|\b(?:salary|cost|price|fee|pay)\b/iu.test(
          question,
        );
      const hasMoneyEvidence =
        /راتب|رواتب|اجر|أجر|أجور|اجور|سعر|ثمن|تكلف|رسوم|مبلغ|مجان|ريال|دولار|جنيه|دينار|درهم|يورو|\b(?:salary|cost|price|fee|pay|free|dollar|euro)\b/iu.test(
          row.text,
        );
      // Relevance gates are evaluated on passages, not titles or user query echoes alone.
      const competitor =
        ordered.find(
          (r) =>
            r.bookId !== row.bookId ||
            !r.unitIds.some((id) => row.unitIds.includes(id)),
        )?.similarity || 0;
      const adequate =
        (!asksMoney || hasMoneyEvidence) &&
        row.similarity >= best - 0.025 &&
        ((row.similarity >= 0.84 && coverage >= 0.4) ||
          row.similarity >= 0.89 ||
          (row.similarity >= 0.82 && row.similarity - competitor >= 0.015));
      return {
        ...row,
        coverage,
        adequate,
        rank: row.similarity + 0.025 * coverage,
      };
    })
    .filter((row) => row.adequate)
    .sort((a, b) => b.rank - a.rank);
  const seen = new Set(),
    results = [];
  for (const row of scored) {
    if (results.length >= 4) break;
    if (row.unitIds.some((id) => seen.has(`${row.bookId}:${id}`))) continue;
    row.unitIds.forEach((id) => seen.add(`${row.bookId}:${id}`));
    results.push(row);
  }
  return results;
}

export async function semanticLibrarySearch(books, question, scope, progress) {
  const selected = books.filter(
    (b) => scope.bookIds.includes(b.id) && b.language === scope.language,
  );
  if (!selected.length) return [];
  const queryVector = (await encode([question], "query", progress))[0];
  const rows = [];
  for (const book of selected) {
    const windows = passageWindows(book);
    let cached = await libraryDB("get", "vectors", book.id);
    if (
      !cached ||
      cached.version !== VERSION ||
      cached.count !== windows.length
    )
      cached = {
        id: book.id,
        version: VERSION,
        count: windows.length,
        vectors: [],
      };
    for (let i = cached.vectors.length; i < windows.length; i += 8) {
      progress("index", { title: book.title, done: i, total: windows.length });
      const vectors = await encode(
        windows.slice(i, i + 8).map((w) => w.text),
        "passage",
        progress,
      );
      cached.vectors.push(...vectors);
      // Checkpoint each batch; interrupted indexing resumes, without rewriting the book or its shelf.
      await libraryDB("put", "vectors", cached);
    }
    for (let i = 0; i < windows.length; i++) {
      const similarity = queryVector.reduce(
        (sum, value, k) => sum + value * cached.vectors[i][k],
        0,
      );
      rows.push({ ...windows[i], bookId: book.id, similarity });
    }
  }
  progress("search");
  return selectSemanticPassages(rows, question).map((row) => {
    const book = selected.find((b) => b.id === row.bookId);
    const units = book.units.filter((u) => row.unitIds.includes(u.id));
    return {
      bookId: book.id,
      title: book.title,
      author: book.author,
      reference: units.map((u) => u.reference).join(" / "),
      heading: "",
      text: units.map((u) => u.text).join("\n\n"),
      similarity: row.similarity,
    };
  });
}
