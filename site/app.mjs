import { normalize } from "./core.mjs?v=0.14.2";
import { createLibrary } from "./library-ui.mjs?v=0.14.2";
import { copy } from "./i18n.mjs?v=0.14.2";
import { clarificationChoices } from "./policy.mjs?v=0.14.2";
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
function setBusy(active) {
  busy = active;
  $("search-indicator").hidden = !active;
  $("ask-form").setAttribute("aria-busy", String(active));
  $("status-detail").textContent = "";
  $("retry-search").hidden = true;
  if (active) $("search-metrics").hidden = true;
}
function failed() {
  setBusy(false);
  status(t().error);
  $("retry-search").hidden = false;
  $("submit").disabled = !ready;
}
let page = ["about", "method", "library"].includes(location.hash.slice(1))
  ? location.hash.slice(1)
  : "ask";
const initialLanguage = new URL(location.href).searchParams.get("lang");
if (initialLanguage === "en") language = "en";
function show(section) {
  const destination = ["about", "method", "library"].includes(section)
    ? section
    : "ask";
  page = destination;
  for (const id of [
    "intro",
    "search-panel",
    "starter",
    "release-note",
    "result",
  ])
    $(id).hidden =
      page !== "ask" ||
      (id === "intro" && section === "result") ||
      (["intro", "starter"].includes(id) &&
        $("library-scope").dataset.mode === "private");
  $("about-panel").hidden = page !== "about";
  $("method-panel").hidden = page !== "method";
  $("library-panel").hidden = page !== "library";
  $("library-nav").setAttribute(
    "aria-current",
    page === "library" ? "page" : "false",
  );
  for (const id of ["home", "about", "method"])
    $(id).setAttribute(
      "aria-current",
      (id === "home" ? "ask" : id) === page ? "page" : "false",
    );
  const url = new URL(location.href);
  url.hash = page;
  url.searchParams.set("lang", language);
  history.replaceState(null, "", url);
  document.querySelector("main").hidden = false;
}
window.addEventListener("hashchange", () => show(location.hash.slice(1)));
show(page);
const personalLibrary = createLibrary({
  panel: $("library-panel"),
  scope: $("library-scope"),
  getLanguage: () => language,
  navigate: show,
  selectQuestion: (question) => {
    $("question").value = question;
    ask();
  },
  changed: () => {
    generation++;
    personalLibrary.cancelSearch();
    worker?.terminate();
    worker = undefined;
    $("result").replaceChildren();
    lastQuestion = "";
    if (personalLibrary.active) {
      setBusy(false);
      ready = true;
      $("submit").disabled = false;
      status(t().ready);
      $("search-metrics").hidden = true;
    } else initialize();
  },
});
function open(source, id) {
  if (!ready || busy) return;
  setBusy(true);
  $("submit").disabled = true;
  status(t().searching);
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
function renderAnswer(data) {
  setBusy(false);
  show("result");
  const a = el("section", undefined, "answer");
  a.append(
    el("span", t().yourQuestion, "question-label"),
    el("h2", lastQuestion),
    el("p", data.result.message, "notice"),
  );
  const choices = clarificationChoices(
    data.result.kind,
    lastQuestion,
    language,
  );
  if (choices.length) {
    const controls = el("div", undefined, "choices clarification-choices");
    for (const choice of choices) {
      const button = el("button", choice.label);
      button.type = "button";
      button.onclick = () => {
        $("question").value = choice.question;
        ask();
      };
      controls.append(button);
    }
    a.append(controls);
  }
  if (data.result.level)
    a.append(
      el(
        "small",
        `${t().level}: ${language === "ar" ? { A: "أ", B: "ب", C: "ج", D: "د" }[data.result.level] || data.result.level : data.result.level}`,
      ),
    );
  for (const s of data.result.sources) {
    if (!s.citations?.length && s.kind !== "error") continue;
    const group = el("section", undefined, "source-group");
    group.append(el("h2", s.title));
    if (s.message) group.append(el("p", s.message, "notice"));
    for (const c of s.citations || [])
      group.append(sourceCard(c, data.result.openFull));
    if (s.kind === "error") {
      const b = el("button", t().retry);
      b.onclick = () => ask();
      group.append(b);
    }
    a.append(group);
  }
  const suggestions = data.result.sources.flatMap((s) =>
    (s.suggestions || []).map((item) => ({
      ...item,
      source: s.id,
      sourceTitle: s.title,
    })),
  );
  if (suggestions.length) {
    const related = el("section", undefined, "related suggestions-only");
    related.append(
      el(
        "h2",
        language === "ar"
          ? "مقترحات لمسائل أخرى — ليست إجابة عن سؤالك"
          : "Related cases — not answers to your question",
      ),
    );
    for (const item of suggestions) {
      const button = el("button", `${item.title} — ${item.sourceTitle}`);
      button.type = "button";
      button.onclick = () => open(item.source, item.id);
      related.append(button);
    }
    a.append(related);
  }
  $("result").replaceChildren(a);
  $("submit").disabled = false;
  status(
    data.result.sources.some((source) => source.kind === "error")
      ? t().error
      : t().complete,
  );
  if (data.result.sources.some((s) => s.kind === "error"))
    $("retry-search").hidden = false;
  if (Number.isFinite(data.milliseconds)) {
    const total = (data.milliseconds / 1000).toFixed(2);
    const setup = ((data.preparationMilliseconds || 0) / 1000).toFixed(2);
    $("search-metrics").textContent =
      language === "ar"
        ? `الوقت الكلي: ${total} ث · تجهيز البحث: ${setup} ث${data.modelSetupMilliseconds ? " · شمل تجهيز النموذج أول مرة" : ""}`
        : `Total: ${total} s · Search preparation: ${setup} s${data.modelSetupMilliseconds ? " · Includes first model setup" : ""}`;
    $("search-metrics").dataset.totalMs = data.milliseconds;
    $("search-metrics").dataset.preparationMs =
      data.preparationMilliseconds || 0;
    $("search-metrics").dataset.modelSetupMs = data.modelSetupMilliseconds || 0;
    $("search-metrics").hidden = false;
  }
}
function initialize() {
  if (personalLibrary.active) {
    generation++;
    worker?.terminate();
    worker = undefined;
    ready = true;
    setBusy(false);
    $("submit").disabled = false;
    status(t().ready);
    return;
  }
  const currentGeneration = ++generation;
  const interrupted = busy;
  status(t().loading);
  ready = false;
  setBusy(false);
  $("search-metrics").hidden = true;
  units = [];
  $("submit").disabled = true;
  if (interrupted) {
    worker?.terminate();
    worker = undefined;
  }

  if (!sources().length) {
    status(t().disabled);
    return;
  }
  worker ||= new Worker(
    new URL("./search-worker.mjs?v=0.14.2", import.meta.url),
    {
      type: "module",
    },
  );
  worker.onmessage = ({ data }) => {
    if (currentGeneration !== generation) return;
    if (data.type === "progress") {
      if (busy) $("status-detail").textContent = data.message;
      else status(data.message);
    }
    if (data.type === "ready") {
      ready = true;
      $("submit").disabled = false;
      status(t().ready);
    }

    if (data.type === "answer") {
      const currentPage = page;
      renderAnswer(data);
      if (currentPage !== "ask") show(currentPage);
    }
    if (data.type === "opened") {
      setBusy(false);
      $("submit").disabled = false;
      show("result");
      $("result").replaceChildren(sourceCard(data.citation, true));
      status(t().complete);
    }
    if (data.type === "error") {
      failed();
    }
  };
  worker.onerror = () => {
    if (currentGeneration !== generation) return;
    ready = false;
    worker?.terminate();
    worker = undefined;
    failed();
  };
  worker.postMessage({ type: "init", catalog: sources(), language });
}
function translate() {
  $("library-nav").textContent = language === "ar" ? "مكتبتي" : "My library";
  document.documentElement.lang = language;
  document.documentElement.dir = t().dir;
  document.title =
    language === "ar"
      ? "رَفّ | من السؤال إلى المصدر"
      : "Raff | From question to source";
  for (const n of document.querySelectorAll("[data-i18n]"))
    n.textContent = t()[n.dataset.i18n];
  $("brand-name").textContent = language === "ar" ? "رَفّ" : "Raff";
  document
    .querySelector('[data-i18n="aboutText"]')
    .prepend(
      language === "ar"
        ? "سُمّي رَفّ ليكون مكتبة علمية تنمو مع الباحث: ينشئ رفوفه ويضيف كتبه ويختار نطاق بحثه. تدعم «مكتبتي» الآن الكتب النصية المحفوظة في متصفحك، بفهرسة دلالية مستقلة عن المصادر العامة. "
        : "Raff means a shelf: a research library that grows with you. Create shelves, add books and choose where to search. My library currently indexes text books by meaning locally in your browser, separately from the public sources. ",
    );
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
        ? "لن يتم الإطلاق العام الرسمي لموقع رَفّ إلا بعد الحصول على موافقة رسمية من أصحاب حقوق كتاب «فتاوى إسلامية» ومن القائمين على موقع «الإسلام سؤال وجواب» على استخدام محتواهما ونشره ضمن المنصة. النسخة الحالية متاحة لأغراض المشاركة في المسابقة؛ ويلتزم فريق رَفّ بإيقاف الإتاحة العامة للمحتوى بعد انتهائها، وعدم إعادة إتاحته إلا بعد الحصول على الأذونات اللازمة. تُنسب النصوص إلى مصادرها الأصلية مع روابطها، ولا يُعد عرضها ادعاءً بامتلاك حقوقها أو بالحصول على موافقة لم تصدر بعد."
        : "Raff will not have an official public launch until formal permission has been obtained from the rights holders of Fatawa Islamiyyah and the operators of Islam Question & Answer to use and publish their content within the platform. The current version is available for participation in the competition. The Raff team commits to ending public access to the content after the competition ends and not making it available again until the necessary permissions have been obtained. Texts are attributed to their original sources with links; displaying them does not claim ownership of their rights or permission that has not yet been granted.",
      "notice",
    ),
    el(
      "p",
      language === "ar"
        ? "تُسترجع النصوص من ملفات النسخة المحفوظة، دون جلبها من مواقع المصادر وقت السؤال. البحث يجمع المطابقة اللفظية والبحث بالمعنى. يظهر جواب المصدر كاملًا بنصه وشروطه؛ خلاصة الموقع الأصلية منفصلة وليست تلخيصًا من رَفّ."
        : "Texts are retrieved from this release’s stored files, without querying source websites at answer time. Search combines lexical and semantic retrieval. Complete source answers preserve the original wording and conditions; original website summaries are separate, not generated by Raff.",
    ),
    el(
      "p",
      language === "ar"
        ? "نُشرت النسخة بقرار مسؤول المنصة؛ لم يُثبت ترخيص إعادة نشر شامل. الإتاحة المجانية والحزمة الرسمية لا تثبتان هذا الترخيص. الإسلام سؤال وجواب غير معتمد صراحة في ملفات المسابقة المتاحة؛ يمكن تعطيله بوضع المسابقة."
        : "This preview is published by the platform operator’s decision; a blanket redistribution license has not been established. Free access and official offline packages do not establish such a license. IslamQA is not explicitly approved in the available competition documents and can be disabled in competition mode.",
    ),
  );
  method.append(
    el("h3", language === "ar" ? "التعريف بالمصادر" : "About the sources"),
  );
  const sourceProfiles =
    language === "ar"
      ? [
          {
            title: "كتاب «فتاوى إسلامية»",
            text: "مجموعة فتاوى جمعها ورتّبها محمد بن عبد العزيز المسند. يعرض الموقع الرسمي للشيخ عبد العزيز بن باز الكتاب في أربعة أجزاء. يستخدم رَفّ نسخته النصية ذات المعرّف 1708، ويُبقي كل فتوى منسوبة إلى قائلها مع موضعها في الكتاب؛ فجامع الكتاب ليس بالضرورة صاحب كل فتوى فيه.",
            label: "التعريف بالكتاب في الموقع الرسمي للشيخ ابن باز",
            url: "https://binbaz.org.sa/books/31/فتاوى-اسلامية-جمع-وترتيب-محمد-عبدالعزيز-المسند",
          },
          {
            title: "موقع «الإسلام سؤال وجواب»",
            text: "موقع يقدّم إجابات شرعية ومواد معرفية وتربوية بلغات متعددة. بحسب صفحة التعريف الرسمية، يشرف الشيخ محمد صالح المنجد على إجاباته، ويستند منهجه إلى القرآن والسنة وأقوال أهل العلم. يعرض رَفّ النص المنقول مع رقم الإجابة ورابطها؛ ويستخدم البحث العام الإنجليزي المحتوى الإنجليزي المنشور في الموقع نفسه.",
            label: "صفحة «حول الموقع» الرسمية",
            url: "https://islamqa.info/ar/about-us",
          },
        ]
      : [
          {
            title: "Fatawa Islamiyyah",
            text: "A collection of fatwas compiled and arranged by Muhammad ibn Abd al-Aziz al-Musnad. The official Ibn Baz website lists four parts of the book. Raff uses the text edition identified as 1708 and attributes each fatwa to its original author with its location in the book; the compiler is not necessarily the author of every fatwa.",
            label: "Book listing on the official Ibn Baz website",
            url: "https://binbaz.org.sa/books/31/فتاوى-اسلامية-جمع-وترتيب-محمد-عبدالعزيز-المسند",
          },
          {
            title: "Islam Question & Answer (IslamQA)",
            text: "A multilingual website offering Islamic answers and educational material. Its official introduction names Sheikh Muhammad Salih al-Munajjid as supervisor of its answers and describes a methodology based on the Quran, Sunnah and scholarly writings. Raff retains the original answer number and link. Public English search uses the website’s published English content.",
            label: "Official introduction to IslamQA",
            url: "https://islamqa.info/ar/about-us",
          },
        ];
  for (const profile of sourceProfiles) {
    const card = el("article", undefined, "source-profile");
    const link = el("a", profile.label);
    link.href = profile.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    card.append(el("h4", profile.title), el("p", profile.text), link);
    method.append(card);
  }
  method.append(
    el(
      "p",
      language === "ar"
        ? "التعريف بالمصدر والإحالة إليه لا يعنيان وجود شراكة أو موافقة رسمية على رَفّ، ولا ينقلان ملكية النصوص إلى المشروع."
        : "Describing and linking a source does not imply a partnership or official approval of Raff, and does not transfer ownership of its texts to this project.",
      "notice",
    ),
  );
  method.append(
    el(
      "h3",
      language === "ar"
        ? "مستويات المحتوى وضبط الاستجابة"
        : "Content levels and response rules",
    ),
  );
  const levels =
    language === "ar"
      ? [
          [
            "أ — معلومات أصلية مستقرة",
            "يعرض معلومات وتعريفات مستقرة بإجابة مباشرة موثقة عند كفاية المصدر. لا يُعد النقل تحقيقًا مستقلًا لصحة الحديث.",
          ],
          [
            "ب — شرح وتعريف واستدلال",
            "يعرض المادة ذات الصلة ومرجعها لتوضيح المفهوم أو المسألة، مع حفظ الشروط وتجنب القطع فيما يحتمل الخلاف. النسخة الحالية تنقل جواب المصدر كاملًا ولا تولّد شرحًا فقهيًا مستقلًا.",
          ],
          [
            "ج — مسائل خلافية أو عالية الحساسية",
            "يعرض الأقوال المتاحة منفصلة ومنسوبة إلى مصادرها، دون اختلاق إجماع أو ترجيح مستقل. يبيّن حدود المادة أو يحيل إلى مختص إذا احتاج السؤال تحريرًا علميًا خاصًا.",
          ],
          [
            "د — فتوى أو حالة شخصية",
            "لا يحكم على واقعة فردية أو صحة عقد أو عبادة لشخص بعينه. يحيل إلى جهة مؤهلة، ويمكن للمستخدم إعادة السؤال بصيغة عامة للبحث في النصوص المنشورة.",
          ],
        ]
      : [
          [
            "A — Established factual information",
            "Provides a direct, sourced answer about established information or definitions when the source is sufficient. Quoting a hadith does not independently authenticate it.",
          ],
          [
            "B — Explanation, definition and source-based reasoning",
            "Presents relevant source material and references to clarify a concept or issue, preserving conditions and avoiding certainty where disagreement is possible. This version quotes complete source answers and does not generate independent jurisprudential explanations.",
          ],
          [
            "C — Disputed or highly sensitive issues",
            "Presents available opinions separately with attribution, without inventing consensus or independently preferring an opinion. Explains the limits of the material or refers to a specialist when detailed scholarly analysis is needed.",
          ],
          [
            "D — Fatwa or personal circumstances",
            "Does not rule on an individual case or the validity of a particular person's contract or worship. Refers to a qualified authority; the user can rephrase the question generally to search published texts.",
          ],
        ];
  const levelList = el("dl", undefined, "method-levels");
  for (const [name, description] of levels)
    levelList.append(el("dt", name), el("dd", description));
  method.append(
    levelList,
    el(
      "p",
      language === "ar"
        ? "هذه مستويات للاستجابة وليست درجات ثقة أو اعتماد شرعي. يطلب رَفّ التوضيح عند غموض السؤال، ويصرّح بنقص الدليل بدل إكمال النص من عنده. التصنيف آلي وقد يخطئ."
        : "These are response categories, not confidence scores or scholarly approval. Raff asks for clarification when a question is ambiguous and states when evidence is insufficient instead of inventing missing text. Automated classification can be wrong.",
    ),
  );
  for (const m of sources())
    method.append(
      el(
        "p",
        `${m.title}: ${m.semantic_units} / ${m.units} ${language === "ar" ? "وحدة ذات فهرس دلالي؛ الأعداد لا تعني اعتمادًا علميًا." : "units with semantic vectors; counts do not constitute scholarly validation."}`,
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
async function ask() {
  if (!ready || busy) return;
  lastQuestion = $("question").value.trim();
  if (lastQuestion.length < 2) return;
  setBusy(true);
  $("result").replaceChildren();
  $("submit").disabled = true;
  status(t().searching);
  if (personalLibrary.active) {
    const requestGeneration = generation;
    const started = performance.now();
    try {
      const result = await personalLibrary.search(lastQuestion);
      if (requestGeneration !== generation) return;
      $("result").replaceChildren(result);
      $("search-metrics").textContent =
        language === "ar"
          ? `الوقت الكلي: ${((performance.now() - started) / 1000).toFixed(2)} ث`
          : `Total time: ${((performance.now() - started) / 1000).toFixed(2)} s`;
      $("search-metrics").hidden = false;
      setBusy(false);
      $("submit").disabled = false;
      status(t().complete);
    } catch {
      if (requestGeneration === generation) failed();
    }
    return;
  }
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
$("retry-search").onclick = () => {
  if (ready) ask();
  else if (catalog.length) initialize();
  else location.reload();
};
$("home").onclick = () => show("home");
$("about").onclick = () => show("about");
$("method").onclick = () => show("method");
$("library-nav").onclick = () => show("library");
function changeScope() {
  const currentPage = page;
  personalLibrary.cancelSearch();
  $("result").replaceChildren();

  lastQuestion = "";
  translate();
  personalLibrary.render();
  initialize();
  show(currentPage);
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
  personalLibrary.cancelSearch();
  $("question").value = "";
  $("result").replaceChildren();
  $("search-metrics").hidden = true;
  initialize();
  show("home");
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
  show(page);
} catch {
  failed();
}
