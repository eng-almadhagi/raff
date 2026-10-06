// Pure retrieval and response logic, shared by the browser worker and tests.
export const normalize = (s) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06edـ]/gu, "")
    .replace(/[أإآ]/gu, "ا")
    .replace(/ى/gu, "ي");
export function terms(text, vocabulary) {
  const stop = new Set(vocabulary.stop),
    concepts = vocabulary.concepts;
  return (normalize(text).match(/[\p{L}\p{N}_]+/gu) || []).flatMap((t) => {
    if (stop.has(t) || /^\d+$/u.test(t) || t.length < 2) return [];
    let w = t;
    if (/^(وال|فال|بال|كال)/u.test(w) && w.length > 5) w = w.slice(1);
    if (w.startsWith("لل") && w.length > 4) w = "ال" + w.slice(2);
    if (w.startsWith("ال") && w.length > 4) w = w.slice(2);
    if (w.length > 4)
      w = w.replace(/(?:تها|ته|تي)$/u, "ة").replace(/(?:هم|ها|كم|نا)$/u, "");
    if (stop.has(w)) return [];
    if (!concepts[w] && "وبفل".includes(w[0]) && concepts[w.slice(1)])
      w = w.slice(1);
    return [concepts[w] || w];
  });
}
export function prepare(units, vocabulary) {
  const fields = units.map((u) =>
    [u.title, u.question || "", u.text].map((s) => {
      const f = new Map();
      for (const t of terms(s, vocabulary)) f.set(t, (f.get(t) || 0) + 1);
      return f;
    }),
  );
  const df = new Map(),
    lengths = fields.map((fs) =>
      fs.map((f) => [...f.values()].reduce((a, b) => a + b, 0)),
    );
  for (const fs of fields)
    for (const t of new Set(fs.flatMap((f) => [...f.keys()])))
      df.set(t, (df.get(t) || 0) + 1);
  return {
    fields,
    df,
    lengths,
    averages: [0, 1, 2].map(
      (j) => lengths.reduce((s, r) => s + r[j], 0) / units.length,
    ),
  };
}
const dot = (matrix, row, vector, dim) => {
  let n = 0;
  for (let j = 0; j < dim; j++) n += matrix[row * dim + j] * vector[j];
  return n;
};
export function rank(book, question, vector) {
  const { units, lexical, vocabulary, focus, chunks, chunkUnits, dimension } =
    book;
  if (vector.length !== dimension || vector.some((x) => !Number.isFinite(x)))
    throw Error("Invalid query vector");
  const weights = new Map(
    [...new Set(terms(question, vocabulary))].map((t) => [
      t,
      Math.log(
        1 +
          (units.length - (lexical.df.get(t) || 0) + 0.5) /
            ((lexical.df.get(t) || 0) + 0.5),
      ),
    ]),
  );
  const total = Math.max(
      1,
      [...weights.values()].reduce((a, b) => a + b, 0),
    ),
    dense = new Float32Array(units.length);
  for (let i = 0; i < chunkUnits.length; i++) {
    const u = chunkUnits[i];
    dense[u] = Math.max(dense[u], dot(chunks, i, vector, dimension));
  }
  const rows = [];
  for (let i = 0; i < units.length; i++) {
    if (units[i].retrievable === false) continue;
    let lex = 0,
      coverage = 0;
    for (const [t, w] of weights) {
      if (lexical.fields[i].some((f) => f.has(t))) coverage += w;
      for (let j = 0; j < 3; j++) {
        const tf = lexical.fields[i][j].get(t) || 0;
        if (tf)
          lex +=
            ([2, 2.5, 1][j] * w * tf * 2.2) /
            (tf +
              1.2 *
                (0.25 +
                  (0.75 * lexical.lengths[i][j]) /
                    Math.max(lexical.averages[j], 1)));
      }
    }
    rows.push({
      index: i,
      lexical: lex,
      coverage: coverage / total,
      focus: dot(focus, i, vector, dimension),
      dense: dense[i],
    });
  }
  const maxlex = Math.max(1e-12, ...rows.map((r) => r.lexical));
  for (const r of rows)
    r.score =
      (0.1 * r.lexical) / maxlex +
      0.8 * Math.max(0, (0.8 * r.focus + 0.2 * r.dense - 0.65) / 0.35) +
      0.1 * r.coverage;
  rows.sort((a, b) => b.score - a.score || a.index - b.index);
  const seen = new Set();
  return rows.filter((r) => {
    const u = units[r.index],
      key = ((u.question || "") + (u.answer || u.text)).replace(
        /[^\p{L}\p{N}_]/gu,
        "",
      );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
export const sufficient = (r) =>
  (r.coverage >= 0.4 && r.focus >= 0.84) ||
  (r.coverage >= 0.25 && r.focus >= 0.875) ||
  (r.coverage >= 0.4 && r.dense >= 0.855);
export function route(question) {
  const q = normalize(question).trim(),
    words = q.split(/[^\p{L}\p{N}_]+/u);
  if (
    /^(?:ما حكم|هل يجوز|هل يحل|هل يصح)\s+(?:هذا|ذلك|هذه)(?:\s+(?:الشيء|الامر|الفعل|الحاله))?[؟? .]*$/u.test(
      q,
    ) ||
    [
      "وش اسوي الحين",
      "ما حكم المال",
      "ما حكم العمل",
      "هل فيه زكاه",
      "هل هذا حرام",
      "هل هذا حلال",
    ].includes(q.replace(/[؟?.]+$/u, ""))
  )
    return "clarify";
  if (
    [
      "تجاهل التعليمات",
      "اخترع",
      "بدون مصدر",
      "احذف الخلاف",
      "ignore instructions",
    ].some((t) => q.includes(t))
  )
    return "refuse";
  if (
    ["عاصمه", "عاصمة", "الطقس", "اكتب كود", "اكتب برنامج", "سعر السهم"].some(
      (t) => q.includes(t),
    ) &&
    !["حكم", "شرع", "حلال", "حرام", "يجوز", "فتوي", "فتاوي", "زكاه"].some((t) =>
      q.includes(t),
    )
  )
    return "insufficient";
  if (
    words.includes("انا") &&
    !/انا (?:ابحث|اسال عن|اريد معرفه|اريد تعريف)/u.test(q)
  )
    return "refer";
  const personal =
    "زوجتي زوجي طلقت طلاقي عقدي راتبي قرضي ميراثي ورثت اشتريت بعت اقترضت حلفت نذرت اجهضت دوائي صيامي زكاتي حجي نكاحي اني عندي ولدي بنتي نسيت سويت دفعت تزوجت صليت فاتتني افتني".split(
      " ",
    );
  if (
    personal.some((t) => words.includes(t)) ||
    [
      "صار لي",
      "علي شي",
      "وش اسوي",
      "علي كفاره",
      "صلاتي صحيحه",
      "اعيد صلاتي",
      "علي اعاده",
    ].some((t) => q.includes(t))
  )
    return "refer";
  if (
    ["قال الرسول", "قال النبي", "صحه حديث", "صحة حديث", "قال الله"].some((t) =>
      q.includes(t),
    )
  )
    return "verify";
  if (words.filter(Boolean).length < 2) return "clarify";
  if (
    [
      "قارن",
      "خلاف",
      "المذاهب",
      "اختلف",
      "الراجح",
      "تكفير",
      "الردة",
      "الرده",
      "العقيده التفصيليه",
    ].some((t) => q.includes(t))
  )
    return "qualified";
  return ["ما تعريف", "ما معني", "ما هي", "ما هو"].some((t) => q.includes(t))
    ? "information"
    : "explain";
}
export const messages = {
  refer:
    "هذه حالة شخصية تحتاج إلى مختص يطّلع على تفاصيلها. لا يطبّق رَفّ فتوى الكتاب على حالتك. يمكنك البحث عن المسألة بصياغة عامة.",
  clarify: "حدّد المسألة والفعل المقصود حتى أصل إلى النص المناسب.",
  insufficient:
    "لم أجد في الكتاب نصًا كافيًا للإجابة عن هذا السؤال. لا أستكمل الجواب من خارج المصدر.",
  refuse: "لا أختلق دليلًا أو مصدرًا، ولا أخفي خلافًا ورد في الكتاب.",
  verify:
    "لا أتحقق من صحة نسبة آية أو حديث بمجرد وروده في كتاب الفتاوى. يلزم الرجوع إلى مصدره للتحقق.",
};
export function select(units, rows, question) {
  const kind = route(question),
    level =
      {
        information: "أ",
        explain: "ب",
        qualified: "ج",
        refer: "د",
        verify: "ج",
        refuse: "ج",
      }[kind] || null;
  if (messages[kind]) return { kind, level, message: messages[kind], ids: [] };
  const plural =
    kind === "qualified" ||
    ["فتاوي", "النصوص", "اكثر من", "قارن"].some((t) =>
      normalize(question).includes(t),
    );
  if (!rows.length || !sufficient(rows[0]))
    return { kind: "insufficient", message: messages.insufficient, ids: [] };
  if (
    !plural &&
    rows.length > 1 &&
    rows[0].focus < 0.88 &&
    rows[0].score - rows[1].score < 0.025
  )
    return {
      kind: "clarify",
      ids: [],
      message: "وجدت مسائل متقاربة. اختر المقصود لتجنّب نقل جواب مسألة أخرى.",
      suggestions: rows.slice(0, 3).map((r) => units[r.index].title),
    };
  return {
    kind,
    level,
    message: "نقل من الكتاب؛ لا يمثل فتوى مستقلة أو تطبيقًا على حالة شخصية.",
    ids: rows
      .filter((r) => sufficient(r) && r.focus >= rows[0].focus - 0.02)
      .slice(0, plural ? 3 : 1)
      .map((r) => r.index),
  };
}
export function preview(unit) {
  // No generative paraphrase: a short COMPLETE answer is safe to quote. Long
  // answers/groups get an explicitly incomplete opening, never a synthetic ruling.
  const answer =
    unit.answer && unit.text.includes(unit.answer) ? unit.answer.trim() : "";
  if (
    answer &&
    answer.length <= 850 &&
    unit.content_type !== "source_incomplete"
  )
    return {
      text: answer,
      complete: true,
      label: "الجواب المختصر · منقول حرفيًا",
    };
  let source = answer || unit.text.trim();
  // Some official answer bodies contain their own question list. Begin the
  // excerpt at an explicit answer label, while retaining the entire raw unit.
  const marker = source.match(
    /(?:^|\n\n)(?:الجواب|الإجابة|Answer)\s*[:：]\s*/u,
  );
  if (
    marker &&
    marker.index < 600 &&
    /^(?:ما الحكم|السؤال|قائمة أسئلة|Question)/u.test(source)
  )
    source = source.slice(marker.index + marker[0].length);
  // Keep a complete opening paragraph where practical; a long paragraph stays
  // visibly an excerpt, with the full original available beside it.
  const end = source.indexOf("\n\n", 80);
  const text =
    end > 0 && end <= 1200
      ? source.slice(0, end)
      : source.slice(0, Math.min(850, source.length));
  return {
    text,
    complete: false,
    label: "بداية النص · ليست ملخصًا مكتملًا للحكم",
  };
}
export function focusedPreview(unit, question, vocabulary) {
  const fallback = preview(unit);
  if (fallback.complete || !question) return fallback;
  const source =
    unit.answer && unit.text.includes(unit.answer) ? unit.answer : unit.text;
  const wanted = new Set(terms(question, vocabulary));
  if (!wanted.size) return fallback;
  const paragraphs = [...source.matchAll(/[^\n]+(?:\n(?!\n)[^\n]+)*/gu)];
  const requestsEvidence = /(?:ادله|أدلة|دليل|evidence|hadith|proof)/iu.test(
    question,
  );
  let best = null;
  for (const [index, match] of paragraphs.entries()) {
    if (
      match[0].length < 80 ||
      match[0].length > 1600 ||
      match[0].startsWith("•") ||
      (match[0].length < 200 && /[?؟]$/u.test(match[0]))
    )
      continue;
    const tokens = new Set(terms(match[0], vocabulary));
    const previous = paragraphs[index - 1];
    const heading =
      previous &&
      previous[0].length < 160 &&
      !previous[0].startsWith("•") &&
      !/[.。]$/u.test(previous[0])
        ? previous
        : null;
    const headingTerms = heading ? terms(heading[0], vocabulary) : [];
    for (const term of headingTerms) tokens.add(term);
    const hits = [...wanted].filter((term) => tokens.has(term)).length;
    const score =
      hits / wanted.size +
      (0.05 * hits) / Math.sqrt(Math.max(tokens.size, 1)) +
      (requestsEvidence &&
      /(?:رواه|أخرجه|حديث|لقوله|narrated|reported|prophet)/iu.test(match[0])
        ? 0.35
        : 0);
    const start =
      heading && headingTerms.some((term) => wanted.has(term))
        ? heading.index
        : match.index;
    if (hits && (!best || score > best.score))
      best = { index, match, score, start };
  }
  if (!best) return fallback;
  let end = best.match.index + best.match[0].length;
  // Keep adjacent context, rather than guessing every way an exception begins.
  for (let offset = 1; offset <= 2; offset++) {
    const next = paragraphs[best.index + offset];
    if (!next || next.index + next[0].length - best.start > 1600) break;
    end = next.index + next[0].length;
  }
  return {
    text: source.slice(best.start, end),
    complete: false,
    label: "مقتطف ذو صلة · ليس ملخصًا مكتملًا",
  };
}
export function evidence(unit) {
  // Preserve the exact delimiters, wording and references as recorded. This does
  // not assert independent authentication of the verse/hadith transcription.
  const rows = [
    ...unit.text.matchAll(/\{[^{}]{8,1800}\}|«[^«»]{8,1800}»/gu),
  ].map((m) => ({ text: m[0], start: m.index, end: m.index + m[0].length }));
  for (const m of unit.text.matchAll(
    /(?:قال الله|قال تعالى|قوله تعالى|لقوله تعالى|قول النبي|قال النبي|قال رسول الله|قوله صلى|لقوله صلى|قوله ﷺ|لقوله ﷺ)[^()"\n]{0,120}(\([^()]{8,1800}\)|"[^"\n]{8,1800}")/gu,
  )) {
    const start = m.index + m[0].lastIndexOf(m[1]);
    rows.push({ text: m[1], start, end: start + m[1].length });
  }
  return rows
    .sort((a, b) => a.start - b.start)
    .filter((r, i, a) => !i || r.start !== a[i - 1].start)
    .slice(0, 2);
}
export function related(book, rowIndex, count = 3) {
  const u = book.units[rowIndex],
    candidates = [];
  const broad = new Set([
    "رمضان",
    "يوم",
    "ايام",
    "كتاب",
    "باب",
    "احكام",
    "مساله",
    "حالات",
    "سوال",
    "صيام",
  ]);
  const subject = new Set(
    terms(u.title, book.vocabulary).filter((t) => !broad.has(t)),
  );
  for (let i = 0; i < book.units.length; i++) {
    const v = book.units[i];
    if (
      i === rowIndex ||
      v.retrievable === false ||
      !v.question ||
      v.title === u.title
    )
      continue;
    if (!terms(v.title, book.vocabulary).some((t) => subject.has(t))) continue;
    const same =
      u.path.slice(0, -1).join("/") === v.path.slice(0, -1).join("/");
    const a = book.focus.subarray(
        rowIndex * book.dimension,
        (rowIndex + 1) * book.dimension,
      ),
      score = dot(book.focus, i, a, book.dimension);
    if (score > 0.82) candidates.push({ i, score: score + (same ? 0.03 : 0) });
  }
  candidates.sort((a, b) => b.score - a.score);
  const seen = new Set();
  return candidates
    .filter((r) => {
      const t = book.units[r.i].title;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .slice(0, count)
    .map((r) => ({ id: book.units[r.i].id, title: book.units[r.i].title }));
}
