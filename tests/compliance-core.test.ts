// بوابة الامتثال بالكود: الفحوصات الثمانية وبوابات الجودة. المكتبات من ملف البذور (بلا قاعدة بيانات).
import { describe, expect, it } from "vitest";
import {
  applyAgent, agentUnavailable, assertReviewAllowed, containsPhrase, effectiveVerdict, ingredientMatches, licenseState, norm, phrasesOf, runCodeChecks, ReviewRefused,
  type AgentOpinion, type ComplianceInput, type Library,
} from "../src/core/compliance";
import { ingredientStatusOf, loadSeedData, reviewStatusOf } from "../src/seeds/import";

const seed = loadSeedData();
const dash = (s: string | null | undefined) => (!s || s === "—" ? null : s);

function lib(over: Partial<Library> = {}): Library {
  return {
    claims: seed.claims.map((c: { phrase: string; reason: string; alternative: string }, i: number) => ({ id: `c${i}`, phrase: c.phrase, reason: c.reason, alternative: dash(c.alternative), appliesTo: "all" as const, country: null })),
    ingredients: [
      ...seed.ingredients.map((x: { nameAr: string; nameEn: string }, i: number) => ({ id: `i${i}`, nameAr: x.nameAr, nameEn: x.nameEn, status: "allowed" as const, note: null, adulterationRisk: null })),
      ...seed.banned.map((b: { nameAr: string; statusRaw: string; why: string; fraudWhere: string }, i: number) => ({ id: `b${i}`, nameAr: b.nameAr, nameEn: null, status: ingredientStatusOf(b.statusRaw), note: `${b.statusRaw}${b.why ? ` — ${b.why}` : ""}`, adulterationRisk: dash(b.fraudWhere) })),
    ],
    texts: seed.referenceTexts.map((t: { code: string; ingredient: string; text: string; reviewRaw: string }) => ({ code: t.code, ingredient: t.ingredient, text: t.text, reviewStatus: reviewStatusOf(t.reviewRaw), usageRule: null })),
    adRules: seed.adRules.map((a: { rule: string; wrong: string; right: string }) => ({ rule: a.rule, wrongExample: a.wrong, rightExample: a.right, lastReviewedAt: new Date("2026-10-01T00:00:00Z") })),
    licenses: [],
    ...over,
  };
}
const NOW = new Date("2026-11-04T00:00:00Z");
const input = (over: Partial<ComplianceInput> = {}): ComplianceInput => ({
  stage: "full",
  product: { title: "زيت ترطيب للشعر", problem: "تساقط الشعر" },
  ingredients: ["زيت الزيتون"],
  claims: ["بيرطّب الشعر ويعطيه لمعة"],
  references: [],
  markets: [],
  declaredClass: "cosmetic",
  now: NOW,
  ...over,
});
const status = (r: ReturnType<typeof runCodeChecks>, key: string) => r.checks.find((c) => c.key === key)!.status;

describe("تطبيع ومطابقة العربي", () => {
  it("التشكيل والهمزات والتاء المربوطة بتتطبّع", () => {
    expect(norm("«ماء زمزم لما شُرب له»")).toBe("ماء زمزم لما شرب له");
    expect(norm("أعالجُ")).toBe("اعالج");
  });
  it("اللهجة الشامية: «بيعالج» و«بتشفي» بتطابق «يعالج» و«يشفي»", () => {
    expect(containsPhrase("منتج بيعالج الفطريات", "يعالج")).toBe(true);
    expect(containsPhrase("الكريم بتشفي الجلد", "يشفي")).toBe(true);
    expect(containsPhrase("بيرطّب الشعر", "يعالج")).toBe(false);
  });
  it("عبارة بعدة كلمات لازم تكون متتالية", () => {
    expect(containsPhrase("بيقضي على الفطريات تماماً", "يقضي على الفطريات")).toBe(true);
    expect(containsPhrase("يقضي الوقت على الفطريات", "يقضي على الفطريات")).toBe(false);
  });
  it("عبارات القاموس بتنقسم على «·» والأقواس شروط مش جزء من العبارة", () => {
    const p = phrasesOf({ id: "x", phrase: "طبي · صيدلاني (لمنتج تجميلي)", reason: "", alternative: null, appliesTo: "all", country: null });
    expect(p.map((x) => x.variant)).toEqual(["طبي", "صيدلاني"]);
    expect(p.every((x) => x.condition === "cosmetic_only")).toBe(true);
  });
  it("المكونات المحظورة بتنعرف بالعربي والإنجليزي والجمع", () => {
    const l = lib().ingredients;
    const find = (s: string) => l.find((i) => ingredientMatches(s, i))?.nameAr;
    expect(find("زئبق 2%")).toContain("الزئبق");
    expect(find("Hydroquinone 4%")).toContain("الهيدروكينون");
    expect(find("كورتيزون")).toContain("الكورتيزونات");
    expect(find("clobetasol")).toContain("الكورتيزونات");
    expect(find("Lidocaine")).toContain("المخدّر");
    expect(find("زيت الزيتون")).toContain("زيت الزيتون");
  });
});

