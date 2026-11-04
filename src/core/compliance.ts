// بوابة الامتثال بالكود (docs/01-logic.md الجزء الخامس): ثماني فحوصات، الكود أولاً والوكيل A11 بعده ولا يخفّف حكم الكود.
// «الوكيل يقترح · الكود يحسب · القواعد تقرر · الإنسان يعتمد». البوابة بترفض وما بتصحح بصمت: البديل بيظهر جنب الرفض.
// دوال صافية بلا قاعدة بيانات: المكتبات بتنعطى كمدخل.

export type Classification = "cosmetic" | "therapeutic" | "needs_review";
export type Verdict = "pass" | "pass_with_edits" | "needs_specialist" | "fail";
export type CheckStatus = "ok" | "edit" | "specialist" | "fail" | "na";

export interface LibClaim {
  id: string;
  phrase: string;
  reason: string;
  alternative: string | null;
  appliesTo: "cosmetic" | "therapeutic" | "all";
  country: string | null;
}
export interface LibIngredient {
  id: string;
  nameAr: string;
  nameEn: string | null;
  status: "allowed" | "restricted" | "banned";
  note: string | null;
  adulterationRisk: string | null;
}
export interface LibText {
  code: string;
  ingredient: string | null;
  text: string;
  reviewStatus: "pending" | "approved" | "rejected" | "needs_specialist";
  usageRule: string | null;
}
export interface LibAdRule {
  rule: string;
  wrongExample: string | null;
  rightExample: string | null;
  lastReviewedAt: Date;
}
export interface LibLicense {
  country: string;
  status: string;
  expiresAt: Date | null;
}
export interface Library {
  claims: LibClaim[];
  ingredients: LibIngredient[];
  texts: LibText[];
  adRules: LibAdRule[];
  licenses: LibLicense[];
}

export interface ComplianceInput {
  stage: "screen" | "full";
  product: { title: string; problem?: string | null; category?: string | null; form?: string | null };
  ingredients: string[];
  claims: string[];
  references: { code: string; usage?: string }[];
  markets: string[];
  declaredClass?: "cosmetic" | "therapeutic" | null;
  organicCertificate?: boolean;
  /** في دفعة معقّمة مفروجة لهالمنتج؟ (من سجل الدفعات) */
  eyeBatchReady?: boolean;
  now?: Date;
}

