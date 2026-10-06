import {
  terms,
  evidence,
  normalize,
  focusedPreview,
} from "./core.mjs?v=0.14.2";
import {
  classifyPolicy,
  policyMessages,
  directReference,
} from "./policy.mjs?v=0.14.2";
import {
  prepareSubjects,
  restoreSubjects,
  subjectQuery,
  subjectMatch,
  answerSupportsQuestion,
  isRelatedCase,
} from "./relevance.mjs?v=0.14.2";

export const bucket = (text) => {
  let h = 0;
  for (const c of text) h = (Math.imul(h, 31) + c.codePointAt(0)) >>> 0;
  return h % 64;
};
const dot = (data, index, q) => {
  let sum = 0;
  for (let j = 0; j < q.length; j++) sum += data[index * q.length + j] * q[j];
  return sum;
};
const decode = (buffer) => {
  const bytes = new Int8Array(buffer),
    values = Float32Array.from(bytes);
  for (let i = 0; i < values.length; i += 384) {
    let norm = 0;
    for (let j = 0; j < 384; j++) norm += values[i + j] ** 2;
    norm = Math.sqrt(norm) || 1;
    for (let j = 0; j < 384; j++) values[i + j] /= norm;
  }
  return values;
};
export function searchQuery(question, language) {
  if (language === "en")
    return question
      .replace(/rak[’'‘`-]?a[’']?h?s?/giu, "rakahs")
      .replace(/\b(?:least|fewest)\b/giu, "minimum")
      .replace(
        /^(?:what (?:is said|do (?:your|the) sources say) about)\s*/iu,
        "",
      );
  // Reusable colloquial vocabulary; source quotations are never transformed.
  let q = question
    .replace(/(?:أجر|اجر)\s+(?=(?:الصلاة|صلاة|الصيام|الصوم|الصدقة))/gu, "ثواب ")
    .replace(/(?:أداء\s+)?الصلاة\s+(?:مع|في)\s+(?:ال)?جماعة/gu, "صلاة الجماعة")
    .replace(/لماذا\s+(?:تختلف|يختلف|يختلفون)/gu, "اختلاف")
    .replace(/ينفع/gu, "يجوز")
    .replace(/يبان/gu, "يظهر")
    .replace(/وش يقول المصدر عن/gu, "حكم");
  q = q.replace(/^.*(?:عطِ?ني|أعطني|اعطني) جواب[ًا]* موضوعي[ًا]* عن\s*/u, "");
  q = q.replace(/في نهار رمضان/gu, "للصائم");
  q = q.replace(/^هل توجد [أا]قوال مختلف[هة] في\s*/u, "الخلاف في ");
  // Presentation requests are not the subject of the fatwa. Removing them
  // improves both dense intent and lexical coverage without answer-specific rules.
  q = q
    .replace(
      /^(?:ما المذكور عن|اعرض ما ورد عن|[أا]عطني فتو[ىي] عن|هل توجد [أا]قوال مختلف[هة] في)\s*/u,
      "",
    )
    .replace(
      /(?:انقل من المصدر|مع المرجع|بحسب المصادر|اعرض ما وجدته فقط|مع شروطها|مع شروطه)/gu,
      "",
    )
    .replace(/\s+[.،]\s*$/u, "")
    .replace(/\s+/gu, " ")
    .trim();
  if (/مسح|امسح|أمسح/u.test(q))
    q = q.replace(/الشراب/gu, "الجوارب").replace(/الخفيف/gu, "الرقيق الشفاف");
  return q || question;
}
// A scope mismatch is not a religious judgment. It prevents an explicitly
// resident-only question from answering a travel query (and vice versa).
export function scopeConflict(question, entry) {
  const q = normalize(question),
    title = normalize(entry.title);
  if (/(?:زكا[ةهت]|zaka[th])/iu.test(q)) {
    const fitr = /فطر|\bfitr\b/iu;
    if (fitr.test(title) && !fitr.test(q)) return true;
    if (fitr.test(q) && !fitr.test(title + " " + (entry.question || "")))
      return true;
    if (
      /الماضي|سنوات سابق|اعوام سابق|سنين ماضي|past years|previous years/iu.test(
        title,
      ) &&
      !/ماضي|سابق|سنوات|سنين|تاخير|تأخير|لم اخرج|لم أخرج|past|previous|missed/iu.test(
        q,
      )
    )
      return true;
  }
  // A disagreement about one named subtopic is not an explanation of why
  // fatwas differ in general. Keep general sources about fatwas eligible.
  if (
    /(?:خلاف|اختلاف)/u.test(q) &&
    /(?:فتاوي|فتوى)/u.test(q) &&
    !/\sفي\s/u.test(q) &&
    /\sفي\s/u.test(title) &&
    !/(?:فتاوي|فتوى)/u.test(title)
  )
    return true;
  // A named subtype must not be replaced by a general prayer introduction.
  const subtype = q.match(
    /(?:صلاه|صلاة) (الاستسقاء|الكسوف|الخسوف|التراويح|الجنازه|الجنازة|الجماعة|العيد)/u,
  )?.[1];
  if (subtype && !(title + " " + (entry.question || "")).includes(subtype))
    return true;
  // Explicit exceptional contexts in a title must not silently become the
  // answer to a general query that never asked about that context.
  for (const facet of [
    /(?:صمم|اصم|deaf)/iu,
    /(?:نذر|نذرت|vow|oath)/iu,
    /(?:نساء|امراة|المراة|woman|women)/iu,
    /(?:تخمين|تقدير|estimate|estimating)/iu,
  ])
    if (facet.test(title) && !facet.test(q)) return true;
  if (
    /بين.+و/u.test(q) &&
    /^(?:هل يشرع )?.*(?:بعد|قبل) /u.test(title) &&
    !/بين/u.test(title)
  )
    return true;
  if (
    /(?:لخطيب|للخطيب|حق خطيب|خطيب الجمعه)/u.test(title) &&
    !/(?:لخطيب|للخطيب|الخطيب نفسه|خطيب الجمعه)/u.test(q)
  )
    return true;
  if (/(?:قضاء.*رمضان|رمضان.*قضاء)/u.test(title) && !/قضاء/u.test(q))
    return true;
  if (/قضاء/u.test(title) && /(?:صوم|صيام|fast)/iu.test(q) && !/قضاء/u.test(q))
    return true;
  const occasion = q.match(/(?:عاشوراء|عرفه|عرفة)/u)?.[0];
  if (occasion && !(title + " " + (entry.question || "")).includes(occasion))
    return true;
  const grave = /(?:قبر|قبور|grave|cemeter)/iu;
  if (grave.test(q) && !grave.test(title + " " + (entry.question || "")))
    return true;
  const classify = (text) => {
    let q = normalize(text);
    const residence =
      /(?:مقيم|اقامه دائمه|resident|without travel|not travell?ing|من غير سفر|بدون سفر)/u.test(
        q,
      );
    q = q.replace(
      /(?:without travel|not travell?ing|من غير سفر|بدون سفر)/gu,
      "",
    );
    const travel = /(?:سفر|مسافر|يسافر|travel|journey)/u.test(q);
    return { residence, travel };
  };
  const wanted = classify(question),
    scope = classify(entry.title + " " + (entry.question || ""));
  return (
    (wanted.travel && !wanted.residence && scope.residence && !scope.travel) ||
    (wanted.residence && !wanted.travel && scope.travel && !scope.residence)
  );
}
export async function checked(url, hash, binary = false, compressed = false) {
  const response = await fetch(url + (compressed ? ".gz" : ""));
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (hash) {
    const actual = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)),
    ]
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    if (actual !== hash) throw Error("Content checksum mismatch");
  }
  const decoded = compressed
    ? await new Response(
        new Blob([buffer])
          .stream()
          .pipeThrough(new DecompressionStream("gzip")),
      ).arrayBuffer()
    : buffer;
  return binary ? decoded : JSON.parse(new TextDecoder().decode(decoded));
}

