import { normalize } from "./core.mjs?v=0.15.1";

// Shared question/answer compatibility, independent of books, IDs and test queries.
// These describe actions and constraints, not religious conclusions.
const action = (id, ar, en, narrow) => [
  id,
  new RegExp(
    String.raw`(?<![\p{L}])(?:[وفبل]?ال|[وفبل])?(?:${ar})(?:ه|ها|هم)?(?![\p{L}])|\b(?:${en})\b`,
    "iu",
  ),
  narrow,
];
const actions = [
  action(
    "carry",
    "حمل|يحمل|حامل|حيازة|حياز[ةه]|جيب|جيبي|بحوز[ةه]",
    "carry|carrying|possess|possession|pocket",
    true,
  ),
  action(
    "sell",
    "بيع|يبيع|متاجر[ةه]|تجار[ةه]",
    "sell|selling|sale|trade|trading",
    true,
  ),
  action("buy", "شراء|يشتري|اشتري", "buy|buying|purchase|purchasing", true),
  action(
    "consume",
    "شرب|يشرب|اكل|ياكل|تناول|تدخين|يدخن|مضغ",
    "eat|eating|drink|drinking|smoke|smoking|consume|chew",
    false,
  ),
  action("wear", "لبس|يلبس|ارتداء|يرتدي", "wear|wearing|dress", false),
  action(
    "read",
    "قراء[ةه]|يقرا|اقرا|تلاو[ةه]",
    "read|reading|recite|reciting|recitation",
    false,
  ),
  action(
    "listen",
    "استماع|يستمع|سماع|يسمع|انصات|ينصت|اسمع",
    "listen|listening|hearing",
    false,
  ),
  action("touch", "لمس|يلمس|مس المصحف", "touch|touching", true),
  action(
    "delay",
    "تاخير|يوخر|تاجيل",
    "delay|delaying|postpone|postponing",
    true,
  ),
  action("transfer", "نقل|تحويل|يحول", "transfer|transferring|sending", true),
  action(
    "destroy",
    "اتلاف|يتلف|تدمير|سرق[ةه]",
    "destroy|destroying|steal|stealing",
    true,
  ),
  action(
    "borrow",
    "استعار[ةه]|يستعير|استعير|اعار[ةه]",
    "borrow|borrowing|loaning",
    true,
  ),
  action(
    "renew",
    "تجديد|يجدد|تمديد",
    "renew|renewing|renewal|extend|extension",
    true,
  ),
  action(
    "register",
    "تسجيل|يسجل|اسجل|عضوي[ةه]|اشتراك|حجز",
    "register|registration|membership|booking|reservation",
    true,
  ),
];
const constraints = [
  ["coating", /مطلي|مطلية|طلاء|\b(?:plated|plating|coating)\b/iu],
  ["herbal", /نباتي|عشبي|\b(?:herbal|plant-based)\b/iu],
  ["military", /عسكري|العسكر|\bmilitary\b/iu],
  ["non-muslim-audience", /غير المسلمين|للكفار|\bnon-Muslims?\b/iu],
  [
    "digital-device",
    /الحاسب|الحاسوب|الهاتف|الجوال|\b(?:computer|phone|mobile)\b/iu,
  ],
  ["witr", /الوتر|\bwitr\b/iu],
  ["funeral", /الجناز[ةه]|الجنائز|\bfuneral\b/iu],
  ["umrah", /العمر[ةه]|للعمرة|\bumrah\b/iu],
  [
    "forgetfulness",
    /ناسي|نسيان|نسي |\b(?:forget|forgetful|forgot|forgetfulness)\b/iu,
  ],
  ["coercion", /مكره|اكراه|\b(?:coerced|coercion|forced)\b/iu],
  ["necessity", /للضرور|عند الضرور|\b(?:necessity|emergency)\b/iu],
  [
    "pregnancy",
    /(?:ال|لل)حامل|حامل[ةه]|(?:ال|لل)جنين|\b(?:pregnant|pregnancy|foetus|fetus)\b/iu,
  ],
  ["children", /(?:ال|لل)(?:اطفال|صغار|صبي)|\b(?:child|children|minor)\b/iu],
  [
    "travel",
    /مسافر|السفر|\b(?:traveller|traveler|traveling|travelling|journey)\b/iu,
  ],
];
export function questionProfile(text) {
  const q = normalize(text);
  const type =
    /(?:^|\s)كم(?=\s|$)|مقدار|نسب[ةه]|عدد|\b(?:how much|how many|amount|rate|minimum)\b/iu.test(
      q,
    )
      ? "quantity"
      : /متي|وقت|موعد|\b(?:when|time|deadline)\b/iu.test(q)
        ? "time"
        : /لماذا|سبب|\b(?:why|reason)\b/iu.test(q)
          ? "reason"
          : /كيف|طريق[ةه]|اجراء|\b(?:how|procedure|steps)\b/iu.test(q)
            ? "procedure"
            : /تعريف|معني|\b(?:define|definition|meaning)\b/iu.test(q)
              ? "definition"
              : "general";
  return {
    type,
    actions: actions.filter(([, pattern]) => pattern.test(q)).map(([id]) => id),
    constraints: constraints
      .filter(([, pattern]) => pattern.test(q))
      .map(([id]) => id),
  };
}
export function assessIntent(question, unit, { passage = false } = {}) {
  const requested = questionProfile(question);
  const heading = /عنوان غير متاح|untitled/iu.test(unit.title || "")
    ? unit.question || ""
    : unit.title || "";
  // Unstructured private passages have no reliable title; never treat a whole
  // paragraph as a title and classify its incidental verbs as its main action.
  const source = questionProfile(passage ? "" : heading);
  const answer = unit.answer || unit.text || "";
  const supplied = questionProfile((unit.question || "") + " " + answer);
  const reasons = [];
  if (
    requested.actions.length &&
    source.actions.length &&
    !requested.actions.some((id) => source.actions.includes(id))
  )
    reasons.push("different-action");
  if (
    !requested.actions.length &&
    source.actions.length &&
    source.actions.every((id) => actions.find((a) => a[0] === id)[2])
  )
    reasons.push("additional-action");
  if (
    requested.actions.length > 1 &&
    !/(?:^|\s)(?:ام|أم|ولا|or)(?:\s|$)/iu.test(question) &&
    requested.actions.some(
      (id) => !source.actions.includes(id) && !supplied.actions.includes(id),
    )
  )
    reasons.push("missing-requested-action");
  if (source.constraints.some((id) => !requested.constraints.includes(id)))
    reasons.push("narrower-circumstances");
  if (
    requested.constraints.some(
      (id) =>
        !source.constraints.includes(id) && !supplied.constraints.includes(id),
    )
  )
    reasons.push("missing-circumstance");
  if (answer) {
    const a = normalize(answer);
    if (
      requested.type === "time" &&
      source.type !== "time" &&
      questionProfile(unit.question || "").type !== "time" &&
      !/(?:قبل|بعد|خلال|حتي|ابتداء|يبدا|تبدا|ينتهي|تنتهي|تفتح|يفتح|تغلق|يغلق|الساع[ةه]|صباح|مساء|\b(?:before|after|until|within|starts?|ends?|begins?|between)\b)/iu.test(
        a,
      )
    )
      reasons.push("missing-time-relation");
    if (
      requested.type === "reason" &&
      !/لان|بسبب|السبب|سبب|العلة|علة|وذلك|من اجل|حيث|لما |\b(?:because|since|reason|due to|so that)\b/iu.test(
        a,
      )
    )
      reasons.push("missing-explanation");
    if (
      requested.type === "quantity" &&
      !/\d|[٠-٩]|صاع|عشر|نصف|ربع|واحد|اثن|ثلاث|اربع|خمس|ست[ةه]|سبع|ثمان|تسع|كيلو|غرام|جرام|نسب[ةه]|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|half|quarter|percent|sa[’']?|gram|kilogram)\b/iu.test(
        a,
      )
    )
      reasons.push("missing-quantity");
    if (
      requested.type === "time" &&
      !/وقت|يوم|ليل|نهار|شهر|سن[ةه]|عام|ساع|دقيق|قبل|بعد|عند|حين|صباح|مساء|حتي|حول|الاحد|الاثنين|الثلاثاء|الاربعاء|الخميس|الجمع[ةه]|السبت|\b(?:when|before|after|day|week|month|year|hour|minute|morning|evening|until|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/iu.test(
        a,
      )
    )
      reasons.push("missing-time");
  }
  return { kind: reasons.length ? "related" : "direct", reasons, requested };
}