// ───── تطبيع العربي والمطابقة ─────
export function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "") // تشكيل وتطويل
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[«»"“”'()\[\]{}،,.؟?!:؛;…\-–—_/\\|%·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
const tokens = (s: string) => norm(s).split(" ").filter(Boolean);

// أشكال الكلمة: بدون «و» العطف و«ال» والباء الشامية قبل الفعل (بيعالج ← يعالج) وياء/تاء/نون المضارعة
export function stems(tok: string): string[] {
  const out = new Set<string>([tok]);
  const add = (f: (x: string) => string | null) => {
    for (const x of [...out]) {
      const y = f(x);
      if (y && y.length >= 2) out.add(y);
    }
  };
  add((x) => (x.length > 3 && x.startsWith("و") ? x.slice(1) : null));
  add((x) => (x.length > 4 && /^[بلك]ال/.test(x) ? x.slice(1) : null));
  add((x) => (x.length > 3 && x.startsWith("لل") ? x.slice(2) : null)); // «للعين» = ل + ال + عين
  add((x) => (x.length > 3 && x.startsWith("ال") ? x.slice(2) : null));
  add((x) => (x.length > 4 && /^ب[ينت]/.test(x) ? x.slice(1) : null));
  add((x) => (x.length > 3 && /^[تنا]/.test(x) ? `ي${x.slice(1)}` : null));
  return [...out];
}
const sameStem = (a: string, b: string) => {
  const sb = new Set(stems(b));
  return stems(a).some((x) => sb.has(x));
};

/** هل العبارة (كلمات متتالية) موجودة بالنص؟ */
export function containsPhrase(text: string, phrase: string): boolean {
  const t = tokens(text);
  const p = tokens(phrase);
  if (!p.length || t.length < p.length) return false;
  for (let i = 0; i + p.length <= t.length; i++) {
    if (p.every((w, j) => sameStem(t[i + j], w))) return true;
  }
  return false;
}
const anyPhrase = (text: string, phrases: readonly string[]) => phrases.find((p) => containsPhrase(text, p)) ?? null;

// ───── قوائم الكود ─────
const THERAPEUTIC_WORDS = ["يعالج", "علاج", "يشفي", "شفاء", "يداوي", "دواء", "يقضي على", "يقتل", "يوقف التساقط", "ينبت الشعر", "يزيل الالتهاب"] as const;
const COSMETIC_WORDS = ["ينظف", "تنظيف", "يرطب", "ترطيب", "تعطير", "يعطر", "عنايه", "يحسن مظهر", "حمايه", "يحمي", "ينعم", "تنعيم", "يغذي"] as const;
const SENSITIVE_PLACES = ["عين", "عيون", "اذن", "اذان", "طنين", "داخل الجسم", "جرح"] as const;
const EYE_WORDS = ["عين", "عيون"] as const;
const ORGANIC_WORDS = ["عضوي", "عضويه", "organic"] as const;
const PERSONAL_ATTRIBUTE = /(?:^|\s)(?:عندك|عندكم|هل تعاني|تعاني من|تعبان من|تعبانه من|مصاب ب|مصابه ب)(?:\s|$)/;
const BEFORE_AFTER = /قبل و?بعد/;

const FRAUD_RULES: { label: string; test: (t: string) => boolean }[] = [
  { label: "التفتيح والكلف", test: (t) => !!anyPhrase(t, ["تفتيح", "تبييض", "يبيض", "كلف", "نمش", "يفتح البشره"]) },
  { label: "كريمات الجلد «العشبية»", test: (t) => !!anyPhrase(t, ["كريم", "مرهم"]) && !!anyPhrase(t, ["جلد", "بشره"]) && !!anyPhrase(t, ["عشبي", "عشبيه", "طبيعي", "طبيعيه"]) },
  { label: "منتجات الرجال", test: (t) => !!anyPhrase(t, ["رجال", "رجل", "رجالي", "انتصاب", "يطول", "ذكوره", "الاداء الجنسي"]) },
  { label: "الكحل والإثمد والحناء", test: (t) => !!anyPhrase(t, ["كحل", "اثمد", "حناء", "حنا", "كتم"]) },
  { label: "منتجات العين", test: (t) => !!anyPhrase(t, EYE_WORDS) },
];

// مرادفات إنجليزية للمحظورات (الاسم العربي بالمكتبة هو المفتاح)
const EN_ALIASES: [string, string[]][] = [
  ["زئبق", ["mercury", "calomel"]],
  ["هيدروكينون", ["hydroquinone"]],
  ["كورتيزون", ["cortisone", "clobetasol", "betamethasone", "hydrocortisone", "dexamethasone", "steroid"]],
  ["تريتينوين", ["tretinoin"]],
  ["رصاص", ["lead", "arsenic", "cadmium", "antimony"]],
  ["مضادات الفطريات", ["ketoconazole", "clotrimazole", "terbinafine", "antifungal", "antibiotic"]],
  ["مخدر", ["lidocaine", "benzocaine"]],
  ["سيلدينافيل", ["sildenafil", "tadalafil"]],
  ["ppd", ["paraphenylenediamine", "p-phenylenediamine", "ppd"]],
  ["فورمالدهيد", ["formaldehyde", "formalin"]],
  ["كوجيك", ["kojic"]],
];
const ALIAS_STOP = new Set(["مثل", "مواد", "مضادات", "المضادات", "دوائيه", "الدوائيه", "حيويه", "الحيويه", "مخفيه", "موضعي", "الموضعي", "مركباته", "ومركباته", "علي", "الجلد", "دواء", "ممنوع", "حمض", "بالتركيز", "على"]);

function aliasesOf(ing: LibIngredient): string[] {
  const out = new Set<string>();
  const ar = ing.nameAr;
  const inner = [...ar.matchAll(/\(([^)]*)\)/g)].flatMap((m) => m[1].split(/[·،,]|\s+و/));
  const main = ar.replace(/\([^)]*\)/g, " ");
  for (const part of [...inner, ...main.split(/\s+/)]) {
    for (const w of tokens(part)) if (w.length >= 3 && !ALIAS_STOP.has(w) && !/^(?:مثل|و)$/.test(w)) out.add(w);
  }
  if (ing.nameEn) for (const w of norm(ing.nameEn).split(" ")) if (w.length >= 4) out.add(w);
  const key = norm(ar);
  for (const [k, en] of EN_ALIASES) if (key.includes(k)) en.forEach((e) => out.add(e));
  return [...out];
}
const stemOrPrefix = (a: string, b: string) => {
  if (sameStem(a, b)) return true;
  // جمع/اشتقاق: «كورتيزون» بداية «كورتيزونات»
  const [x, y] = [stems(a), stems(b)];
  return x.some((p) => y.some((q) => Math.min(p.length, q.length) >= 5 && (p.startsWith(q) || q.startsWith(p))));
};
export function ingredientMatches(input: string, ing: LibIngredient): boolean {
  const words = tokens(input);
  return aliasesOf(ing).some((al) => words.some((w) => stemOrPrefix(w, al)));
}