describe("بوابات الجودة المكتوبة بالخطة", () => {
  it("«بيعالج الفطريات» على منتج تجميلي بينرفض مع بديله", () => {
    const r = runCodeChecks(input({ product: { title: "كريم للقدم" }, claims: ["بيعالج الفطريات"] }), lib());
    expect(r.verdict).toBe("fail");
    expect(status(r, "claims")).toBe("fail");
    const c = r.claims.find((x) => x.text === "بيعالج الفطريات")!;
    expect(c.status).toBe("banned");
    expect(c.alternative).toBeTruthy(); // البديل بيظهر، ما بينصحّح بصمت
    expect(r.allowed_claims).not.toContain("بيعالج الفطريات");
    expect(status(r, "classification")).toBe("fail"); // تجميلي مسجّل بادعاء علاجي
  });

  it("نص زمزم ما بيمرّ بلا قرار (بالرمز)", () => {
    const r = runCodeChecks(input({ references: [{ code: "REF-09", usage: "عن المادة" }] }), lib());
    expect(status(r, "texts")).toBe("specialist");
    expect(r.verdict).toBe("needs_specialist");
    expect(r.references.map((x) => x.code)).not.toContain("REF-09");
  });

  it("نص زمزم منقول بحرفه داخل الادعاء بيوقف كمان حتى بلا رمز", () => {
    const r = runCodeChecks(input({ claims: ["ماء زمزم لما شُرب له"] }), lib());
    expect(r.refs.map((x) => x.code)).toContain("REF-09");
    expect(r.verdict).not.toBe("pass");
  });

  it("نص بانتظار المراجع الشرعي ما بيدخل، وبعد الاعتماد بيمرّ عن المادة بس", () => {
    const pending = runCodeChecks(input({ references: [{ code: "REF-01" }] }), lib());
    expect(status(pending, "texts")).toBe("specialist");
    const approved = lib();
    approved.texts = approved.texts.map((t) => (t.code === "REF-01" ? { ...t, reviewStatus: "approved" as const } : t));
    const ok = runCodeChecks(input({ references: [{ code: "REF-01", usage: "عن المادة" }] }), approved);
    expect(status(ok, "texts")).toBe("ok");
    expect(ok.references).toEqual([{ code: "REF-01", usage: "عن المادة" }]);
    // نفس النص المعتمد لكن كوعد عن المنتج
    const misuse = runCodeChecks(input({ claims: ["الكمأة من المنّ، وماؤها شفاء للعين"], references: [{ code: "REF-01" }] }), approved);
    expect(status(misuse, "texts")).toBe("fail");
  });

  it("رمز مش بالمكتبة = مرفوض", () => {
    const r = runCodeChecks(input({ references: [{ code: "REF-99" }] }), lib());
    expect(status(r, "texts")).toBe("fail");
  });

  it("مكوّن محظور = رفض، ومش معروف = بيوقف للمراجعة، ومقيّد = بيوقف", () => {
    expect(status(runCodeChecks(input({ ingredients: ["زئبق"] }), lib()), "ingredients")).toBe("fail");
    expect(status(runCodeChecks(input({ ingredients: ["مستخلص غريب 77"] }), lib()), "ingredients")).toBe("specialist");
    expect(status(runCodeChecks(input({ ingredients: ["formaldehyde"] }), lib()), "ingredients")).toBe("specialist");
    expect(runCodeChecks(input({ ingredients: ["كلوبيتاسول"] }), lib()).verdict).toBe("fail");
  });

  it("مادة دوائية بتحوّل المنتج لعلاجي، ومسجّل تجميلي = رفض", () => {
    const r = runCodeChecks(input({ ingredients: ["كورتيزون"] }), lib());
    expect(r.classification).toBe("therapeutic");
    expect(status(r, "classification")).toBe("fail");
  });

  it("«عضوي» بلا شهادة بيرفض، وبالشهادة بيمرّ", () => {
    const no = runCodeChecks(input({ claims: ["زيت عضوي 100%"] }), lib());
    expect(status(no, "organic")).toBe("fail");
    expect(no.verdict).toBe("fail");
    const yes = runCodeChecks(input({ claims: ["زيت عضوي معتمد"], organicCertificate: true }), lib());
    expect(status(yes, "organic")).toBe("ok");
    expect(status(yes, "claims")).toBe("ok");
  });

  it("إعلان بيخاطب الشخص بحالته (ميتا) بينرفض مع الصياغة الصح", () => {
    const r = runCodeChecks(input({ claims: ["عندك طنين؟ جرّب هالقطرة"] }), lib());
    expect(status(r, "ad_rules")).toBe("fail");
    expect(r.checks.find((c) => c.key === "ad_rules")!.detail).toContain("الطنين بيزعج كتير ناس");
    const ba = runCodeChecks(input({ claims: ["صور قبل وبعد التنحيف"] }), lib());
    expect(status(ba, "ad_rules")).toBe("fail");
  });

  it("منتج العين: ما بيمرّ بلا دفعة معقّمة مفروجة", () => {
    const base = input({ product: { title: "قطرة ماء الكمأة للعين" }, declaredClass: "therapeutic", claims: ["مستوحى من الكمأة"] });
    const r = runCodeChecks(base, lib());
    expect(r.eye).toBe(true);
    expect(status(r, "eye")).toBe("specialist");
    expect(r.verdict).not.toBe("pass");
    const ready = runCodeChecks({ ...base, eyeBatchReady: true }, lib());
    expect(status(ready, "eye")).toBe("ok");
  });

  it("الترخيص: مطلوب للعلاجي والعين وفئات الغش، وموجود بيمرّ، والتجميلي العادي مش لازم", () => {
    const eye = input({ product: { title: "قطرة للعين" }, declaredClass: "therapeutic", markets: ["JO"], eyeBatchReady: true });
    expect(runCodeChecks(eye, lib()).licenses).toEqual([{ country: "JO", state: "required" }]);
    const active = lib({ licenses: [{ country: "JO", status: "active", expiresAt: new Date("2027-01-01") }] });
    expect(runCodeChecks(eye, active).licenses).toEqual([{ country: "JO", state: "exists" }]);
    const expired = lib({ licenses: [{ country: "JO", status: "active", expiresAt: new Date("2026-01-01") }] });
    expect(runCodeChecks(eye, expired).licenses[0].state).toBe("required");
    expect(licenseState("JO", expired.licenses, NOW)).toBe("expired_or_pending");
    expect(runCodeChecks(input({ markets: ["SY"] }), lib()).licenses).toEqual([{ country: "SY", state: "not_needed" }]);
    expect(runCodeChecks(input({ product: { title: "كريم تفتيح" }, markets: ["SY"] }), lib()).fraud_categories).toContain("التفتيح والكلف");
  });

  it("منتج نظيف تجميلي بيمرّ", () => {
    const r = runCodeChecks(input(), lib());
    expect(r.verdict).toBe("pass");
    expect(r.reasons).toEqual([]);
    expect(r.allowed_claims).toEqual(["بيرطّب الشعر ويعطيه لمعة"]);
    expect(r.checks).toHaveLength(8);
  });

  it("تصنيف «بين وبين» بيوقف لقرار المراجع", () => {
    const r = runCodeChecks(input({ product: { title: "منتج جديد" }, claims: [], ingredients: [], declaredClass: null }), lib());
    expect(r.classification).toBe("needs_review");
    expect(r.verdict).toBe("needs_specialist");
  });

  it("قواعد الإعلانات القديمة بتنذكر بالتفصيل بلا ما تغيّر الحكم", () => {
    const r = runCodeChecks(input({ now: new Date("2027-03-01T00:00:00Z") }), lib());
    expect(r.stale_rules.length).toBe(10);
    expect(r.verdict).toBe("pass");
  });
});