export class PagedEngine {
  constructor(catalog, vocabulary, embed, progress = () => {}) {
    this.catalog = catalog;
    this.vocabulary = vocabulary;
    this.embed = embed;
    this.progress = progress;
    this.loaded = new Map();
    this.loadingIndexes = new Map();
    this.last = new Map();
  }
  async load(meta, vectors = false) {
    if (!/^[a-z0-9-]+$/u.test(meta.id)) throw Error("Invalid source identity");
    const base = `./data/${meta.id}/`;
    if (!this.loaded.has(meta.id)) {
      if (!this.loadingIndexes.has(meta.id)) {
        const loading = (async () => {
          const [index, prepared] = await Promise.all([
            checked(
              base + "index.json",
              meta.hashes["index.json"],
              false,
              meta.compression === "gzip",
            ),
            meta.has_subjects
              ? checked(
                  base + "subjects.json",
                  meta.hashes["subjects.json"],
                  false,
                  meta.compression === "gzip",
                )
              : null,
          ]);
          if (index.length !== meta.units)
            throw Error("Incomplete source index");
          this.loaded.set(meta.id, {
            meta,
            index,
            base,
            postings: new Map(),
            text: new Map(),
            subjects: prepared
              ? restoreSubjects(prepared, index.length)
              : prepareSubjects(index, this.vocabulary),
          });
        })();
        this.loadingIndexes.set(meta.id, loading);
      }
      try {
        await this.loadingIndexes.get(meta.id);
      } finally {
        this.loadingIndexes.delete(meta.id);
      }
    }
    const book = this.loaded.get(meta.id);
    if (vectors && !book.focus) {
      const [focusBuffer, chunkBuffer, chunkUnits] = await Promise.all([
        checked(base + "focus.i8", meta.hashes["focus.i8"], true),
        meta.has_chunks
          ? checked(base + "chunks.i8", meta.hashes["chunks.i8"], true)
          : null,
        meta.has_chunks
          ? checked(
              base + "chunk-units.json",
              meta.hashes["chunk-units.json"],
              false,
              meta.compression === "gzip",
            )
          : null,
      ]);
      const focus = decode(focusBuffer),
        chunks = chunkBuffer ? decode(chunkBuffer) : null;
      if (focus.length !== meta.units * 384)
        throw Error("Invalid vector dimensions");
      if (meta.has_chunks) {
        if (
          chunks.length !== chunkUnits.length * 384 ||
          chunkUnits.some(
            (i) => !Number.isInteger(i) || i < 0 || i >= meta.units,
          )
        )
          throw Error("Invalid passage index");
      }
      // Commit only a complete validated set, so a failed download is retryable.
      Object.assign(book, { focus, chunks, chunkUnits });
    }
    return book;
  }
  async citation(meta, id, includeRelated = true, question = "") {
    const book = await this.load(meta),
      index = book.index.findIndex((u) => u.id === id);
    if (index < 0) throw Error("Unknown source reference");
    const entry = book.index[index],
      name = `text/${entry.shard}.json`;
    if (!book.text.has(entry.shard)) {
      const shard = await checked(
        book.base + name,
        meta.hashes[name],
        false,
        meta.compression === "gzip",
      );
      if (book.text.size >= 4) book.text.delete(book.text.keys().next().value);
      book.text.set(entry.shard, shard);
    }
    const unit = book.text.get(entry.shard)[id];
    if (
      !unit ||
      unit.book_id !== meta.id ||
      unit.language !== meta.language ||
      unit.sha256 !== entry.sha256
    )
      throw Error("Source/language mismatch");
    const p = focusedPreview(unit, question, this.vocabulary);
    if (p.label !== "site-summary" && !unit.text.includes(p.text))
      throw Error("Invalid quotation");
    const related = [];
    if (includeRelated && book.focus && entry.has_vector) {
      const subject = new Set(
          terms(entry.title, this.vocabulary).filter(
            (t) =>
              !["رمضان", "صيام", "يوم", "احكام", "حكم", "ruling"].includes(t),
          ),
        ),
        vector = book.focus.subarray(index * 384, (index + 1) * 384);
      const candidates = book.index
        .map((u, i) => ({
          u,
          i,
          score: u.has_vector ? dot(book.focus, i, vector) : 0,
        }))
        .filter(
          (r) =>
            r.i !== index &&
            r.u.retrievable &&
            r.u.title !== entry.title &&
            r.score > 0.84 &&
            terms(r.u.title, this.vocabulary).some((t) => subject.has(t)),
        )
        .sort((a, b) => b.score - a.score);
      const seen = new Set();
      for (const c of candidates) {
        if (seen.has(c.u.title)) continue;
        seen.add(c.u.title);
        related.push({ id: c.u.id, title: c.u.title });
        if (related.length === 3) break;
      }
    }
    return { ...unit, preview: p, evidence: evidence(unit), related };
  }
  async rank(meta, question, vector) {
    if (
      vector.length !== 384 ||
      vector.some((value) => !Number.isFinite(value))
    )
      throw Error("Invalid query vector");
    const book = await this.load(meta, true),
      wanted = [...new Set(terms(question, this.vocabulary))];
    const buckets = [...new Set(wanted.map(bucket))];
    // Four independent postings files at a time, without changing scoring.
    for (let start = 0; start < buckets.length; start += 4) {
      await Promise.all(
        buckets.slice(start, start + 4).map(async (number) => {
          if (!book.postings.has(number)) {
            const name = `lex/${number}.json`;
            book.postings.set(
              number,
              await checked(
                book.base + name,
                meta.hashes[name],
                false,
                meta.compression === "gzip",
              ),
            );
          }
        }),
      );
    }
    const n = book.index.length,
      lex = new Float32Array(n),
      covered = new Float32Array(n),
      dense = new Float32Array(n);
    let total = 0;
    const missing = [];
    for (const term of wanted) {
      const entries = book.postings.get(bucket(term))[term] || [],
        docs = new Set(entries.map((r) => r[0]));
      if (!entries.length) missing.push(term);
      const weight = Math.log(1 + (n - docs.size + 0.5) / (docs.size + 0.5));
      total += weight;
      for (const i of docs) covered[i] += weight;
      for (const [i, j, tf] of entries)
        lex[i] +=
          ([3, 2, 1][j] * weight * tf * 2.2) /
          (tf +
            1.2 *
              (0.25 +
                (0.75 * book.index[i].lengths[j]) /
                  Math.max(meta.average_lengths[j], 1)));
    }
    if (book.chunks)
      for (let i = 0; i < book.chunkUnits.length; i++) {
        const u = book.chunkUnits[i];
        dense[u] = Math.max(dense[u], dot(book.chunks, i, vector));
      }
    // Bound retained postings without evicting this query's working set.
    const needed = new Set(wanted.map(bucket));
    for (const key of book.postings.keys()) {
      if (book.postings.size <= 16) break;
      if (!needed.has(key)) book.postings.delete(key);
    }
    const maxlex = lex.reduce((a, b) => Math.max(a, b), 1e-12),
      rows = [];
    const subjectQueryInfo = subjectQuery(
      question,
      book.subjects.frequencies,
      n,
      this.vocabulary,
    );
    for (let i = 0; i < n; i++) {
      const u = book.index[i];
      if (!u.retrievable || scopeConflict(question, u)) continue;
      const focus = u.has_vector ? dot(book.focus, i, vector) : 0,
        body = book.chunks ? dense[i] : focus;
      const coverage = covered[i] / Math.max(total, 1),
        semantic = 0.8 * focus + 0.2 * body;
      const subject = subjectMatch(
        subjectQueryInfo,
        u,
        book.subjects.documents[i],
      );
      rows.push({
        index: i,
        id: u.id,
        title: u.title,
        focus,
        dense: body,
        coverage,
        lexical: lex[i],
        subject,
        score:
          (0.12 * lex[i]) / maxlex +
          0.3 * Math.max(0, (semantic - 0.65) / 0.35) +
          0.1 * coverage +
          0.48 * subject.score,
      });
    }
    rows.sort((a, b) => b.score - a.score || a.index - b.index);
    const seen = new Set();
    const unique = rows.filter((row) => {
      const hash = book.index[row.index].sha256;
      if (seen.has(hash)) return false;
      seen.add(hash);
      return true;
    });
    return { rows: unique, missing };
  }
  async ask(question, language, sourceIds) {
    this.lastPreparationMilliseconds = 0;
    const kind = classifyPolicy(question, language),
      messages = policyMessages[language],
      reference = directReference(question);
    const metas = this.catalog.filter(
      (m) => m.language === language && sourceIds.includes(m.id),
    );
    if (kind.startsWith("followup")) {
      const prior = this.last.get(language);
      if (!prior?.length)
        return { kind: "context", message: messages.context, sources: [] };
      const sources = [];
      for (const previous of prior) {
        const meta = metas.find((m) => m.id === previous.id);
        if (!meta) continue;
        sources.push({
          id: meta.id,
          title: meta.title,
          kind: "citation",
          citations: await Promise.all(
            previous.ids.map((id) =>
              this.citation(meta, id, true, previous.question || ""),
            ),
          ),
        });
      }
      return {
        kind,
        level: "B",
        message:
          language === "ar"
            ? "النص السابق من المصدر نفسه؛ لا نختصر الشروط لإلزامه بعدد سطور."
            : "The previous source text is preserved. Conditions are not removed to force a line limit.",
        sources,
        openFull: kind === "followup-full",
      };
    }
    this.last.delete(language);
    if (messages[kind] && reference === null)
      return {
        kind,
        level: kind === "refer" ? "D" : null,
        message: messages[kind],
        sources: [],
      };
    const query = searchQuery(question, language),
      sources = [];
    const fast = new Map();
    if (reference === null && kind !== "qualified") {
      await Promise.all(
        metas.map(async (meta) => {
          try {
            const book = await this.load(meta);
            const subject = subjectQuery(
              query,
              book.subjects.frequencies,
              book.index.length,
              this.vocabulary,
            );
            if (subject.wanted.length < 2) return;
            const candidates = book.index
              .map((u, i) => ({
                u,
                match: subjectMatch(subject, u, book.subjects.documents[i]),
              }))
              .filter(
                ({ u, match }) =>
                  u.retrievable &&
                  !scopeConflict(query, u) &&
                  !isRelatedCase(query, u) &&
                  match.titleCoverage >= 0.99 &&
                  match.precision >= 0.75,
              )
              .sort((a, b) => b.match.score - a.match.score)
              .slice(0, 3);
            for (const { u } of candidates) {
              const citation = await this.citation(meta, u.id, false, question);
              if (answerSupportsQuestion(citation, query, this.vocabulary)) {
                fast.set(meta.id, citation);
                break;
              }
            }
          } catch {
            /* The normal source path reports failures with its source identity. */
          }
        }),
      );
    }
    let vector = null;
    if (reference === null && fast.size < metas.length) {
      const preparationStarted = performance.now();
      // Model setup and immutable source indexes are independent. Fetch both
      // concurrently; retain source failures for the existing per-source UI.
      [vector] = await Promise.all([
        this.embed(query),
        Promise.allSettled(
          metas
            .filter((meta) => !fast.has(meta.id))
            .map((meta) => this.load(meta, true)),
        ),
      ]);
      this.lastPreparationMilliseconds = Math.round(
        performance.now() - preparationStarted,
      );
    }
    for (const meta of metas) {
      this.progress(meta.title);
      try {
        if (fast.has(meta.id)) {
          sources.push({
            id: meta.id,
            title: meta.title,
            kind: "citation",
            citations: [fast.get(meta.id)],
          });
          continue;
        }
        if (reference !== null) {
          const book = await this.load(meta),
            entry = meta.id.startsWith("islamqa-")
              ? book.index.find((u) => u.reference === reference)
              : null;
          sources.push(
            entry?.retrievable
              ? {
                  id: meta.id,
                  title: meta.title,
                  kind: "citation",
                  citations: [await this.citation(meta, entry.id)],
                }
              : {
                  id: meta.id,
                  title: meta.title,
                  kind: "insufficient",
                  message: messages.insufficient,
                  citations: [],
                },
          );
          continue;
        }
        const { rows, missing } = await this.rank(meta, query, vector);
        const enough = (r) =>
          (r.subject.anchor || r.focus >= 0.91) &&
          ((r.coverage >= 0.4 && r.focus >= 0.84) ||
            (r.coverage >= 0.5 && r.focus >= 0.835) ||
            (r.coverage >= 0.25 && r.focus >= 0.875) ||
            (r.coverage >= 0.4 && r.dense >= 0.855) ||
            (r.subject.titleCoverage >= 0.95 &&
              r.subject.lead &&
              r.focus >= 0.82)) &&
          (Math.max(r.subject.titleCoverage, r.subject.questionCoverage) >=
            0.4 ||
            r.focus >= 0.89 ||
            r.dense >= 0.89);
        const eligible = rows.filter(enough),
          best = eligible[0];
        const namedGap =
          /(?:بالاسم|by name)/iu.test(query) &&
          missing.some((t) => /[a-z]{3}/iu.test(t));
        if (!best || !enough(best) || namedGap) {
          sources.push({
            id: meta.id,
            title: meta.title,
            kind: "insufficient",
            message: messages.insufficient,
            citations: [],
          });
          continue;
        }
        const plural =
          kind === "qualified" ||
          /(?:قبل.+بعد)/u.test(normalize(question)) ||
          /(?:فتاوي|النصوص|قارن|compare|opinions)/iu.test(normalize(question));
        // A small score margin among relevant fatwas is not linguistic ambiguity.
        // Ambiguous questions are handled by policy before retrieval.
        const selected = eligible
            .filter((r) => enough(r) && r.score >= best.score - 0.2)
            .slice(0, 20),
          citations = [],
          suggestions = [];
        for (const r of selected) {
          const c = await this.citation(meta, r.id, false, question);
          if (!answerSupportsQuestion(c, query, this.vocabulary)) continue;
          if (isRelatedCase(query, c)) {
            if (suggestions.length < 3)
              suggestions.push({ id: c.id, title: c.title });
            continue;
          }
          if (citations.length && r.score < best.score - 0.04) continue;
          if (!citations.some((p) => p.text === c.text))
            citations.push(await this.citation(meta, r.id, true, question));
          if (citations.length >= (plural ? 2 : 1)) break;
        }
        sources.push({
          id: meta.id,
          title: meta.title,
          kind: citations.length ? "citation" : "insufficient",
          message: citations.length ? undefined : messages.insufficient,
          citations,
          suggestions,
        });
      } catch (error) {
        sources.push({
          id: meta.id,
          title: meta.title,
          kind: "error",
          message:
            language === "ar"
              ? "تعذر تحميل جزء من هذا المصدر. أعد المحاولة؛ لا نستبدل مصدرًا آخر به."
              : "A source shard could not be loaded. Retry; another source is not substituted.",
          error: error.message,
          citations: [],
        });
      }
    }
    const cited = sources.filter((s) => s.citations.length);
    if (cited.length)
      this.last.set(
        language,
        cited.map((s) => ({
          id: s.id,
          ids: s.citations.map((c) => c.id),
          question: reference === null ? question : "",
        })),
      );
    return {
      kind,
      level: { information: "A", explain: "B", qualified: "C" }[kind],
      message: !cited.length
        ? language === "ar"
          ? "لم نعثر على نص كافٍ يجيب مباشرة عن هذا السؤال في المصادر المحددة."
          : "No sufficiently direct answer was found in the selected sources."
        : language === "ar"
          ? "النصوص المناسبة لسؤالك فقط، مع فصل المصادر دون دمج الأقوال أو ترجيح بينها."
          : "Only relevant source answers are shown, separately and without independently preferring an opinion.",
      sources,
    };
  }
}