// ───── 2. الادعاءات: قاموس المحظورات بالكود ─────
export interface ClaimPhrase {
  variant: string;
  condition: "always" | "no_certificate" | "cosmetic_only";
}
export function phrasesOf(rule: LibClaim): ClaimPhrase[] {
  const cond = /بلا شهاده|بلا شهادة/.test(rule.phrase) ? "no_certificate" : /لمنتج تجميلي/.test(rule.phrase) ? "cosmetic_only" : "always";
  return rule.phrase
    .split("·")
    .map((v) => v.replace(/\([^)]*\)/g, "").trim())
    .filter((v) => v && v !== "—")
    .map((variant) => ({ variant, condition: cond }));
}

export interface ClaimHit {
  claim: string;
  phrase: string;
  reason: string;
  alternative: string | null;
}
export function scanClaims(claims: string[], rules: LibClaim[], opts: { classification: Classification; markets: string[]; organicCertificate: boolean }): ClaimHit[] {
  const hits: ClaimHit[] = [];
  const countries = new Set(opts.markets.map((m) => m.toUpperCase()));
  for (const claim of claims) {
    for (const r of rules) {
      if (r.appliesTo !== "all" && opts.classification !== "needs_review" && r.appliesTo !== opts.classification) continue;
      if (r.country && !countries.has(r.country.toUpperCase())) continue;
      for (const p of phrasesOf(r)) {
        if (p.condition === "no_certificate" && opts.organicCertificate) continue;
        if (p.condition === "cosmetic_only" && opts.classification !== "cosmetic") continue;
        if (containsPhrase(claim, p.variant)) {
          hits.push({ claim, phrase: p.variant, reason: r.reason, alternative: r.alternative });
          break;
        }
      }
    }
  }
  return hits;
}

// ───── 1. التصنيف (docs الجزء الخامس قسم 6) ─────
export interface Classified {
  classification: Classification;
  reason: string;
  sensitive: boolean;
  medicinal: string[];
  therapeuticClaims: string[];
}
export function classify(text: string, ingredientHits: { name: string; status: string; note: string | null }[]): Classified {
  const medicinal = ingredientHits.filter((i) => (i.status === "banned" || i.status === "restricted") && /دواء|دوائي|غش دوائي/.test(i.note ?? "")).map((i) => i.name);
  const sensitive = !!anyPhrase(text, SENSITIVE_PLACES);
  const therapeuticClaims = THERAPEUTIC_WORDS.filter((w) => containsPhrase(text, w));
  if (medicinal.length) return { classification: "therapeutic", reason: `فيه مادة دوائية: ${medicinal.join(" · ")}`, sensitive, medicinal, therapeuticClaims };
  if (sensitive) return { classification: "therapeutic", reason: "المكان حساس (عين · أذن · داخل الجسم · جرح): علاجي أو جهاز طبي", sensitive, medicinal, therapeuticClaims };
  if (therapeuticClaims.length) return { classification: "therapeutic", reason: `الادعاء علاجي: «${therapeuticClaims.join(" · ")}»`, sensitive, medicinal, therapeuticClaims };
  if (anyPhrase(text, COSMETIC_WORDS)) return { classification: "cosmetic", reason: "تنظيف · ترطيب · عناية · تحسين مظهر", sensitive, medicinal, therapeuticClaims };
  return { classification: "needs_review", reason: "بين وبين: بيوقف لقرار مراجع الامتثال", sensitive, medicinal, therapeuticClaims };
}

