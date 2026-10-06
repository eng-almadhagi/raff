import {
  LibraryVault,
  bookFingerprint,
  encodeBackup,
  decodeBackup,
  mergeSnapshot,
  MAX_BACKUP_BYTES,
} from "./library-vault.mjs?v=0.16.2";
import {
  classifyLibraryPolicy,
  policyMessages,
  clarificationChoices,
} from "./policy.mjs?v=0.16.2";

export function createLibrary({
  panel,
  scope,
  navigate,
  getLanguage: interfaceLanguage,
}) {
  const vault = new LibraryVault();
  let shelves = [],
    books = [],
    importing = false,
    searching = false,
    epoch = 0,
    privateLanguage = interfaceLanguage(),
    chosen = new Set();
  const getLanguage = () => privateLanguage;
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
  const errorText = (error) => {
    const messages = {
      "vault-conflict": [
        "تغيرت المكتبة في نافذة أخرى. أعد ربط المجلد أو افتح الموقع مجددًا قبل إعادة الحفظ؛ لم نستبدل التغييرات الأحدث.",
        "The library changed in another tab. Relink or reopen before saving; newer changes were not overwritten.",
      ],
      "vault-busy": [
        "عملية حفظ أخرى قيد التنفيذ. أعد المحاولة بعد انتهائها.",
        "Another save is in progress. Retry after it finishes.",
      ],
      "vault-permission": [
        "يلزم تجديد إذن المجلد. كتبك لم تُحذف؛ اضغط إعادة السماح بالوصول.",
        "Folder permission is required. Your books were not deleted; renew access.",
      ],
      "vault-recovery": [
        "وجدنا ملفات محفوظة دون فهرس صالح. لم ننشئ مكتبة فارغة فوقها. أعد ربط المجلد الصحيح أو استعد نسخة احتياطية.",
        "Saved files exist without a valid manifest. Nothing was overwritten. Relink the correct folder or restore a backup.",
      ],
      "vault-version": [
        "إصدار النسخة غير مدعوم. لم تتغير المكتبة الحالية.",
        "Unsupported backup version. Your current library is unchanged.",
      ],
      "vault-invalid": [
        "بيانات المكتبة غير صالحة. لم نستبدل مكتبتك بها.",
        "Invalid library data. Your library was not replaced.",
      ],
      "vault-checksum": [
        "فشل التحقق من سلامة النسخة. لم تُستورد.",
        "Backup integrity check failed. It was not imported.",
      ],
      "vault-verify": [
        "لم يمكن تأكيد القراءة بعد الحفظ. لم نعلن الكتاب جاهزًا؛ أعد المحاولة.",
        "Read-back verification failed. The book was not marked ready; retry.",
      ],
      "vault-size": [
        "تجاوزت النسخة حد 150 MB. صدّر مكتبة أصغر.",
        "The backup exceeds the 150 MB limit. Use a smaller library.",
      ],
      "document-no-text": [
        "الملف لا يحتوي نصًا قابلًا للاستخراج. الصور تحتاج OCR خارج الموقع.",
        "No extractable text. Scans require external OCR.",
      ],
      "document-password": [
        "الملف محمي بكلمة مرور. أضف نسخة نصية غير محمية مسموحة لك.",
        "Password-protected document. Use an authorized unprotected text copy.",
      ],
      "document-limit": [
        "تجاوز الملف حدود المعالجة. قسّمه إلى أجزاء أصغر.",
        "Document processing limit exceeded. Split it into smaller parts.",
      ],
      "document-timeout": [
        "انتهت مهلة المعالجة. لم يُضف الملف؛ أعد المحاولة بملف أصغر.",
        "Processing timed out. The file was not added; retry with a smaller file.",
      ],
      "document-invalid": [
        "تعذر قراءة الملف؛ أعد حفظه من برنامجه الأصلي ثم أعد المحاولة.",
        "Could not read the document. Save it again in its original application and retry.",
      ],
      QuotaExceededError: [
        "مساحة التخزين غير كافية. وفر مساحة ثم أعد المحاولة؛ الكتب السابقة باقية.",
        "Storage is full. Free space and retry; existing books are retained.",
      ],
      NotAllowedError: [
        "لم يُمنح إذن القراءة والكتابة. أعد السماح بالمجلد.",
        "Read/write permission was not granted. Renew folder access.",
      ],
      NotFoundError: [
        "تعذر العثور على المجلد أو ملفاته. ربما نُقل؛ أعد ربطه.",
        "The folder or its files could not be found. It may have moved; relink it.",
      ],
      SecurityError: [
        "منع المتصفح الوصول إلى المجلد. افتح الموقع عبر HTTPS وفي نافذة عادية، أو استخدم الحفظ داخل المتصفح.",
        "The browser blocked folder access. Use HTTPS in a regular window, or browser storage.",
      ],
      NoModificationAllowedError: [
        "المجلد أو الملف غير قابل للكتابة الآن. تحقق من صلاحية الكتابة ومن أنه غير مقفل ثم أعد المحاولة.",
        "The folder or file is not writable. Check permissions and file locks, then retry.",
      ],
      AbortError: [
        "أُلغي اختيار المجلد أو العملية. لم تتغير المكتبة.",
        "The picker or operation was cancelled. The library is unchanged.",
      ],
    };
    const msg = messages[error?.message] || messages[error?.name];
    return msg
      ? tr(...msg)
      : tr(
          "تعذرت العملية. لم نعلن نجاح الحفظ. تحقق من المجلد ومساحته وصيغة الملف وأعد المحاولة.",
          "Operation failed; no save success was reported. Check folder access, space and file format, then retry.",
        );
  };
  const extractionNote = (book) =>
    book.extraction
      ? tr(
          "نص مستخرج آليًا؛ راجع ترتيبه في الأصل. الصور لا تُفهرس.",
          "Automatically extracted text; check its order in the original. Images are not indexed.",
        ) +
        (book.extraction.pagesWithoutText?.length
          ? tr(" صفحات بلا نص: ", " Pages without text: ") +
            book.extraction.pagesWithoutText.join(", ")
          : "")
      : "";
  const toolbar = node("div", "", "library-toolbar"),
    heading = node("h2"),
    close = button("", () => {
      navigate("ask");
    });
  toolbar.append(heading, close);
  const notice = node("p", "", "notice"),
    message = node("p");
  message.setAttribute("role", "status");
  message.id = "library-save-status";
  const manager = node("details", "", "library-manager"),
    summary = node("summary"),
    management = node("div");
  manager.append(summary, management);
  const languages = node("div", "", "choices"),
    selection = node("div", "", "library-selection");
  const form = node("form", "", "library-search-form"),
    qlabel = node("label"),
    questionInput = node("textarea");
  questionInput.id = "library-question";
  questionInput.rows = 3;
  questionInput.maxLength = 600;
  questionInput.required = true;
  qlabel.htmlFor = questionInput.id;
  const submit = node("button");
  submit.type = "submit";
  submit.id = "library-search-submit";
  const statusRow = node("div", "", "search-status"),
    spinner = node("span", "", "search-spinner"),
    statusText = node("p"),
    statusDetail = node("p", "", "search-detail"),
    results = node("section");
  spinner.hidden = true;
  spinner.setAttribute("aria-hidden", "true");
  statusRow.setAttribute("role", "status");
  statusRow.append(spinner, statusText);
  results.id = "library-results";
  results.setAttribute("aria-live", "polite");
  form.append(qlabel, questionInput, submit);
  panel.replaceChildren(
    toolbar,
    notice,
    message,
    manager,
    languages,
    selection,
    form,
    statusRow,
    statusDetail,
    results,
  );
  scope.replaceChildren();
  scope.hidden = true;
  try {
    const saved = JSON.parse(
      localStorage.getItem("raff-private-search") || "null",
    );
    if (saved) {
      questionInput.value = saved.question || "";
      chosen = new Set(saved.chosen || []);
      if (["ar", "en"].includes(saved.language))
        privateLanguage = saved.language;
    }
  } catch {}
  function remember() {
    try {
      localStorage.setItem(
        "raff-private-search",
        JSON.stringify({
          question: questionInput.value,
          chosen: [...chosen],
          language: privateLanguage,
        }),
      );
    } catch {}
  }
  questionInput.oninput = remember;
  function invalidate() {
    epoch++;
    cancelSearch();
    results.replaceChildren();
    statusText.textContent = "";
    statusDetail.textContent = "";
    remember();
  }
  function scopeIds() {
    return books
      .filter((b) => b.language === getLanguage() && chosen.has(b.id))
      .map((b) => b.id);
  }
  function renderLabels() {
    panel.dir = getLanguage() === "ar" ? "rtl" : "ltr";
    heading.textContent = tr(
      "مكتبتي — رفوف الباحث",
      "My library — Research shelves",
    );
    summary.textContent = tr(
      "⊕ إضافة رف وإدارة الحفظ والكتب",
      "⊕ Add a shelf, storage and books",
    );
    close.textContent = tr(
      "إغلاق والعودة للرئيسية",
      "Close and return to public search",
    );
    qlabel.textContent = tr(
      "سؤالك في الكتب المحددة",
      "Question for the selected books",
    );
    submit.textContent = tr("بحث في مكتبتي", "Search my library");
    submit.disabled = searching || importing || !vault.ready;
    spinner.hidden = !searching;
    form.setAttribute("aria-busy", String(searching));
    notice.textContent =
      vault.mode === "folder"
        ? tr(
            "ستُحفظ بيانات مكتبتك في مجلد Raff الذي اخترته على جهازك. الاسم المتاح للمتصفح: Raff. قد يلزم تجديد الإذن بعد إعادة الفتح.",
            "Your library data is saved in your chosen Raff folder on this device. Browser-visible name: Raff. Permission may need renewal after reopening.",
          )
        : tr(
            "الحفظ داخل هذا المتصفح — ليس مجلدًا ظاهرًا على الجهاز. مسح بيانات الموقع أو التصفح الخاص قد يفقد النسخة؛ صدّر نسخة احتياطية.",
            "Saved inside this browser — not a visible device folder. Clearing site data or private browsing may lose it; export a backup.",
          );
    languages.replaceChildren();
    for (const [lang, label] of [
      ["ar", "العربية"],
      ["en", "English"],
    ]) {
      const b = button(label, () => {
        if (privateLanguage === lang) return;
        privateLanguage = lang;
        message.replaceChildren();
        invalidate();
        render();
      });
      b.setAttribute("aria-pressed", String(privateLanguage === lang));
      languages.append(b);
    }
  }
  function renderSelection() {
    selection.replaceChildren(
      node("h3", tr("الكتب التي سيُبحث فيها", "Books to search")),
    );
    const controls = node("div", "", "choices");
    controls.append(
      button(tr("تحديد جميع الكتب", "Select all books"), () => {
        chosen = new Set(
          books.filter((b) => b.language === getLanguage()).map((b) => b.id),
        );
        invalidate();
        renderSelection();
      }),
      button(tr("إلغاء التحديد", "Clear selection"), () => {
        chosen.clear();
        invalidate();
        renderSelection();
      }),
    );
    for (const s of shelves)
      controls.append(
        button(s.title, () => {
          const ids = books
            .filter((b) => b.shelfId === s.id && b.language === getLanguage())
            .map((b) => b.id);
          const all = ids.length && ids.every((id) => chosen.has(id));
          ids.forEach((id) => (all ? chosen.delete(id) : chosen.add(id)));
          invalidate();
          renderSelection();
        }),
      );
    selection.append(controls);
    for (const b of books.filter((b) => b.language === getLanguage())) {
      const wrap = node("label", "", "library-book-choice"),
        check = node("input");
      check.type = "checkbox";
      check.checked = chosen.has(b.id);
      check.onchange = () => {
        check.checked ? chosen.add(b.id) : chosen.delete(b.id);
        invalidate();
        renderSelection();
      };
      wrap.append(
        check,
        document.createTextNode(
          b.title +
            " — " +
            (shelves.find((s) => s.id === b.shelfId)?.title || ""),
        ),
      );
      selection.append(wrap);
    }
    selection.append(
      node(
        "p",
        tr(
          `النطاق: ${scopeIds().length} كتاب. لا تُستخدم المصادر العامة هنا.`,
          `Scope: ${scopeIds().length} books. Public sources are never used here.`,
        ),
      ),
    );
  }
  function refresh() {
    shelves = vault.snapshot.shelves;
    books = vault.snapshot.books;
    chosen = new Set(
      [...chosen].filter((id) => books.some((b) => b.id === id)),
    );
    render();
  }
  async function operation(fn) {
    if (importing || searching) return;
    importing = true;
    renderLabels();
    try {
      await fn();
      refresh();
    } catch (e) {
      message.textContent = errorText(e);
      message.append(
        button(tr("إعادة المحاولة", "Retry"), () => operation(fn)),
      );
      refresh();
    } finally {
      importing = false;
      renderLabels();
    }
  }
  function download(text, name) {
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const a = node("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function renderManagement() {
    management.replaceChildren();
    management.append(
      node("h3", tr("مكان الحفظ", "Storage location")),
      node(
        "p",
        tr(
          "تغيير المجلد لا ينقل المكتبة القديمة؛ تبقى في مكانها. لن نستبدلها بمكتبة فارغة عند انقطاع الإذن.",
          "Changing folders does not move the old library; it remains in place. Missing permission never replaces it with an empty library.",
        ),
      ),
    );
    const storageControls = node("div", "", "choices");
    if (
      typeof window.showDirectoryPicker === "function" &&
      window.isSecureContext
    )
      storageControls.append(
        button(
          tr(
            "تحديد مجلد حفظ بيانات رف / إعادة ربطه",
            "Choose or relink Raff storage folder",
          ),
          () => {
            if (importing || searching) return;
            // Invoke the picker directly from the click, before any asynchronous work.
            const picked = window.showDirectoryPicker({
              id: "raff-library",
              mode: "readwrite",
            });
            operation(async () => {
              const parent = await picked;
              await vault.chooseFolder(parent);
              chosen.clear();
              invalidate();
              message.textContent = tr(
                "رُبط مجلد Raff. المكتبة السابقة باقية في مكانها.",
                "Raff folder linked. The previous library remains in its original location.",
              );
            });
          },
        ),
      );
    else
      management.append(
        node(
          "p",
          tr(
            "اختيار مجلد غير مدعوم في هذا المتصفح. استخدم الحفظ داخل المتصفح والنسخ الاحتياطية، أو افتح الموقع بمتصفح يدعم اختيار المجلد.",
            "Folder picking is unavailable here. Use browser storage and backups, or a browser that supports folder picking.",
          ),
        ),
      );
    if (vault.handle)
      storageControls.append(
        button(
          tr("إعادة السماح بالوصول إلى مجلد رف", "Renew access to Raff folder"),
          () =>
            operation(async () => {
              await vault.reconnect(true);
              invalidate();
              message.textContent = tr(
                "استعيد الوصول والكتب المحفوظة.",
                "Access and saved books restored.",
              );
            }),
        ),
      );
    storageControls.append(
      button(tr("الحفظ داخل هذا المتصفح", "Save inside this browser"), () =>
        operation(async () => {
          await vault.useBrowser();
          invalidate();
          const persistent = await navigator.storage?.persist?.();
          message.textContent = persistent
            ? tr(
                "طلب التخزين المستمر مقبول، لكنه ليس ضمانًا ضد مسح البيانات.",
                "Persistent storage granted; this does not protect against clearing site data.",
              )
            : tr(
                "الحفظ داخل المتصفح متاح. احتفظ بنسخة احتياطية؛ التخزين المستمر غير مضمون.",
                "Browser storage is available. Keep a backup; persistence is not guaranteed.",
              );
        }),
      ),
    );
    management.append(storageControls);
    if (vault.handle)
      management.append(
        button(
          tr(
            "استعادة نسخة محفوظة في مجلد Raff",
            "Recover a saved generation in Raff",
          ),
          () =>
            operation(async () => {
              await vault.recoverPrevious();
              invalidate();
              message.textContent = tr(
                "استعيدت نسخة متحقق منها؛ النسخ الأخرى لا تزال محفوظة في المجلد.",
                "Previous verified generation restored; other snapshots remain in the folder.",
              );
            }),
        ),
      );
    if (!vault.ready) return;
    const backupControls = node("div", "", "choices");
    backupControls.append(
      button(tr("تصدير نسخة احتياطية كاملة", "Export complete backup"), () =>
        operation(async () => {
          download(await vault.export(), "raff-library-backup.json");
          message.textContent = tr(
            "جُهزت النسخة للتنزيل. تحقق من اكتمال التنزيل في متصفحك.",
            "Backup prepared for download. Check that the browser download completed.",
          );
        }),
      ),
    );
    const restoreLabel = node(
        "label",
        tr(
          "استيراد نسخة احتياطية (دمج دون حذف الكتب)",
          "Import backup (merge, keep existing books)",
        ),
      ),
      restore = node("input");
    restore.type = "file";
    restore.accept = ".json";
    restore.onchange = () =>
      operation(async () => {
        const f = restore.files[0];
        if (!f) return;
        if (f.size > MAX_BACKUP_BYTES) throw Error("vault-size");
        const incoming = await decodeBackup(await f.text());
        const merged = await mergeSnapshot(vault.snapshot, incoming);
        await vault.save(merged.snapshot);
        await vault.restoreVectors();
        invalidate();
        message.textContent = tr(
          `تم حفظ النسخة والتحقق منها. كتب مكررة لم تُضف: ${merged.duplicates}.`,
          `Backup saved and verified. Duplicate books skipped: ${merged.duplicates}.`,
        );
      });
    restoreLabel.append(restore);
    backupControls.append(restoreLabel);
    management.append(backupControls);
    const shelfForm = node("form", "", "library-form"),
      shelfName = input(shelfForm, tr("اسم الرف الجديد", "New shelf name"));
    shelfName.required = true;
    shelfName.maxLength = 100;
    const create = node("button", tr("+ إنشاء رف", "+ Create shelf"));
    create.type = "submit";
    shelfForm.append(create);
    shelfForm.onsubmit = (e) => {
      e.preventDefault();
      operation(async () => {
        const title = shelfName.value.trim();
        if (!title) return;
        await vault.save({
          ...vault.snapshot,
          shelves: [...shelves, { id: crypto.randomUUID(), title }],
        });
        message.textContent = tr(
          "حُفظ الرف وتحققنا من قراءته.",
          "Shelf saved and read-back verified.",
        );
      });
    };
    management.append(shelfForm);
    const add = node("form", "", "library-form");
    add.append(
      node("h3", tr("+ إضافة كتاب أو عدة كتب", "+ Add one or more books")),
    );
    const title = input(
      add,
      tr(
        "عنوان الكتاب (اختياري؛ للملف الواحد)",
        "Book title (optional; single file)",
      ),
    );
    title.maxLength = 200;
    const author = input(add, tr("المؤلف / المصدر", "Author / source"));
    author.maxLength = 200;
    const shelfLabel = node("label", tr("الرف", "Shelf")),
      target = node("select");
    target.required = true;
    for (const s of shelves) {
      const o = node("option", s.title);
      o.value = s.id;
      target.append(o);
    }
    shelfLabel.append(target);
    add.append(shelfLabel);
    const langLabel = node("label", tr("لغة الكتب", "Books language")),
      lang = node("select");
    for (const [value, label] of [
      ["ar", "العربية"],
      ["en", "English"],
    ]) {
      const o = node("option", label);
      o.value = value;
      lang.append(o);
    }
    lang.value = privateLanguage;
    langLabel.append(lang);
    add.append(langLabel);
    const files = input(
      add,
      tr(
        "ملفات نصية: PDF / DOCX / TXT / MD / JSON",
        "Text files: PDF / DOCX / TXT / MD / JSON",
      ),
      "file",
    );
    files.accept = ".txt,.md,.json,.pdf,.docx";
    files.multiple = true;
    files.required = true;
    add.append(
      node(
        "p",
        tr(
          "PDF وDOCX حتى 20 MB لكل ملف؛ TXT وMD وJSON حتى 5 MB. ملفات DOC القديمة يجب تحويلها إلى DOCX. الصور والمسح الضوئي لا يعالجان كنص. PDF: رقم صفحة الملف؛ Word: رقم الفقرة. راجع النص المستخرج.",
          "PDF/DOCX up to 20 MB each; TXT/MD/JSON up to 5 MB. Convert old DOC to DOCX. Scanned images are not text. PDF references use file pages; Word uses paragraphs. Check extracted text.",
        ),
      ),
    );
    const addButton = node(
      "button",
      tr("استيراد ومعالجة وحفظ", "Import, process and save"),
    );
    addButton.type = "submit";
    addButton.disabled = !shelves.length;
    add.append(addButton);
    add.onsubmit = (e) => {
      e.preventDefault();
      const selected = [...files.files],
        targetId = target.value,
        language = lang.value;
      const importBatch = async () => {
        const completed = [],
          duplicates = [];
        const failed = [];
        for (const file of selected) {
          try {
            message.textContent = tr(
              `جارٍ الاستيراد: ${file.name}`,
              `Importing: ${file.name}`,
            );
            const binary = /\.(pdf|docx)$/i.test(file.name);
            if (file.size > (binary ? 20_000_000 : 5_000_000))
              throw Error("document-limit");
            const data = binary
              ? { buffer: await file.arrayBuffer() }
              : { content: await file.text() };
            message.textContent = tr(
              `جارٍ المعالجة: ${file.name}`,
              `Processing: ${file.name}`,
            );
            const book = await run({
              type: "import",
              payload: {
                ...data,
                filename: file.name,
                title:
                  selected.length === 1 && title.value.trim()
                    ? title.value.trim()
                    : file.name.replace(/\.[^.]+$/, ""),
                author: author.value,
                language,
                shelfId: targetId,
              },
            });
            const fingerprint = await bookFingerprint(book);
            let duplicate = false;
            for (const b of vault.snapshot.books)
              if (
                (b.fingerprint || (await bookFingerprint(b))) === fingerprint
              ) {
                duplicate = true;
                break;
              }
            if (duplicate) {
              duplicates.push(file.name);
              continue;
            }
            message.textContent = tr(
              `جارٍ الحفظ والتحقق: ${file.name}`,
              `Saving and verifying: ${file.name}`,
            );
            await vault.save({
              ...vault.snapshot,
              books: [...vault.snapshot.books, { ...book, fingerprint }],
            });
            completed.push(book.id);
          } catch (error) {
            failed.push(`${file.name}: ${errorText(error)}`);
          }
        }
        if (completed.length) {
          privateLanguage = language;
          chosen = new Set(completed);
          invalidate();
        }
        message.textContent =
          tr(
            `حُفظ وتحقق ${completed.length} كتاب. مكرر لم يُضف: ${duplicates.length}.`,
            `Saved and verified ${completed.length} books. Duplicates skipped: ${duplicates.length}.`,
          ) +
          (failed.length ? "\n" + failed.join("\n") : "") +
          (duplicates.length ? "\n" + duplicates.join("، ") : "");
        if (failed.length)
          message.append(
            button(tr("إعادة محاولة الاستيراد", "Retry import"), () =>
              operation(importBatch),
            ),
          );
        if (completed.length) {
          const open = button(tr("فتح مكتبتي", "Open my library"), () => {
            manager.open = false;
            questionInput.focus();
          });
          message.append(document.createTextNode(" "), open);
        }
      };
      operation(importBatch);
    };
    management.append(add);
    for (const shelf of shelves) {
      const card = node("section", "", "library-shelf");
      card.append(node("h3", shelf.title));
      const rename = node("form", "", "library-form"),
        name = input(rename, tr("تعديل اسم الرف", "Rename shelf"));
      name.value = shelf.title;
      name.maxLength = 100;
      name.required = true;
      const save = node("button", tr("حفظ الاسم", "Save name"));
      save.type = "submit";
      rename.append(save);
      rename.onsubmit = (e) => {
        e.preventDefault();
        operation(async () => {
          await vault.save({
            ...vault.snapshot,
            shelves: shelves.map((s) =>
              s.id === shelf.id ? { ...s, title: name.value.trim() } : s,
            ),
          });
        });
      };
      card.append(rename);
      for (const book of books.filter((b) => b.shelfId === shelf.id)) {
        const row = node("article", "", "library-book");
        row.append(
          node("h4", book.title),
          node(
            "p",
            `${book.language} · ${book.units.length} ${tr("موضع محفوظ ومفهرس نصيًا", "saved, text-indexed passages")}`,
          ),
        );
        const preview = node("details");
        preview.append(
          node("summary", tr("معاينة النص المحفوظ", "Inspect saved text")),
        );
        for (const u of book.units.slice(0, 3))
          preview.append(
            node("h5", u.reference),
            node("p", u.text.slice(0, 1500), "excerpt"),
          );
        row.append(preview);
        if (book.extraction)
          row.append(node("p", extractionNote(book), "notice"));
        const label = node("label", tr("نقل إلى رف", "Move to shelf")),
          move = node("select");
        for (const s of shelves) {
          const o = node("option", s.title);
          o.value = s.id;
          move.append(o);
        }
        move.value = book.shelfId;
        move.onchange = () =>
          operation(async () => {
            await vault.save({
              ...vault.snapshot,
              books: books.map((b) =>
                b.id === book.id ? { ...b, shelfId: move.value } : b,
              ),
            });
            invalidate();
          });
        label.append(move);
        row.append(label);
        card.append(row);
      }
      management.append(card);
    }
    management.append(
      node(
        "p",
        tr(
          "المعالجة والبحث يعملان على جهازك. لا تُرسل الأسئلة أو الكتب لخادم. قد يحتاج تنزيل ملفات الموقع ونموذج البحث الحالي إلى الإنترنت أول مرة؛ لا نعد بتشغيل كامل بلا إنترنت. تحفظ الفهارس النصية فورًا، وتُحفظ التمثيلات الدلالية المستخدمة بعد البحث لإعادة استخدامها.",
          "Processing and search run on this device. Questions and books are not sent to a server. Site assets and the existing semantic model may need internet on first download; complete offline operation is not promised. Text indexes are saved immediately; semantic vectors used by search are saved for reuse.",
        ),
      ),
    );
  }
  function render() {
    renderLabels();
    renderSelection();
    renderManagement();
  }
  async function executeSearch() {
    if (searching || importing) return;
    if (!vault.ready) {
      statusText.textContent = errorText(Error("vault-permission"));
      return;
    }
    if (!scopeIds().length) {
      statusText.textContent = tr(
        "حدد كتابًا واحدًا أو أكثر قبل البحث.",
        "Select one or more books before searching.",
      );
      return;
    }
    const question = questionInput.value.trim();
    if (question.length < 2) return;
    searching = true;
    const current = ++epoch;
    remember();
    results.replaceChildren();
    statusText.textContent = tr("جارٍ البحث…", "Searching…");
    statusDetail.textContent = "";
    renderLabels();
    const started = performance.now();
    try {
      const answer = await search(question);
      if (current !== epoch) return;
      results.replaceChildren(answer);
      await vault.saveVectors();
      statusText.textContent = tr(
        `اكتمل البحث في ${((performance.now() - started) / 1000) | 0} ث؛ حُفظت بيانات البحث.`,
        `Search complete in ${((performance.now() - started) / 1000) | 0} s; search data saved.`,
      );
    } catch (error) {
      if (current === epoch) {
        statusText.textContent = errorText(error);
        results.append(button(tr("إعادة المحاولة", "Retry"), executeSearch));
      }
    } finally {
      if (current === epoch) {
        searching = false;
        statusDetail.textContent = "";
        renderLabels();
      }
    }
  }
  questionInput.onkeydown = (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (!submit.disabled) form.requestSubmit();
  };
  form.onsubmit = (e) => {
    e.preventDefault();
    executeSearch();
  };
  function cancelSearch() {
    if (importing) return;
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(Error("cancelled"));
    }
    pending.clear();
    worker?.terminate();
    worker = undefined;
    searching = false;
    renderLabels();
  }
  let worker;
  const pending = new Map();
  function resetWorker() {
    worker?.terminate();
    worker = new Worker(
      new URL("./library-worker.mjs?v=0.16.2", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (!job) return;
      if (data.progress) {
        clearTimeout(job.timer);
        job.timer = setTimeout(job.timeout, 120000);
        const p = data.progress;
        statusDetail.textContent =
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

  async function search(question) {
    const result = node("div");
    if (!vault.ready) {
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
          button(choice.label, () => {
            questionInput.value = choice.question;
            executeSearch();
          }),
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
            "لم أجد في المقاطع المسترجعة نصًا يجيب عن سؤالك. قد يذكر الكتاب الموضوع دون المعلومة المطلوبة، وقد يفوت البحث موضعًا مناسبًا. راجع النص المحفوظ أو جرّب صياغة أخرى؛ لن أضيف معلومة من خارج الكتب المحددة.",
            "I found no passage that answers your question. The book may mention the topic without the requested detail, or retrieval may have missed a relevant passage. Check the saved text or try another wording; I will not add information from outside the selected books.",
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

  render();
  vault
    .init()
    .then(() => {
      refresh();
      message.textContent = tr(
        "استعيدت المكتبة المحفوظة دون إعادة رفع الكتب.",
        "Saved library restored without uploading books again.",
      );
    })
    .catch((e) => {
      message.textContent = errorText(e);
      render();
      manager.open = true;
    });
  return {
    get active() {
      return false;
    },
    render,
    search,
    cancelSearch,
    addShelf() {
      navigate("library");
      manager.open = true;
      management.scrollIntoView({ block: "start" });
    },
  };
}
