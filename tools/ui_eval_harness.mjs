const run = document.querySelector("#run"),
  progress = document.querySelector("#progress"),
  out = document.querySelector("#results"),
  frame = document.querySelector("#app");
const wait = async (predicate, timeout = 240000) => {
  const start = performance.now();
  while (!predicate()) {
    if (performance.now() - start > timeout) throw Error("UI timeout");
    await new Promise((r) => setTimeout(r, 80));
  }
};
const selectLanguage = async (d, language) => {
  if (d.documentElement.lang !== language) {
    d.querySelector(`[data-language="${language}"]`).click();
    await wait(() => !d.querySelector("#submit").disabled);
  }
};
const submit = async (d, q) => {
  await wait(() => !d.querySelector("#submit").disabled);
  d.querySelector("#question").value = q;
  const started = performance.now();
  d.querySelector("#ask-form").requestSubmit();
  await wait(() => !d.querySelector("#submit").disabled);
  return Math.round(performance.now() - started);
};
const capture = (d) => {
  const cards = [...d.querySelectorAll("#result article.source")].map((a) => ({
    title: a.querySelector("h3").textContent,
    source: a.closest(".source-group")?.querySelector("h2")?.textContent,
    question: a.querySelector(".source-question")?.textContent,
    reference: [...a.querySelectorAll(".reference")].map((n) => n.textContent),
    preview: a.querySelector(".excerpt").textContent,
    label: a.querySelector(".badge").textContent,
    original: a.querySelector("details blockquote").textContent,
    url: a.querySelector("details a")?.href,
    evidence: [...a.querySelectorAll(".evidence blockquote")].map(
      (n) => n.textContent,
    ),
  }));
  return {
    text: d.querySelector("#result").innerText,
    cards,
    quoteChecks: cards.every(
      (c) =>
        c.original.includes(c.preview) &&
        c.evidence.every((x) => c.original.includes(x)),
    ),
    officialEnglishOnly:
      d.documentElement.lang !== "en" ||
      cards.every((c) => c.url?.startsWith("https://islamqa.info/en/answers/")),
    sourceSelection: [
      ...d.querySelectorAll('[data-source][aria-pressed="true"]'),
    ].map((b) => b.dataset.source),
  };
};
run.onclick = async () => {
  run.disabled = true;
  const results = [],
    controls = [];
  try {
    const name = new URL(location.href).searchParams.get("cases");
    const cases = await (
      await fetch(
        "./" +
          ([
            "test-cases.json",
            "unseen-cases.json",
            "extra-cases.json",
          ].includes(name)
            ? name
            : "test-cases.json"),
      )
    ).json();
    const d = frame.contentDocument;
    await wait(
      () => d.querySelector("#submit") && !d.querySelector("#submit").disabled,
    );
    if (name === "test-cases.json") {
      const q = "سؤال مكتوب محفوظ للاختبار";
      d.querySelector("#question").value = q;
      for (const lang of ["en", "ar"]) {
        await selectLanguage(d, lang);
        controls.push({
          action: "language " + lang,
          preserved: d.querySelector("#question").value === q,
          cleared: !d.querySelector("#result").textContent,
          dir: d.documentElement.dir,
          sourceButtons: [...d.querySelectorAll("[data-source]")].map(
            (b) => b.textContent,
          ),
        });
      }
      for (const source of ["fatawa-islamiyyah-1708", "islamqa-ar", "all"]) {
        d.querySelector(`[data-source="${source}"]`).click();
        await wait(() => !d.querySelector("#submit").disabled);
        controls.push({
          action: "source " + source,
          preserved: d.querySelector("#question").value === q,
          cleared: !d.querySelector("#result").textContent,
          selected:
            d
              .querySelector(`[data-source="${source}"]`)
              .getAttribute("aria-pressed") === "true",
        });
      }
      await submit(d, "رقم 181");
      controls.push({ action: "Arabic 181", ...capture(d) });
      d.querySelector('[data-source="fatawa-islamiyyah-1708"]').click();
      await wait(() => !d.querySelector("#submit").disabled);
      controls.push({
        action: "change source after result",
        preserved: d.querySelector("#question").value === "رقم 181",
        cleared: !d.querySelector("#result").textContent,
      });
      await submit(d, "اعرض الفتوى السابقة كاملة");
      controls.push({
        action: "context cleared on source switch",
        ...capture(d),
      });
      d.querySelector('[data-source="all"]').click();
      await wait(() => !d.querySelector("#submit").disabled);
    }
    for (const [i, c] of cases.entries()) {
      progress.textContent = `${i + 1}/${cases.length}: ${c.question}`;
      const language = c.language || (i < 24 ? "ar" : "en");
      await selectLanguage(d, language);
      const milliseconds = await submit(d, c.question);
      results.push({
        question: c.question,
        language,
        milliseconds,
        ...capture(d),
      });
      out.textContent = JSON.stringify(
        { status: "running", controls, results },
        null,
        2,
      );
    }
    const memory = frame.contentWindow.performance.memory;
    out.textContent = JSON.stringify(
      {
        status: "complete",
        total: results.length,
        controls,
        results,
        memory: memory
          ? {
              usedJSHeapSize: memory.usedJSHeapSize,
              totalJSHeapSize: memory.totalJSHeapSize,
              jsHeapSizeLimit: memory.jsHeapSizeLimit,
              scope:
                "Renderer JavaScript heap only; excludes reliable WASM/physical-device peak measurement",
            }
          : { available: false },
      },
      null,
      2,
    );
    progress.textContent = "Complete";
  } catch (error) {
    out.textContent = JSON.stringify(
      { status: "failed", error: error.message, controls, results },
      null,
      2,
    );
    progress.textContent = "Failed";
  }
  run.disabled = false;
};