// ───── النتيجة ─────
export interface CheckResult {
  n: number;
  key: string;
  label: string;
  status: CheckStatus;
  detail: string;
}
export interface ClaimOut {
  text: string;
  status: "allowed" | "banned" | "edit";
  phrase?: string;
  reason?: string;
  alternative: string | null;
  source: "code" | "agent";
}
export interface IngredientOut {
  name: string;
  status: "allowed" | "restricted" | "banned" | "unknown";
  note: string | null;
  libraryName?: string;
}
export interface RefOut {
  code: string;
  status: "approved_ok" | "needs_specialist" | "rejected" | "not_in_library" | "misused";
  usage: string;
  note?: string;
}
export interface LicenseOut {
  country: string;
  state: "exists" | "required" | "not_needed";
}
export interface ComplianceResult {
  stage: "screen" | "full";
  classification: Classification;
  classification_reason: string;
  verdict: Verdict;
  reasons: string[];
  checks: CheckResult[];
  claims: ClaimOut[];
  allowed_claims: string[];
  ingredients: IngredientOut[];
  references: { code: string; usage: string }[];
  refs: RefOut[];
  eye: boolean;
  sensitive: boolean;
  fraud_categories: string[];
  licenses: LicenseOut[];
  ad_rules: string[];
  stale_rules: string[];
  organic: "none" | "certified" | "uncertified";
  agent: { used: boolean; error?: string };
  input: { title: string; claims: string[]; ingredients: string[]; markets: string[]; declaredClass: string | null };
}

const SEVERITY: Record<CheckStatus, number> = { na: 0, ok: 0, edit: 1, specialist: 2, fail: 3 };
export const worstStatus = (a: CheckStatus, b: CheckStatus): CheckStatus => (SEVERITY[a] >= SEVERITY[b] ? a : b);

const VERDICT_RANK: Record<Verdict, number> = { pass: 0, pass_with_edits: 1, needs_specialist: 2, fail: 3 };
export const worstVerdict = (a: Verdict, b: Verdict): Verdict => (VERDICT_RANK[a] >= VERDICT_RANK[b] ? a : b);

export function verdictOf(checks: { status: CheckStatus }[]): Verdict {
  const worst = checks.reduce<CheckStatus>((w, c) => worstStatus(w, c.status), "ok");
  return worst === "fail" ? "fail" : worst === "specialist" ? "needs_specialist" : worst === "edit" ? "pass_with_edits" : "pass";
}

const STALE_DAYS = 90;
const LICENSE_OK_STATUS = new Set(["active", "فعّال", "فعال"]);

export function licenseState(country: string, licenses: LibLicense[], now: Date): "exists" | "expired_or_pending" | "none" {
  const mine = licenses.filter((l) => l.country.toUpperCase() === country.toUpperCase());
  if (!mine.length) return "none";
  const valid = mine.some((l) => LICENSE_OK_STATUS.has(l.status) && (!l.expiresAt || l.expiresAt.getTime() > now.getTime()));
  return valid ? "exists" : "expired_or_pending";
}

