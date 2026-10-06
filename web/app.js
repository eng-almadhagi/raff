"use strict";
const $ = (id) => document.getElementById(id);
let books = [], history = [], controller = null;
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function reset() {
  if (controller) controller.abort();
  controller = null;
  history = [];
  $("conversation").replaceChildren();
  $("welcome").hidden = false;
  $("question").value = "";
  $("submit").disabled = false;
  $("question").focus();
}
function coverage() {
  const book = books.find((b) => b.id === $("book").value);
  if (!book) return;
  $("scope").textContent = book.scope;
  $("coverage").replaceChildren();
  const content = element("div");
  content.append(element("strong", book.available ? `${book.title} · ${book.units} وحدة متاحة` : `${book.title} · قيد التجهيز`));
  content.append(element("p", book.available ? `${book.coverage.complete ? "جميع سجلات النسخة مستوردة" : "تغطية جزئية"} — ${book.coverage.note}` : "لم تُنشر مادة معتمدة بعد. أمثلة الأسئلة لتوضيح الاستخدام، ولا تعني اكتمال تغطية هذه المسائل."));
  if (book.progress) {
    const p = book.progress;
    const number = (value) => new Intl.NumberFormat("ar-SA").format(value);
    content.append(element("p", `${number(p.total)} صفحة محصورة · ${number(p.parsed)} مستخرجة آليًا · ${number(p.reviewed)} مراجَعة · ${number(book.units)} وحدة متاحة`));
  }
  $("coverage").append(element("span", "◷"), content);
}
function renderAnswer(data) {
  const section = element("article", undefined, "message");
  section.append(element("h2", "رَف · من السؤال إلى المصدر"),element("p",data.message));
  if (data.level) section.append(element("small", `مستوى الاستجابة: ${data.level}`));
  if (data.suggestions?.length) {
    const choices = element("div", undefined, "examples");
    for (const title of data.suggestions) {
      const button = element("button", title);
      button.type = "button";
      button.addEventListener("click", () => { $("question").value = title; $("question").focus(); });
      choices.append(button);
    }
    section.append(choices);
  }
  if (data.citations.length) section.append(element("h2", "الاقتباس الحرفي من الكتاب المحفوظ"));
  for (const source of data.citations) {
    const box = element("div", undefined, "source");
    box.append(element("strong",source.title),element("small",source.path.join(" ← ")));
    if (source.mufti) box.append(element("p", `المفتي/الجهة كما في النص: ${source.mufti}`));
    if (source.source_refs?.length) box.append(element("small", source.source_refs.map((r) => `الجزء ${r.part ?? "غير متاح"} · الصفحة ${r.page_num ?? "غير متاحة"}`).join(" — ")));
    const original = element("details");
    original.open = true;
    if (source.content_type === "qa_group") box.append(element("small", "مجموعة أسئلة محفوظة بسياقها؛ لا يُنسب جواب أحدها إلى الآخر."));
    original.append(element("summary", "عرض النص الأصلي المحفوظ وسياقه"), element("blockquote",source.quote));
    box.append(original);
    const url = new URL(source.url);
    if (url.protocol === "https:") {
      const link = element("a","افتح المصدر الأصلي ↗");
      link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer";
      box.append(link);
    }
    if (source.footnotes.length) {
      const details = element("details");
      details.append(element("summary","الحواشي والإحالات"));
      source.footnotes.forEach((note, index) => details.append(element("p",`${note.marker || `حاشية ${index+1}:`} ${note.text}`)));
      box.append(details);
    }
    box.append(element("small",source.attribution));
    section.append(box);
  }
  $("conversation").append(section);
}
$("new-chat").addEventListener("click",reset);
$("book").addEventListener("change",() => { reset(); coverage(); });
document.querySelectorAll("[data-question]").forEach((button) => button.addEventListener("click",() => {
  $("question").value = button.dataset.question; $("question").focus();
}));
$("ask-form").addEventListener("submit",async (event) => {
  event.preventDefault();
  const question = $("question").value.trim();
  if (question.length < 2 || controller) return;
  const active = new AbortController(); controller = active;
  const timeout = setTimeout(() => active.abort(),25000);
  $("welcome").hidden = true;
  $("submit").disabled = true;
  $("conversation").append(element("article",question,"message user"));
  const loading = element("p","أبحث في الكتاب المحدد…","message");
  $("conversation").append(loading);
  try {
    const response = await fetch("/api/ask",{method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({question,book_id:$("book").value,history:history.slice(-4)}),signal:active.signal});
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "تعذر إكمال الطلب.");
    if (controller !== active) return;
    renderAnswer(data); history.push(question); $("question").value = "";
  } catch (error) {
    if (controller === active) $("conversation").append(element("p",error.name === "AbortError" ? "انتهت مهلة البحث. أعد المحاولة." : error.message,"message error"));
  } finally {
    clearTimeout(timeout); loading.remove();
    if (controller === active) { controller = null; $("submit").disabled = false; $("question").focus(); }
  }
});
fetch("/api/books").then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((data) => {
  books = data.books;
  $("book").replaceChildren(...books.map((b) => { const option = element("option",b.title); option.value=b.id; return option; }));
  coverage();
}).catch(() => { $("coverage").textContent="تعذر تحميل حالة المكتبة. حدّث الصفحة للمحاولة مجددًا."; $("submit").disabled=true; });
