import { libraryDB } from "./library-store.mjs";
import { classifyPolicy, policyMessages } from "./policy.mjs";

export function createLibrary({
  panel,
  scope,
  changed,
  navigate,
  getLanguage,
}) {
  let shelves = [],
    books = [],
    mode = false,
    scopeType = "all",
    chosen = new Set(),
    available = false,
    importing = false;
  const worker = new Worker(new URL("./library-worker.mjs", import.meta.url), {
    type: "module",
  });
  const pending = new Map();
  worker.onmessage = ({ data }) => {
    const job = pending.get(data.id);
    if (!job) return;
    pending.delete(data.id);
    data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
  };
  worker.onerror = () => {
    for (const job of pending.values()) job.reject(Error("worker"));
    pending.clear();
  };
  const run = (data) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      pending.set(id, { resolve, reject });
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
          "بحث نصّي داخل كتبك المحلية فقط. النتائج مواضع مطابقة للمراجعة، وليست فتوى أو جوابًا مولّدًا.",
          "Text search only in your local books. Results are matching passages for review, not a fatwa or generated answer.",
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
        "ملف UTF-8: TXT أو MD أو JSON (حتى 5 MB)",
        "UTF-8 file: TXT, MD or JSON (up to 5 MB)",
      ),
      "file",
    );
    file.accept = ".txt,.md,.json";
    file.required = true;
    form.append(
      node(
        "p",
        tr(
          'TXT وMD: المرجع رقم الفقرة، وليس رقم صفحة. JSON: {"sections":[{"text":"النص الكامل","reference":"ص 12","heading":"العنوان"}]}. تُعرض الفقرة كاملة؛ قد تمتد شروط المسألة إلى فقرات أخرى، لذا راجع النص الكامل. لا يدعم هذا المسار PDF أو OCR بعد.',
          'TXT and MD use paragraph locations, not page numbers. JSON: {"sections":[{"text":"full text","reference":"p. 12","heading":"title"}]}. Paragraphs remain whole; conditions may continue elsewhere, so review the full source. PDF and OCR are not supported yet.',
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
      if (!selected || selected.size > 5_000_000) {
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
            content: await selected.text(),
            filename: selected.name,
            title: title.value,
            author: author.value,
            language: lang.value,
            shelfId: target.value,
          },
        });
        // Only validated, completely indexed books are committed and made searchable.
        await libraryDB("put", "books", book);
        await refresh();
        changed();
        panel.querySelector("[role=status]").textContent = tr(
          `تمت فهرسة ${book.units.length} موضعًا. الكتاب جاهز للبحث.`,
          `${book.units.length} passages indexed. The book is ready to search.`,
        );
      } catch {
        message.textContent = errorText();
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
    const policy = classifyPolicy(question, getLanguage());
    if (!["explain", "information", "qualified"].includes(policy)) {
      result.append(
        node(
          "p",
          policyMessages[getLanguage()][policy] ||
            policyMessages[getLanguage()].context,
        ),
      );
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
      books,
      question,
      scope: { language: getLanguage(), bookIds: ids },
    });
    result.append(
      node(
        "h2",
        tr("مواضع مطابقة في مكتبتي", "Matching passages in my library"),
      ),
      node(
        "p",
        tr(
          "هذه نتائج بحث لفظي للمراجعة، ولا تثبت وحدها كفاية الدليل أو صحة الحكم. لا يُولّد رَفّ فتوى من الكتب المضافة.",
          "These are lexical search matches for review, not proof of sufficient evidence or a correct ruling. Raff does not generate a fatwa from imported books.",
        ),
        "notice",
      ),
    );
    if (!hits.length)
      result.append(
        node(
          "p",
          tr(
            "لا توجد مطابقة كافية. جرّب كلمات الموضوع كما وردت في الكتاب؛ لا نملأ النقص من مصادر خارج النطاق.",
            "No sufficient match. Try the source terminology; nothing is filled in from outside the selected scope.",
          ),
        ),
      );
    for (const hit of hits) {
      const card = node("article", "", "source");
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
    get active() {
      return mode;
    },
    render,
    search,
  };
}