/** الفحوصات الثمانية بالكود. الوكيل بينضاف بعدها بـ applyAgent وما بيخفّف شي. */
export function runCodeChecks(input: ComplianceInput, lib: Library): ComplianceResult {
  const now = input.now ?? new Date();
  const claimTexts = input.claims.map((c) => c.trim()).filter(Boolean);
  const allText = [input.product.title, input.product.problem ?? "", input.product.category ?? "", input.product.form ?? "", ...claimTexts, ...input.ingredients].join(" . ");
  const reasons: string[] = [];
  const checks: CheckResult[] = [];
  const push = (n: number, key: string, label: string, status: CheckStatus, detail: string) => {
    checks.push({ n, key, label, status, detail });
    if (status !== "ok" && status !== "na") reasons.push(`${label}: ${detail}`);
  };

  // 4 (بنحسبه أول لأن التصنيف بيعتمد عليه): المكونات
  const ingredients: IngredientOut[] = input.ingredients
    .map((s) => s.trim())
    .filter(Boolean)
    .map((name) => {
      const hit = lib.ingredients.find((l) => ingredientMatches(name, l));
      if (!hit) return { name, status: "unknown" as const, note: "مش بالمكتبة: بيوقف للمراجعة" };
      return { name, status: hit.status, note: hit.note, libraryName: hit.nameAr };
    });

  // 1. التصنيف
  const cls = classify(allText, ingredients.map((i) => ({ name: i.libraryName ?? i.name, status: i.status, note: i.note })));
  const declared = input.declaredClass ?? null;
  const conflictCosmetic = declared === "cosmetic" && (cls.medicinal.length > 0 || cls.therapeuticClaims.length > 0);
  let classification: Classification = cls.classification;
  if (declared === "cosmetic" && !conflictCosmetic && cls.classification === "therapeutic") classification = "cosmetic"; // مكان حساس بس (مثل الكحل): بيضل تجميلي ومعلّم حساس
  if (declared === "therapeutic" && cls.classification !== "therapeutic") classification = "therapeutic";
  if (declared === "cosmetic" && conflictCosmetic) {
    push(1, "classification", "التصنيف", "fail", `منتج مسجّل تجميلي بادعاء علاجي (${cls.reason}): مخالفة تسجيل وسبب رفض إعلانات`);
  } else if (classification === "needs_review") {
    push(1, "classification", "التصنيف", "specialist", cls.reason);
  } else if (classification === "therapeutic" && !declared) {
    push(1, "classification", "التصنيف", "specialist", `علاجي (${cls.reason}): مسار تسجيل دواء أو مكمّل بقرار المختص`);
  } else {
    push(1, "classification", "التصنيف", "ok", `${classification === "cosmetic" ? "تجميلي" : "علاجي (مسار مسجّل)"}: ${cls.reason}`);
  }

  // 2. الادعاءات
  const hits = scanClaims(claimTexts, lib.claims, { classification, markets: input.markets, organicCertificate: Boolean(input.organicCertificate) });
  const bannedTexts = new Set(hits.map((h) => h.claim));
  const personal = claimTexts.filter((c) => PERSONAL_ATTRIBUTE.test(norm(c)) || BEFORE_AFTER.test(norm(c)));
  const claims: ClaimOut[] = claimTexts.map((text) => {
    const h = hits.find((x) => x.claim === text);
    if (h) return { text, status: "banned", phrase: h.phrase, reason: h.reason, alternative: h.alternative, source: "code" };
    return { text, status: "allowed", alternative: null, source: "code" };
  });
  if (hits.length) push(2, "claims", "الادعاءات", "fail", hits.map((h) => `«${h.claim}» ممنوع (${h.reason})${h.alternative ? ` — البديل: ${h.alternative}` : ""}`).join(" | "));
  else push(2, "claims", "الادعاءات", claimTexts.length ? "ok" : "na", claimTexts.length ? "ولا ادعاء ممنوع بالقاموس" : "ما في ادعاءات للفحص بعد");

  // 3. النصوص المرجعية: المقترحة بالرمز + أي نص من المكتبة منقول بحرفه داخل الادعاءات
  const quoted = lib.texts.filter((t) => claimTexts.some((c) => norm(c).includes(norm(t.text))));
  const codes = new Map<string, string>();
  for (const r of input.references) codes.set(r.code, r.usage ?? "");
  for (const t of quoted) if (!codes.has(t.code)) codes.set(t.code, "");
  const refs: RefOut[] = [];
  for (const [code, usage] of codes) {
    const t = lib.texts.find((x) => x.code === code);
    if (!t) {
      refs.push({ code, status: "not_in_library", usage, note: "مش بالمكتبة المعتمدة" });
    } else if (t.reviewStatus === "approved") {
      const misused = claimTexts.some((c) => norm(c).includes(norm(t.text)) && !!anyPhrase(c, THERAPEUTIC_WORDS));
      refs.push(misused ? { code, status: "misused", usage, note: "النص مستعمل كوعد عن المنتج مش عن المادة" } : { code, status: "approved_ok", usage: usage || t.usageRule || "عن المادة" });
    } else if (t.reviewStatus === "rejected") {
      refs.push({ code, status: "rejected", usage, note: "رفضه المراجع الشرعي" });
    } else {
      refs.push({ code, status: "needs_specialist", usage, note: t.reviewStatus === "pending" ? "بانتظار المراجع الشرعي" : "يوقف لقرار مختص" });
    }
  }
  const refFail = refs.filter((r) => r.status === "rejected" || r.status === "not_in_library" || r.status === "misused");
  const refWait = refs.filter((r) => r.status === "needs_specialist");
  if (refFail.length) push(3, "texts", "النصوص المرجعية", "fail", refFail.map((r) => `${r.code}: ${r.note}`).join(" | "));
  else if (refWait.length) push(3, "texts", "النصوص المرجعية", "specialist", refWait.map((r) => `${r.code}: ${r.note}`).join(" | "));
  else push(3, "texts", "النصوص المرجعية", refs.length ? "ok" : "na", refs.length ? "كل النصوص معتمدة وبحرفها وعن المادة" : "ما في نصوص مرجعية");

  // 4. المكونات
  const bad = ingredients.filter((i) => i.status === "banned");
  const restricted = ingredients.filter((i) => i.status === "restricted");
  const unknown = ingredients.filter((i) => i.status === "unknown");
  if (bad.length) push(4, "ingredients", "المكونات", "fail", `محظور: ${bad.map((i) => i.libraryName ?? i.name).join(" · ")}`);
  else if (restricted.length) push(4, "ingredients", "المكونات", "specialist", `مقيّد بشروط: ${restricted.map((i) => i.libraryName ?? i.name).join(" · ")}`);
  else if (unknown.length) push(4, "ingredients", "المكونات", "specialist", `مش معروف بالمكتبة: ${unknown.map((i) => i.name).join(" · ")}`);
  else push(4, "ingredients", "المكونات", ingredients.length ? "ok" : "na", ingredients.length ? "كلها سليمة" : "التركيبة لسا ما انحددت (بتنفحص بالبحث المعمّق)");

  // 5. «عضوي»
  const organicWord = !!anyPhrase(allText, ORGANIC_WORDS);
  const organic: ComplianceResult["organic"] = !organicWord ? "none" : input.organicCertificate ? "certified" : "uncertified";
  if (organic === "uncertified") push(5, "organic", "«عضوي»", "fail", "«عضوي» بلا شهادة معتمدة (COSMOS · ECOCERT · USDA) — البديل: «طبيعي» بنسبة المكونات الطبيعية الحقيقية");
  else push(5, "organic", "«عضوي»", organic === "certified" ? "ok" : "na", organic === "certified" ? "بشهادة معتمدة" : "ما انذكرت");

  // 6. منتجات العين
  const eye = !!anyPhrase(allText, EYE_WORDS);
  if (eye) {
    if (input.eyeBatchReady) push(6, "eye", "منتجات العين", "ok", "في دفعة معقّمة ومفحوصة ومفروجة");
    else push(6, "eye", "منتجات العين", "specialist", "ناقص: تصنيع معقّم وفحص دفعة قبل التوزيع (ما في دفعة مفروجة)");
  } else push(6, "eye", "منتجات العين", "na", "مش منتج عين");

  // 7. الترخيص بكل بلد
  const fraud = FRAUD_RULES.filter((f) => f.test(allText)).map((f) => f.label);
  const needsLicense = classification === "therapeutic" || eye || cls.sensitive || fraud.length > 0;
  const licenses: LicenseOut[] = input.markets.map((country) => {
    const s = licenseState(country, lib.licenses, now);
    if (s === "exists") return { country, state: "exists" as const };
    return { country, state: needsLicense ? ("required" as const) : ("not_needed" as const) };
  });
  const missingLic = licenses.filter((l) => l.state === "required");
  if (missingLic.length) push(7, "license", "الترخيص", "specialist", `مطلوب ومش موجود: ${missingLic.map((l) => l.country).join(" · ")}`);
  else push(7, "license", "الترخيص", input.markets.length ? "ok" : "na", input.markets.length ? "موجود أو مش لازم" : "ما انحدد سوق");

  // 8. قواعد الإعلانات
  const adHits = [...new Set([...personal])];
  const stale = lib.adRules.filter((r) => now.getTime() - r.lastReviewedAt.getTime() > STALE_DAYS * 86_400_000).map((r) => r.rule);
  if (adHits.length) {
    const personalRule = lib.adRules.find((r) => /مخاطبة الشخص بحالته/.test(r.rule));
    push(8, "ad_rules", "قواعد الإعلانات", "fail", `${adHits.map((c) => `«${c}»`).join(" · ")} بيخاطب الشخص بحالته أو بيعرض قبل وبعد${personalRule?.rightExample ? ` — الصح: ${personalRule.rightExample}` : ""}`);
  } else push(8, "ad_rules", "قواعد الإعلانات", "ok", stale.length ? `${stale.length} قاعدة ما انراجعت من ${STALE_DAYS} يوم: راجعها قبل الإطلاق` : "القواعد الحالية بتنتقل مع البريف");
  for (const c of adHits) {
    const i = claims.findIndex((x) => x.text === c);
    if (i >= 0 && claims[i].status === "allowed" && !bannedTexts.has(c)) claims[i] = { text: c, status: "banned", reason: "بيخاطب الشخص بحالته الصحية أو قبل وبعد", alternative: lib.adRules.find((r) => /مخاطبة الشخص بحالته/.test(r.rule))?.rightExample ?? null, source: "code" };
  }

  const verdict = verdictOf(checks);
  const refsOut = refs.filter((r) => r.status === "approved_ok").map((r) => ({ code: r.code, usage: r.usage }));
  return {
    stage: input.stage,
    classification,
    classification_reason: cls.reason,
    verdict,
    reasons,
    checks: checks.sort((a, b) => a.n - b.n),
    claims,
    allowed_claims: claims.filter((c) => c.status === "allowed").map((c) => c.text),
    ingredients,
    references: refsOut,
    refs,
    eye,
    sensitive: cls.sensitive,
    fraud_categories: fraud,
    licenses,
    ad_rules: lib.adRules.map((r) => r.rule),
    stale_rules: stale,
    organic,
    agent: { used: false },
    input: { title: input.product.title, claims: claimTexts, ingredients: input.ingredients, markets: input.markets, declaredClass: declared },
  };
}