describe("الوكيل A11 بيزوّد وما بيخفّف", () => {
  const opinion = (over: Partial<AgentOpinion> = {}): AgentOpinion => ({
    classification: "cosmetic", classification_reason: "تجميلي", claims: [], references: [], ingredients: [], organic_ok: null, eye_product: false, license_needed: [], ad_rules: [], verdict: "pass", reasons: [], ...over,
  });

  it("الكود رفض والوكيل قال pass = بيضل مرفوض", () => {
    const base = runCodeChecks(input({ ingredients: ["زئبق"] }), lib());
    expect(applyAgent(base, opinion()).verdict).toBe("fail");
  });
  it("الوكيل بيلاقي ادعاء بيحتاج تعديل = مقبول بتعديلات مع البديل", () => {
    const base = runCodeChecks(input(), lib());
    const r = applyAgent(base, opinion({ claims: [{ text: base.input.claims[0], status: "edit", alternative: "بيعطي إحساس بالنعومة" }], verdict: "pass_with_edits", reasons: ["مبالغة بسيطة"] }));
    expect(r.verdict).toBe("pass_with_edits");
    expect(r.claims[0]).toMatchObject({ status: "edit", alternative: "بيعطي إحساس بالنعومة", source: "agent" });
    expect(r.allowed_claims).toEqual([]);
    expect(r.reasons.some((x) => x.includes("مبالغة بسيطة"))).toBe(true);
  });
  it("اختلاف التصنيف بيوقف لقرار المراجع", () => {
    const base = runCodeChecks(input(), lib());
    const r = applyAgent(base, opinion({ classification: "therapeutic" }));
    expect(r.classification).toBe("needs_review");
    expect(r.verdict).toBe("needs_specialist");
  });
  it("الوكيل بيزوّد مكوّن محظور ما شافه الكود، وبيعتبر نص مش عن المادة", () => {
    const base = runCodeChecks(input({ references: [] }), lib());
    expect(applyAgent(base, opinion({ ingredients: [{ name: "x", status: "banned", note: null }] })).verdict).toBe("fail");
    expect(applyAgent(base, opinion({ references: [{ code: "REF-04", status: "approved_ok", usage_ok: false }] })).verdict).toBe("fail");
  });
  it("الوكيل بيعتبر منتج عين وترخيص مطلوب", () => {
    const base = runCodeChecks(input({ markets: ["SY"] }), lib());
    const r = applyAgent(base, opinion({ eye_product: true, license_needed: [{ country: "SY", type: "تسجيل" }] }));
    expect(r.eye).toBe(true);
    expect(r.licenses[0].state).toBe("required");
    expect(r.verdict).toBe("needs_specialist");
  });
  it("الوكيل متوقف: الكامل بيوقف والمبدئي بيكمل بالكود", () => {
    const full = agentUnavailable(runCodeChecks(input(), lib()), "الميزانية خلصت");
    expect(full.verdict).toBe("needs_specialist");
    expect(full.agent).toEqual({ used: false, error: "الميزانية خلصت" });
    const screen = agentUnavailable(runCodeChecks(input({ stage: "screen" }), lib()), "x");
    expect(screen.verdict).toBe("pass");
  });
});

describe("قرار الإنسان", () => {
  it("الحكم الفعلي: قرار الإنسان أولاً", () => {
    expect(effectiveVerdict({ verdict: "needs_specialist", humanVerdict: "pass" })).toBe("pass");
    expect(effectiveVerdict({ verdict: "pass", humanVerdict: null })).toBe("pass");
  });
  it("الرفض بالكود ما بينقلب بقرار", () => {
    expect(() => assertReviewAllowed({ verdict: "fail" }, "pass", [])).toThrow(ReviewRefused);
    expect(() => assertReviewAllowed({ verdict: "fail" }, "fail", [])).not.toThrow();
  });
  it("ما بينعتمد وفي نص ما اعتمده المراجع الشرعي", () => {
    expect(() => assertReviewAllowed({ verdict: "needs_specialist" }, "pass", ["REF-09"])).toThrow(/REF-09/);
    expect(() => assertReviewAllowed({ verdict: "needs_specialist" }, "fail", ["REF-09"])).not.toThrow();
    expect(() => assertReviewAllowed({ verdict: "needs_specialist" }, "pass", [])).not.toThrow();
  });
});
