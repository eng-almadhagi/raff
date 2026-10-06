import { normalize } from "./core.mjs";
import { copy } from "./i18n.mjs";
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
};
let worker,
  catalog = [],
  settings = {},
  units = [],
  ready = false,
  busy = false,
  limit = 60,
  lastQuestion = "",
  language = "ar",
  sourceChoice = "all",
  generation = 0;
const t = () => copy[language];
const sources = () =>
  catalog.filter(
    (m) =>
      m.language === language &&
      m.enabled !== false &&
      !settings.disabledSources?.includes(m.id) &&
      !(
        settings.competitionMode &&
        settings.competitionUnconfirmed?.includes(m.id)
      ),
  );
const selected = () =>
  sourceChoice === "all" ? sources().map((m) => m.id) : [sourceChoice];
function status(s) {
  $("status").textContent = s;
}
function show(section) {
  for (const [id, name] of [
    ["library", "library"],
    ["about-panel", "about"],
    ["method-panel", "method"],
    ["intro", "home"],
    ["result", "result"],
  ])
    $(id).hidden = section !== name;
}
function open(source, id) {
  if (!ready || busy) return;
  busy = true;
  $("submit").disabled = true;
  status(t().loading);
  worker.postMessage({ type: "open", source, id });
}
function sourceCard(u, opened = false) {
  const c = t(),
    box = el("article", undefined, "source");
  box.append(el("h3", u.title), el("p", (u.path || []).join(" ← "), "path"));
  if (u.content_type === "source_incomplete")
    box.append(el("p", c.incomplete, "caution"));
  if (u.question) {
    const context = el("details");
    context.open = u.question.length < 650;
    context.append(
      el(
        "summary",
        language === "ar"
          ? "السؤال في المصدر وسياقه"
          : "The source question and its context",
      ),
      el("p", u.question, "source-question"),
    );
    box.append(context);
  }
  box.append(
    el(
      "span",
      u.preview.label === "site-summary"
        ? c.siteSummary
        : u.preview.label === "full-answer"
          ? c.completeAnswer
          : u.preview.complete
            ? c.short
            : c.excerpt,
      "badge",
    ),
    el(
      "p",
      u.preview.text,
      "excerpt" + (u.preview.label === "full-answer" ? " complete-answer" : ""),
    ),
  );
  if (u.preview.label === "full-answer") {
    const quote = box.querySelector(".complete-answer");
    quote.tabIndex = 0;
    quote.setAttribute("role", "region");
    quote.setAttribute("aria-label", c.completeAnswer);
    box.append(el("p", c.readingNote, "notice"));
  }
  if (!u.preview.complete) box.append(el("p", c.caution, "caution"));
  if (u.evidence?.length) {
    const e = el("section", undefined, "evidence");
    e.append(el("h4", c.evidence));
    for (const item of u.evidence) e.append(el("blockquote", item.text));
    e.append(el("small", c.evidenceNote));
    box.append(e);
  }
  box.append(
    el(
      "p",
      `${c.source}: ${catalog.find((b) => b.id === u.book_id)?.title || u.book_id}`,
      "reference",
    ),
  );
  if (u.reference)
    box.append(el("p", `${c.reference}: ${u.reference}`, "reference"));
  if (u.mufti) box.append(el("p", u.mufti, "reference"));
  for (const [key, label] of [
    ["published_at", c.published],
    ["updated_at", c.updated],
  ]) {
    const date = u[key];
    if (date && /^\d{4}-/u.test(date) && Number(date.slice(0, 4)) >= 1997)
      box.append(el("p", `${label}: ${date.slice(0, 10)}`, "reference"));
  }
  if (u.source_refs?.length)
    box.append(
      el(
        "p",
        u.source_refs
          .map(
            (r) =>
              `${c.part} ${r.part ?? "—"} · ${c.page} ${r.page_num ?? "—"}`,
          )
          .join(" / "),
        "reference",
      ),
    );
  const original = el("details");
  original.open = opened;
  if (u.site_summary && u.preview.label !== "site-summary") {
    const summary = el("details");
    summary.append(el("summary", c.siteSummary), el("p", u.site_summary));
    box.append(summary);
  }
  original.append(
    el("summary", c.full),
    el("h4", c.original),
    el("blockquote", u.text),
  );
  for (const f of u.footnotes || []) original.append(el("p", f.text));
  try {
    const url = new URL(u.url);
    if (
      url.protocol === "https:" &&
      ["app.turath.io", "turath.io", "albahith.com", "islamqa.info"].includes(
        url.hostname,
      )
    ) {
      const a = el("a", c.link);
      a.href = url.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      original.append(a);
    }
  } catch {}
  box.append(original);
  if (u.related?.length) {
    const more = el("section", undefined, "related");
    more.append(el("h4", c.related));
    for (const r of u.related) {
      const b = el("button", r.title);
      b.type = "button";
      b.onclick = () => open(u.book_id, r.id);
      more.append(b);
    }
    box.append(more);
  }
  return box;
}
function renderEntries() {
  const q = normalize($("filter").value),
    found = units.filter((u) =>
      normalize(u.title + " " + u.path.join(" ")).includes(q),
    );
  $("entries").replaceChildren();
  for (const u of found.slice(0, limit)) {
    const b = el("button", u.title);
    b.append(el("small", u.sourceTitle));
    b.onclick = () => open(u.source, u.id);
    $("entries").append(b);
  }
  $("more").hidden = limit >= found.length;
  $("counts").textContent = `${found.length} ${t().locations}`;
}
function renderAnswer(data) {
  busy = false;
  show("result");
  const a = el("section", undefined, "answer");
  a.append(
    el("span", t().yourQuestion, "question-label"),
    el("h2", lastQuestion),
    el("p", data.result.message, "notice"),
  );
  if (data.result.level)
    a.append(el("small", `${t().level}: ${data.result.level}`));
  for (const s of data.result.sources) {
    const group = el("section", undefined, "source-group");
    group.append(el("h2", s.title));
    if (s.message) group.append(el("p", s.message, "notice"));
    for (const c of s.citations || [])
      group.append(sourceCard(c, data.result.openFull));
    for (const suggestion of s.suggestions || []) {
      const b = el("button", suggestion);
      b.onclick = () => {
        $("question").value = suggestion;
        $("question").focus();
      };
      group.append(b);
    }
    if (s.kind === "error") {
      const b = el("button", t().retry);
      b.onclick = () => ask();
      group.append(b);
    }
    a.append(group);
  }
  $("result").replaceChildren(a);
  $("submit").disabled = false;
  status(
    data.result.sources.some((source) => source.kind === "error")
      ? t().error
      : t().complete,
  );
}
function initialize() {
  const currentGeneration = ++generation;
  status(t().loading);
  ready = false;
  busy = false;
  units = [];
  $("submit").disabled = true;
  worker?.terminate();
  $("browse").disabled = sources().length === 0;
  if (!sources().length) {
    status(t().disabled);
    return;
  }
  worker = new Worker(new URL("./search-worker.mjs", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({ data }) => {
    if (currentGeneration !== generation) return;
    if (data.type === "progress") status(data.message);
    if (data.type === "ready") {
      ready = true;
      $("submit").disabled = false;
      status(t().ready);
    }
    if (data.type === "catalog") {
      units = data.units;
      renderEntries();
    }
    if (data.type === "answer") renderAnswer(data);
    if (data.type === "opened") {
      busy = false;
      $("submit").disabled = false;
      show("result");
      $("result").replaceChildren(sourceCard(data.citation, true));
      status(t().complete);
    }
    if (data.type === "error") {
      busy = false;
      status(t().error);
      $("submit").disabled = !ready;
    }
  };
  worker.onerror = () => {
    if (currentGeneration !== generation) return;
    busy = false;
    status(t().error);
    $("submit").disabled = !ready;
  };
  worker.postMessage({ type: "init", catalog: sources(), language });
}
function translate() {
  document.documentElement.lang = language;
  document.documentElement.dir = t().dir;
  document.title =
    language === "ar"
      ? "رَفّ | من السؤال إلى المصدر"
      : "Raff | From question to source";
  for (const n of document.querySelectorAll("[data-i18n]"))
    n.textContent = t()[n.dataset.i18n];
  $("brand-name").textContent = language === "ar" ? "رَفّ" : "Raff";
  $("question").placeholder = t().placeholder;
  $("release-note").textContent = t().disclosure;
  for (const b of $("language").querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.language === language));
  $("theme").setAttribute(
    "aria-label",
    language === "ar"
      ? "تبديل المظهر الداكن والفاتح"
      : "Toggle dark and light theme",
  );
  $("book").replaceChildren();
  const choices =
    language === "ar"
      ? [{ id: "all", title: "جميع المصادر" }, ...sources()]
      : sources().map((m) => ({ ...m, title: "IslamQA — English" }));
  for (const m of choices) {
    const b = el("button", m.title);
    b.type = "button";
    b.dataset.source = m.id;
    b.setAttribute(
      "aria-pressed",
      String(language === "en" || sourceChoice === m.id),
    );
    b.onclick = () => {
      if (sourceChoice === m.id || language === "en") return;
      sourceChoice = m.id;
      changeScope();
    };
    $("book").append(b);
  }
  $("facts").textContent = sources()
    .map((m) => `${m.title}: ${m.units.toLocaleString(language)}`)
    .join(" · ");
  $("starter").replaceChildren();
  for (const q of language === "ar"
    ? ["سجود السهو قبل السلام وبعده", "ما حكم بخاخ الربو للصائم؟"]
    : ["Does an asthma inhaler break the fast?", "IslamQA 11789"]) {
    const b = el("button", q);
    b.onclick = () => {
      $("question").value = q;
      $("question").focus();
    };
    $("starter").append(b);
  }
  const method = $("method-content");
  method.replaceChildren(
    el(
      "p",
      language === "ar"
        ? "تُسترجع النصوص من ملفات النسخة المحفوظة، دون جلبها من مواقع المصادر وقت السؤال. البحث يجمع المطابقة اللفظية والبحث بالمعنى. المقتطفات نقل حرفي وليست تلخيصًا توليديًا."
        : "Texts are retrieved from this release’s stored files, without querying source websites at answer time. Search combines lexical and semantic retrieval. Excerpts are verbatim, not generated summaries.",
    ),
    el(
      "p",
      language === "ar"
        ? "حقوق النشر العام لم تُحسم. الإتاحة المجانية والحزمة الرسمية لا تثبتان إذن إعادة النشر. الإسلام سؤال وجواب غير معتمد صراحة في ملفات المسابقة المتاحة؛ يمكن تعطيله بوضع المسابقة."
        : "Public redistribution rights remain unresolved. Free access and official offline packages do not establish redistribution permission. IslamQA is not explicitly approved in the available competition documents and can be disabled in competition mode.",
    ),
  );
  for (const m of sources())
    method.append(
      el(
        "p",
        `${m.title}: ${m.units} / ${m.semantic_units} ${language === "ar" ? "وحدة ذات فهرس دلالي؛ الأعداد لا تعني اعتمادًا علميًا." : "units with semantic vectors; counts do not constitute scholarly validation."}`,
      ),
    );
  method.append(
    el(
      "p",
      language === "ar"
        ? "قد يسترجع البحث مسألة قريبة بدل المسألة المطلوبة، أو يطلب توضيحًا زائدًا. طابق السؤال الأصلي واقرأ الفتوى كاملة؛ المقتطف لا يضمن جمع جميع الشروط. لا يوجد تلخيص توليدي أو تطبيق للحكم على حالتك. التحميل الأول لنموذج البحث نحو 136 MB قبل أصول التشغيل، ولم يُعتمد أداء جهاز جوال فعلي بعد."
        : "Search may retrieve a related issue instead of the requested one, or ask for unnecessary clarification. Compare the original question and read the full answer; an excerpt cannot guarantee all conditions are included. There is no generated summary or application of a ruling to your circumstances. The initial search model download is about 136 MB before runtime assets; physical mobile-device performance has not been validated.",
    ),
    el(
      "p",
      language === "ar"
        ? "فتاوى إسلامية: 1816 سجلًا، 3037 وحدة، منها 6 مواضع ناقصة مستبعدة من الإجابة. حزم الإسلام سؤال وجواب: أساس 4 أكتوبر 2026 وتحديث 5 أكتوبر 2026؛ لا ندعي تغطية كل ما ينشره الموقع بعد ذلك."
        : "Fatawa Islamiyyah: 1,816 records and 3,037 units, including six incomplete passages excluded from answers. IslamQA packages: October 4, 2026 base and October 5 update; later website publications are not claimed as covered.",
    ),
  );
}
function ask() {
  if (!ready || busy) return;
  lastQuestion = $("question").value.trim();
  if (lastQuestion.length < 2) return;
  busy = true;
  $("submit").disabled = true;
  status(t().searching);
  worker.postMessage({
    type: "ask",
    question: lastQuestion,
    sourceIds: selected(),
  });
}
$("ask-form").onsubmit = (e) => {
  e.preventDefault();
  ask();
};
$("home").onclick = () => show("home");
$("about").onclick = () => show("about");
$("method").onclick = () => show("method");
$("browse").onclick = () => {
  show("library");
  status(t().loading);
  worker.postMessage({ type: "browse", sourceIds: selected() });
};
function changeScope() {
  $("result").replaceChildren();
  $("entries").replaceChildren();
  lastQuestion = "";
  translate();
  initialize();
  show("home");
}
for (const b of $("language").querySelectorAll("button"))
  b.onclick = () => {
    if (language === b.dataset.language) return;
    language = b.dataset.language;
    sourceChoice = "all";
    changeScope();
  };
try {
  const savedTheme = localStorage.getItem("raff-theme");
  if (["light", "dark"].includes(savedTheme))
    document.documentElement.dataset.theme = savedTheme;
} catch {
  /* Storage is optional. */
}
$("theme").onclick = () => {
  const dark = document.documentElement.dataset.theme
    ? document.documentElement.dataset.theme === "dark"
    : matchMedia("(prefers-color-scheme: dark)").matches;
  const theme = dark ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem("raff-theme", theme);
  } catch {
    /* Optional preference. */
  }
};
$("reset").onclick = () => {
  $("question").value = "";
  initialize();
  show("home");
};
$("filter").oninput = () => {
  limit = 60;
  renderEntries();
};
$("more").onclick = () => {
  limit += 60;
  renderEntries();
};
try {
  const responses = await Promise.all([
    fetch("./catalog.json"),
    fetch("./settings.json"),
  ]);
  if (responses.some((r) => !r.ok)) throw Error();
  [catalog, settings] = await Promise.all(responses.map((r) => r.json()));
  translate();
  initialize();
  show("home");
} catch {
  status(t().error);
}