// ───── رأي الوكيل A11: بيزوّد وما بيخفّف ─────
export interface AgentOpinion {
  classification: Classification;
  classification_reason: string;
  claims: { text: string; status: "allowed" | "banned" | "edit"; alternative: string | null }[];
  references: { code: string; status: "approved_ok" | "needs_specialist" | "not_in_library"; usage_ok: boolean }[];
  ingredients: { name: string; status: "allowed" | "restricted" | "banned"; note: string | null }[];
  organic_ok: boolean | null;
  eye_product: boolean;
  license_needed: { country: string; type: string }[];
  ad_rules: string[];
  verdict: Verdict;
  reasons: string[];
}

export function applyAgent(base: ComplianceResult, a: AgentOpinion): ComplianceResult {
  const r: ComplianceResult = JSON.parse(JSON.stringify(base));
  r.agent = { used: true };
  const extra: string[] = [];
  const bump = (key: string, status: CheckStatus, detail: string) => {
    const c = r.checks.find((x) => x.key === key);
    if (!c) return;
    c.status = worstStatus(c.status === "na" ? "ok" : c.status, status);
    c.detail = c.detail ? `${c.detail} | الوكيل: ${detail}` : `الوكيل: ${detail}`;
    extra.push(`${c.label} (الوكيل): ${detail}`);
  };

  if (a.classification !== r.classification) {
    // الكود رفض التصنيف أصلاً (مثل تجميلي بادعاء علاجي): بنخلي تصنيف الكود ونسجّل الاختلاف بس. غير هيك الاختلاف بيوقف لقرار المراجع.
    const codeFailed = r.checks.find((c) => c.key === "classification")?.status === "fail";
    if (!codeFailed) {
      r.classification = "needs_review";
      r.classification_reason = `${r.classification_reason} — الوكيل رأى «${a.classification}»: اختلاف بيوقف لقرار مراجع الامتثال`;
    }
    bump("classification", "specialist", `اختلف بالتصنيف (${a.classification_reason})`);
  }
  for (const c of a.claims) {
    if (c.status === "allowed") continue;
    const mine = r.claims.find((x) => x.text === c.text);
    if (mine && mine.status === "banned") continue; // الكود أول
    if (mine) {
      mine.status = c.status === "banned" ? "banned" : "edit";
      mine.alternative = c.alternative;
      mine.source = "agent";
    } else r.claims.push({ text: c.text, status: c.status === "banned" ? "banned" : "edit", alternative: c.alternative, source: "agent" });
    bump("claims", c.status === "banned" ? "fail" : "edit", `«${c.text}» ${c.status === "banned" ? "ممنوع" : "بيحتاج تعديل"}${c.alternative ? ` — البديل: ${c.alternative}` : ""}`);
  }
  r.allowed_claims = r.claims.filter((c) => c.status === "allowed").map((c) => c.text);
  for (const ref of a.references) {
    if (ref.status === "not_in_library") bump("texts", "fail", `${ref.code}: مش بالمكتبة`);
    else if (ref.status === "needs_specialist") bump("texts", "specialist", `${ref.code}: بيوقف لقرار مختص`);
    else if (!ref.usage_ok) bump("texts", "fail", `${ref.code}: استعمال النص مش عن المادة`);
  }
  r.references = r.references.filter((x) => !a.references.some((y) => y.code === x.code && (y.status !== "approved_ok" || !y.usage_ok)));
  for (const i of a.ingredients) {
    if (i.status === "banned") bump("ingredients", "fail", `${i.name} محظور${i.note ? ` (${i.note})` : ""}`);
    else if (i.status === "restricted") bump("ingredients", "specialist", `${i.name} مقيّد${i.note ? ` (${i.note})` : ""}`);
  }
  if (a.organic_ok === false) bump("organic", "fail", "«عضوي» بلا شهادة");
  if (a.eye_product && !r.eye) {
    r.eye = true;
    bump("eye", "specialist", "منتج عين: تعقيم وفحص دفعة");
  }
  for (const l of a.license_needed) {
    const lic = r.licenses.find((x) => x.country.toUpperCase() === l.country.toUpperCase());
    if (lic && lic.state === "not_needed") {
      lic.state = "required";
      bump("license", "specialist", `${l.country}: مطلوب (${l.type})`);
    }
  }
  r.verdict = worstVerdict(verdictOf(r.checks), a.verdict);
  const agentWorse = VERDICT_RANK[a.verdict] > VERDICT_RANK[verdictOf(r.checks)];
  r.reasons = [...r.reasons, ...extra, ...a.reasons.map((x) => `الوكيل: ${x}`)];
  if (agentWorse && !a.reasons.length) r.reasons.push(`الوكيل: حكمه «${a.verdict}»`);
  r.reasons = [...new Set(r.reasons)];
  return r;
}

