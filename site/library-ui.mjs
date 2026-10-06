import { libraryDB } from "./library-store.mjs?v=0.15.1";
import {
  classifyLibraryPolicy,
  policyMessages,
  clarificationChoices,
} from "./policy.mjs?v=0.15.1";

export function createLibrary({
  panel,
  scope,
  changed,
  navigate,
  getLanguage,
  selectQuestion,
}) {
  let shelves = [],
    books = [],
    mode = false,
    scopeType = "all",
    chosen = new Set(),
    available = false,
    importing = false;
  try {
    const saved = JSON.parse(
      localStorage.getItem("raff-library-scope") || "null",
    );
    if (
      saved &&
      ["all", "book", "shelf", "shelves"].includes(saved.scopeType) &&
      Array.isArray(saved.chosen)
    ) {
      mode = saved.mode === true;
      scopeType = saved.scopeType;
      chosen = new Set(saved.chosen.filter((id) => typeof id === "string"));
    }
  } catch {
    /* Optional preference; books remain in IndexedDB. */
  }
  let worker;
  const pending = new Map();
  function resetWorker() {
    worker?.terminate();
    worker = new Worker(
      new URL("./library-worker.mjs?v=0.15.1", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.progress) {
        clearTimeout(job.timer);
        job.timer = setTimeout(job.timeout, 120000);
        const p = data.progress;
        document.getElementById("status-detail").textContent =
          p.stage === "model"
            ? tr(
                "جارٍ تجهيز نموذج البحث بالمعنى؛ التحميل الأول نحو 136 MB. يبقى الملف على جهازك.",
                "Preparing the semantic model; first download is about 136 MB. Your document stays on your device.",
              )
            : p.stage === "index"
              ? tr(
                  `فهرسة «${p.title}» بالمعنى: ${p.done} من ${p.total}. يُحفظ التقدم لاستكماله لاحقًا.`,
                  `Semantic indexing of “${p.title}”: ${p.done} of ${p.total}. Progress is saved for resuming.`,
                )
              : tr(
                  "جارٍ مطابقة السؤال مع المقاطع المفهرسة…",
                  "Matching your question against indexed passages…",
                );
        return;
      }
      pending.delete(data.id);
      clearTimeout(job.timer);
      data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
    };
    worker.onerror = () => {
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.reject(Error("worker"));
      }
      pending.clear();
      worker.terminate();
      worker = undefined;
    };
  }
  const run = (data) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      if (!worker) resetWorker();
      const timeout = () => {
        for (const job of pending.values()) {
          clearTimeout(job.timer);
          job.reject(Error("document-timeout"));
        }
        pending.clear();
        worker.terminate();
        worker = undefined;
      };
      const timer = setTimeout(timeout, 120000);
      pending.set(id, { resolve, reject, timer, timeout });
      worker.postMessage({ ...data, id });
    });
  const tr = (ar, en) => (getLanguage() === "ar" ? ar : en);
  const node = (tag, text, cls) => {
    const n = document.createElement(tag);
    if (text) n.textContent = text;
    if (cls) n.className = cls;
    return n;
  };
  const button = (text, fn) => {
    const b = node("button", text);
    b.type = "button";
    b.onclick = fn;
    return b;
  };
  const input = (form, label, type = "text") => {
    const wrap = node("label", label),
      field = node("input");
    field.type = type;
    wrap.append(field);
    form.append(wrap);
    return field;
  };
  const errorText = () =>
    tr(
      "تعذر الحفظ أو الفهرسة. تحقق من صيغة الملف وحجمه وإتاحة تخزين المتصفح ثم أعد المحاولة.",
      "Could not save or index. Check file format, size and browser storage, then retry.",
    );
  const extractionNote = (book) => {
    if (!book.extraction) return "";
    const skipped = book.extraction.pagesWithoutText;
    return (
      tr(
        "نص مستخرج آليًا؛ راجع مطابقته وترتيبه في الأصل. الصور لا تُفهرس.",
        "Automatically extracted text; check wording and reading order against the original. Images are not indexed.",
      ) +
      (skipped.length
        ? tr(
            ` صفحات لم يُستخرج منها نص: ${skipped.join("، ")}.`,
            ` Pages without extractable text: ${skipped.join(", ")}.`,
          )
        : "")
    );
  };
  async function refresh() {
    [shelves, books] = await Promise.all([
      libraryDB("getAll", "shelves"),
      libraryDB("getAll", "books"),
    ]);
    available = true;
    render();
  }
  function scopeIds() {
    return books
      .filter(
        (b) =>
          b.language === getLanguage() &&
          (scopeType === "all" ||
            (scopeType === "book" ? chosen.has(b.id) : chosen.has(b.shelfId))),
      )
      .map((b) => b.id);
  }
  function renderScope() {
    try {
      localStorage.setItem(
        "raff-library-scope",
        JSON.stringify({ mode, scopeType, chosen: [...chosen] }),
      );
    } catch {
      /* Optional preference. */
    }
    scope.replaceChildren();
    scope.dataset.mode = mode ? "private" : "public";
    document.getElementById("submit").textContent = mode
      ? tr("ابحث في مكتبتي ←", "Search my library →")
      : tr("ابحث بالمعنى ←", "Search by meaning →");
    for (const id of ["intro", "starter"])
      document.getElementById(id).hidden = mode || location.hash !== "#ask";
    const switches = node("div", "", "choices");
    for (const [value, label] of [
      [false, tr("مصادر رَفّ العامة", "Raff public sources")],
      [true, tr("مكتبتي الخاصة", "My private library")],
    ]) {
      const b = button(label, () => {
        mode = value;
        changed();
        renderScope();
      });
      b.setAttribute("aria-pressed", String(mode === value));
      switches.append(b);
    }
    scope.append(switches);
    document.getElementById("book").hidden = mode;
    document.getElementById("scope-label").hidden = mode;
    if (!mode) return;
    scope.append(
      node(
        "p",
        tr(
          "بحث داخل كتبك المحددة فقط: مطابقة نصية سريعة، ثم ترتيب بالمعنى للمقاطع المرشحة عند الحاجة. لا ينتظر السؤال فهرسة الكتاب كله بالنموذج.",
          "Search only your selected books: fast text matching, then semantic ranking of candidate passages when needed. Queries no longer wait for neural indexing of the entire book.",
        ),
        "notice",
      ),
    );
    const types = node("div", "", "choices");
    for (const [value, label] of [
      ["all", tr("كل مكتبتي", "All my books")],
      ["book", tr("كتاب واحد", "One book")],
      ["shelf", tr("رف واحد", "One shelf")],
      ["shelves", tr("عدة رفوف", "Several shelves")],
    ]) {
      const b = button(label, () => {
        scopeType = value;
        chosen.clear();
        changed();
        renderScope();
      });
      b.setAttribute("aria-pressed", String(scopeType === value));
      types.append(b);
    }
    scope.append(types);
    const items =
      scopeType === "book"
        ? books.filter((b) => b.language === getLanguage())
        : shelves;
    if (scopeType !== "all") {
      const choices = node("div", "", "choices");
      for (const item of items) {
        const b = button(item.title, () => {
          if (scopeType !== "shelves") chosen.clear();
          chosen.has(item.id) ? chosen.delete(item.id) : chosen.add(item.id);
          changed();
          renderScope();
        });
        b.setAttribute("aria-pressed", String(chosen.has(item.id)));
        choices.append(b);
      }
      scope.append(choices);
    }
    scope.append(
      node(
        "p",
        tr(
          `النطاق الحالي: ${scopeIds().length} كتابًا باللغة المختارة.`,
          `Current scope: ${scopeIds().length} books in the selected language.`,
        ),
      ),
      button(
        tr("إدارة مكتبتي وإضافة كتاب", "Manage library and add a book"),
        () => navigate("library"),
      ),
    );
  }
  function render() {
    renderScope();
    panel.replaceChildren(
      node("h2", tr("مكتبتي — رفوف الباحث", "My library — Research shelves")),
      node(
        "p",
        tr(
          "رَفّ مكتبتك العلمية القابلة للنمو: أنشئ رفوفًا، وأضف كتبك، ثم ابحث داخل المصادر التي تختارها.",
          "Raff is your growing research library: create shelves, add books, and search the sources you choose.",
        ),
      ),
      node(
        "p",
        tr(
          "تُحفظ الكتب والفهارس في هذا المتصفح على هذا الجهاز، ولا تُرفع إلى GitHub أو خادم. ليست حسابًا متزامنًا؛ قد يحذفها مسح بيانات المتصفح أو انتهاء الجلسة الخاصة. احتفظ بملفاتك الأصلية واستخدم تنزيل نسخة الكتاب.",
          "Books and indexes stay in this browser on this device; they are not uploaded to GitHub or a server. This is not a synced account. Clearing browser data or ending a private session can remove them. Keep your originals and download book copies.",
        ),
        "notice",
      ),
    );
    const message = node("p");
    message.setAttribute("role", "status");
    panel.append(message);
    if (!available) {
      message.textContent = errorText();
      return;
    }
    const shelfForm = node("form", "", "library-form");
    const shelfName = input(shelfForm, tr("اسم الرف الجديد", "New shelf name"));
    shelfName.required = true;
    shelfName.maxLength = 100;
    const create = node("button", tr("+ إنشاء رف", "+ Create shelf"));
    create.type = "submit";
    shelfForm.append(create);
    shelfForm.onsubmit = async (e) => {
      e.preventDefault();
      if (!shelfName.value.trim()) return;
      create.disabled = true;
      try {
        await libraryDB("put", "shelves", {
          id: crypto.randomUUID(),
          title: shelfName.value.trim(),
        });
        await refresh();
        changed();
      } catch {
        message.textContent = errorText();
        create.disabled = false;
      }
    };
    panel.append(shelfForm);
    const form = node("form", "", "library-form");
    form.append(
      node("h3", tr("+ إضافة كتاب وفهرسته", "+ Add and index a book")),
    );
    const title = input(form, tr("عنوان الكتاب", "Book title"));
    title.required = true;
    title.maxLength = 200;
    const author = input(form, tr("المؤلف / المصدر", "Author / source"));
    author.maxLength = 200;
    const targetLabel = node("label", tr("الرف", "Shelf")),
      target = node("select");
    target.required = true;
    for (const s of shelves) {
      const o = node("option", s.title);
      o.value = s.id;
      target.append(o);
    }
    targetLabel.append(target);
    form.append(targetLabel);
    const langLabel = node("label", tr("لغة الكتاب", "Book language")),
      lang = node("select");
    for (const [value, label] of [
      ["ar", "العربية"],
      ["en", "English"],
    ]) {
      const o = node("option", label);
      o.value = value;
      lang.append(o);
    }
    lang.value = getLanguage();
    langLabel.append(lang);
    form.append(langLabel);
    const file = input(
      form,
      tr(
        "ملف الكتاب: PDF أو Word DOCX نصّي (حتى 20 MB)، أو TXT / MD / JSON (حتى 5 MB)",
        "Book file: text PDF or Word DOCX (up to 20 MB), or TXT / MD / JSON (up to 5 MB)",
      ),
      "file",
    );
    file.accept = ".txt,.md,.json,.pdf,.docx,.doc";
    file.required = true;
    form.append(
      node(
        "p",
        tr(
          "يُستخرج النص داخل جهازك دون رفع الملف. PDF: المرجع ترتيب الصفحة في الملف، وقد يختلف عن الرقم المطبوع. Word DOCX: المرجع رقم الفقرة؛ الصور لا تتحول إلى نص. ملفات DOC القديمة يجب حفظها بصيغة DOCX. راجع ترتيب النص المستخرج، خاصة الأعمدة والحواشي؛ لا يوجد OCR. TXT وMD يستخدمان رقم الفقرة، وJSON يحفظ المرجع المرفق بالنص.",
          "Text is extracted on your device without uploading the file. PDF references use file page order, which may differ from printed numbers. Word DOCX uses paragraph numbers; images are not converted to text. Save old DOC files as DOCX first. Review extraction order, especially columns and footnotes; there is no OCR. TXT and MD use paragraph locations; JSON retains supplied references.",
        ),
      ),
    );
    const submit = node("button", tr("استيراد وفهرسة", "Import and index"));
    submit.type = "submit";
    submit.disabled = !shelves.length || importing;
    form.append(submit);
    if (!shelves.length)
      form.append(node("p", tr("أنشئ رفًا أولًا.", "Create a shelf first.")));
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (importing) return;
      const selected = file.files[0];
      if (selected && /\.doc$/i.test(selected.name)) {
        message.textContent = tr(
          "ملف Word قديم بصيغة DOC. افتحه في Word واختر «حفظ باسم» ثم DOCX، وأضفه مجددًا.",
          "This is an old DOC file. Open it in Word, choose Save As DOCX, and import it again.",
        );
        return;
      }
      const binary = selected && /\.(pdf|docx)$/i.test(selected.name);
      if (!selected || selected.size > (binary ? 20_000_000 : 5_000_000)) {
        message.textContent = errorText();
        return;
      }
      importing = true;
      submit.disabled = true;
      message.textContent = tr(
        "جارٍ التحقق والفهرسة…",
        "Validating and indexing…",
      );
      try {
        const book = await run({
          type: "import",
          payload: {
            ...(binary
              ? { buffer: await selected.arrayBuffer() }
              : { content: await selected.text() }),
            filename: selected.name,
            title: title.value,
            author: author.value,
            language: lang.value,
            shelfId: target.value,
          },
        });
        // Only validated, completely indexed books are committed and made searchable.
        await libraryDB("put", "books", book);
        mode = true;
        scopeType = "book";
        chosen = new Set([book.id]);
        await refresh();
        changed();
        panel.querySelector("[role=status]").textContent = tr(
          `حُفظ ${book.units.length} موضعًا، واختير الكتاب نطاقًا للبحث. اضغط «الانتقال للبحث في مكتبتي». يمكنك معاينة النص المستخرج أسفل بطاقة الكتاب. اختر لغة الكتاب نفسها عند البحث.`,
          `${book.units.length} passages saved; this book is now the search scope. Click “Search my library”. You can inspect the extracted text in its book card. Select the book’s language when searching.`,
        );
      } catch (error) {
        const messages = {
          "document-no-text": tr(
            "لم نجد نصًا كافيًا قابلًا للاستخراج؛ قد يكون الملف صورًا أو مسحًا ضوئيًا. لم تتم إضافته. يلزم ملف نصّي أو OCR خارج الموقع.",
            "No sufficient extractable text was found. This may be a scan or image-only file. It was not added. Use a text document or external OCR.",
          ),
          "document-password": tr(
            "الملف محمي بكلمة مرور. أضف نسخة نصية غير محمية تملك صلاحية استخدامها.",
            "The PDF is password protected. Import an unprotected text copy you are authorized to use.",
          ),
          "document-limit": tr(
            "تجاوز الملف حدود المعالجة: 20 MB للملف، و2000 صفحة PDF، و5 ملايين محرف للنص المستخرج. قسّمه إلى أجزاء أصغر.",
            "The document exceeds processing limits: 20 MB per file, 2,000 PDF pages, and 5 million extracted characters. Split it into smaller parts.",
          ),
          "document-timeout": tr(
            "استغرقت المعالجة وقتًا طويلًا. لم يُحفظ الملف؛ جرّب جزءًا أصغر أو أعد المحاولة.",
            "Processing timed out. The file was not saved; try a smaller part or retry.",
          ),
          "document-invalid": tr(
            "تعذر قراءة الملف. قد يكون تالفًا أو مشفرًا أو لا يطابق صيغته. أعد حفظه من برنامجه الأصلي ثم حاول مجددًا.",
            "The file could not be read. It may be damaged, encrypted or incorrectly named. Save it again using its original application, then retry.",
          ),
        };
        message.textContent = messages[error.message] || errorText();
      } finally {
        importing = false;
        const b = panel.querySelector(
          ".library-form + .library-form button[type=submit]",
        );
        if (b) b.disabled = !shelves.length;
      }
    };
    panel.append(form);
    for (const shelf of shelves) {
      const card = node("section", "", "card");
      card.append(node("h3", shelf.title));
      const own = books.filter((b) => b.shelfId === shelf.id);
      card.append(node("p", tr(`${own.length} كتب`, `${own.length} books`)));
      const rename = node("form", "", "library-form"),
        name = input(rename, tr("تعديل اسم الرف", "Rename shelf"));
      name.value = shelf.title;
      name.maxLength = 100;
      name.required = true;
      const save = node("button", tr("حفظ الاسم", "Save name"));
      save.type = "submit";
      rename.append(save);
      rename.onsubmit = async (e) => {
        e.preventDefault();
        if (!name.value.trim()) return;
        try {
          await libraryDB("put", "shelves", {
            ...shelf,
            title: name.value.trim(),
          });
          await refresh();
        } catch {
          message.textContent = errorText();
        }
      };
      card.append(rename);
      for (const book of own) {
        const row = node("article", "", "library-book");
        const preview = node("details");
        preview.append(
          node(
            "summary",
            tr(
              "معاينة النص المحفوظ والفهرسة",
              "Inspect saved text and indexing",
            ),
          ),
          node(
            "p",
            tr(
              `اللغة: ${book.language} · ${book.units.length} موضعًا محفوظًا.`,
              `Language: ${book.language} · ${book.units.length} saved passages.`,
            ),
          ),
        );
        for (const unit of book.units.slice(0, 3))
          preview.append(
            node("h5", unit.reference),
            node("p", unit.text.slice(0, 1500), "excerpt"),
          );
        row.append(preview);
        if (book.extraction)
          row.append(node("p", extractionNote(book), "notice"));
        row.append(
          node("h4", book.title),
          node(
            "p",
            `${book.author} · ${book.language} · ${book.units.length} ${tr("موضع مفهرس", "indexed passages")}`,
          ),
        );
        const moveLabel = node("label", tr("نقل إلى رف", "Move to shelf")),
          move = node("select");
        for (const s of shelves) {
          const o = node("option", s.title);
          o.value = s.id;
          move.append(o);
        }
        move.value = book.shelfId;
        move.onchange = async () => {
          try {
            await libraryDB("put", "books", { ...book, shelfId: move.value });
            await refresh();
            changed();
          } catch {
            message.textContent = errorText();
          }
        };
        moveLabel.append(move);
        row.append(moveLabel);
        row.append(
          button(tr("تنزيل نسخة الكتاب", "Download book copy"), () => {
            const data = {
              title: book.title,
              author: book.author,
              language: book.language,
              sections: book.units.map(({ text, reference, heading }) => ({
                text,
                reference,
                heading,
              })),
            };
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(data, null, 2)], {
                type: "application/json",
              }),
            );
            const a = node("a");
            a.href = url;
            a.download = `${book.id}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }),
        );
        card.append(row);
      }
      panel.append(card);
    }
    panel.append(
      button(tr("الانتقال للبحث في مكتبتي", "Search my library"), () => {
        mode = true;
        changed();
        renderScope();
        navigate("ask");
      }),
    );
  }
  async function search(question) {
    const result = node("div");
    if (!available) {
      result.append(node("p", errorText()));
      return result;
    }
    const policy = classifyLibraryPolicy(question, getLanguage());
    if (!["explain", "information", "qualified"].includes(policy)) {
      result.append(
        node(
          "p",
          policyMessages[getLanguage()][policy] ||
            policyMessages[getLanguage()].context,
        ),
      );
      const controls = node("div", "", "choices clarification-choices");
      for (const choice of clarificationChoices(
        policy,
        question,
        getLanguage(),
      ))
        controls.append(
          button(choice.label, () => selectQuestion(choice.question)),
        );
      result.append(controls);
      return result;
    }
    const ids = scopeIds();
    if (!ids.length) {
      result.append(
        node(
          "p",
          tr(
            "اختر كتابًا أو رفًا يحتوي كتبًا باللغة المختارة.",
            "Select a book or shelf containing books in this language.",
          ),
        ),
      );
      return result;
    }
    const hits = await run({
      type: "search",
      books: books.filter((book) => ids.includes(book.id)),
      question,
      scope: { language: getLanguage(), bookIds: ids },
    });
    if (hits.searchInfo)
      result.append(
        node(
          "p",
          hits.searchInfo.mode === "lexical"
            ? tr(
                "استُرجع النص بمطابقة مباشرة دون تحميل نموذج الذكاء الاصطناعي.",
                "Direct text match; no AI model download was needed.",
              )
            : tr(
                `فُحص النص كاملًا بالكلمات، ورُتّب ${hits.searchInfo.examined} من ${hits.searchInfo.total} مقطعًا بالمعنى. قد تفوت صياغات لا تشترك مع المصدر في الكلمات.`,
                `All text was scanned lexically; ${hits.searchInfo.examined} of ${hits.searchInfo.total} passages were ranked semantically. Wording without shared source terms may be missed.`,
              ),
          "notice",
        ),
      );
    result.append(
      node(
        "h2",
        tr("مواضع مطابقة في مكتبتي", "Matching passages in my library"),
      ),
      node(
        "p",
        tr(
          "هذه نصوص مسترجعة من نطاقك المحدد. تُعرض المواضع الأصلية كاملة لحفظ السياق؛ راجع كفايتها للسؤال. لا يُولّد رَفّ فتوى من الكتب المضافة.",
          "These passages were retrieved from your selected scope. Complete original passages preserve context; check whether they answer your question. Raff does not generate a fatwa from imported books.",
        ),
        "notice",
      ),
    );
    if (!hits.length)
      result.append(
        node(
          "p",
          tr(
            "لم نعثر على مقطع وثيق الصلة بالسؤال. تحقق من اختيار الكتاب ولغته ومن النص المستخرج، أو حدّد موضوع السؤال أكثر. لا نملأ النقص من خارج النطاق.",
            "No sufficiently relevant passage was found. Check the selected book, its language and extracted text, or make the topic more specific. Nothing is filled in from outside the selected scope.",
          ),
        ),
      );
    for (const hit of hits) {
      const card = node("article", "", "source");
      const book = books.find((b) => b.id === hit.bookId);
      if (book.extraction)
        card.append(node("p", extractionNote(book), "notice"));
      card.append(
        node("h3", hit.title),
        node("p", `${hit.author} · ${hit.reference} · ${hit.heading}`),
        node(
          "span",
          tr("نص أصلي — فقرة كاملة", "Original text — complete passage"),
          "badge",
        ),
        node("p", hit.text, "excerpt"),
      );
      const full = node("details");
      full.append(
        node(
          "summary",
          tr(
            "قراءة الكتاب كاملًا للتحقق من السياق",
            "Read the complete book for context",
          ),
        ),
      );
      full.ontoggle = () => {
        if (!full.open || full.childElementCount > 1) return;
        for (const u of books.find((b) => b.id === hit.bookId).units)
          full.append(node("h4", u.reference), node("p", u.text, "excerpt"));
      };
      card.append(full);
      result.append(card);
    }
    return result;
  }
  refresh().catch(() => render());
  return {
    cancelSearch() {
      if (importing || !pending.size) return;
      for (const job of pending.values()) {
        clearTimeout(job.timer);
        job.reject(Error("cancelled"));
      }
      pending.clear();
      worker?.terminate();
      worker = undefined;
    },
    get active() {
      return mode;
    },
    render,
    search,
  };
}
