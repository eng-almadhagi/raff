import { PagedEngine, checked } from "./paged-engine.mjs?v=0.14.2";
let engine,
  extractor,
  modelSetupMilliseconds = 0,
  language = "ar";
const progress = (message) => postMessage({ type: "progress", message });
async function embed(question) {
  if (!extractor) {
    const setupStarted = performance.now();
    progress(
      language === "ar"
        ? "جارٍ تحميل نموذج البحث بالمعنى؛ التحميل الأول أكبر من الزيارات اللاحقة…"
        : "Loading the semantic model; the first download is larger than later visits…",
    );
    const { pipeline, env } = await import("./vendor/transformers.min.js");
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = new URL("./models/", import.meta.url).href;
    env.backends.onnx.wasm.wasmPaths = new URL(
      "./vendor/",
      import.meta.url,
    ).href;
    env.backends.onnx.wasm.numThreads = 1;
    extractor = await pipeline("feature-extraction", "e5", {
      dtype: "q8",
      device: "wasm",
    });
    modelSetupMilliseconds = Math.round(performance.now() - setupStarted);
  }
  const output = await extractor("query: " + question, {
    pooling: "mean",
    normalize: true,
    truncation: true,
    max_length: 512,
  });
  return Array.from(output.data);
}
onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      const sameLanguage = language === data.language;
      language = data.language;
      if (engine && sameLanguage) {
        engine.catalog = data.catalog;
        engine.last.clear();
      } else
        engine = new PagedEngine(
          data.catalog,
          await checked("./vocabulary.json"),
          embed,
          progress,
        );
      postMessage({ type: "ready" });
      // Fetch the selected language's small text indexes while the reader types.
      // No model download or vector preparation is triggered until needed.
      void Promise.allSettled(
        data.catalog
          .filter((meta) => meta.language === language)
          .map((meta) => engine.load(meta)),
      );
      return;
    }
    if (data.type === "ask") {
      const started = performance.now();
      modelSetupMilliseconds = 0;
      const result = await engine.ask(data.question, language, data.sourceIds);
      postMessage({
        type: "answer",
        result,
        milliseconds: Math.round(performance.now() - started),
        preparationMilliseconds: engine.lastPreparationMilliseconds || 0,
        modelSetupMilliseconds,
      });
      return;
    }
    if (data.type === "open") {
      const meta = engine.catalog.find(
        (m) => m.id === data.source && m.language === language,
      );
      if (!meta) throw Error("Source is not in the selected language");
      const citation = await engine.citation(meta, data.id);
      engine.last.set(language, [{ id: meta.id, ids: [data.id] }]);
      postMessage({ type: "opened", source: meta, citation });
      return;
    }
    if (data.type === "browse") {
      const entries = [];
      for (const meta of engine.catalog.filter(
        (m) => m.language === language && data.sourceIds.includes(m.id),
      )) {
        const book = await engine.load(meta);
        entries.push(
          ...book.index.map((u) => ({
            ...u,
            source: meta.id,
            sourceTitle: meta.title,
          })),
        );
      }
      postMessage({ type: "catalog", units: entries });
    }
  } catch (error) {
    postMessage({ type: "error", message: error.message });
  }
};