/** الوكيل متوقف: الفحص المبدئي بيكمل بالكود، والكامل ما بيعدّي بدون رأيه. */
export function agentUnavailable(base: ComplianceResult, why: string): ComplianceResult {
  const r: ComplianceResult = JSON.parse(JSON.stringify(base));
  r.agent = { used: false, error: why };
  if (r.stage === "full") {
    r.verdict = worstVerdict(r.verdict, "needs_specialist");
    r.reasons.push("حارس الامتثال (الوكيل) متوقف: الفحص الكامل بيحتاج رأيه، بيوقف لقرار مختص");
  } else {
    r.reasons.push("رأي الوكيل ناقص: الفحص المبدئي بالكود بس");
  }
  return r;
}

/** الحكم الفعلي: قرار الإنسان إذا وُجد. الرفض بالكود ما بينقلب بقرار إنسان (لازم تصحيح المدخلات وإعادة الفحص). */
export function effectiveVerdict(c: { verdict: Verdict; humanVerdict: Verdict | null }): Verdict {
  return c.humanVerdict ?? c.verdict;
}

export class ReviewRefused extends Error {}
export function assertReviewAllowed(c: { verdict: Verdict }, human: Verdict, pendingTexts: string[]): void {
  if (c.verdict === "fail" && human !== "fail") throw new ReviewRefused("الفحص انرفض بالكود: صحّح المدخلات وأعد الفحص، ما بينقلب بقرار");
  if ((human === "pass" || human === "pass_with_edits") && pendingTexts.length) throw new ReviewRefused(`في نصوص ما اعتمدها المراجع الشرعي: ${pendingTexts.join(" · ")}`);
}
