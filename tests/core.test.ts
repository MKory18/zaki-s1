import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { D, text2, pct1 } from "../src/core/num";
import { actualEconomics, deliveredProfit, EconomicsError, projectEconomics, shipmentExpected, type EconomicsInput } from "../src/core/economics";
import { computeVelocity, DEFAULT_BANDS, DEFAULT_VELOCITY_CONFIG, type VelocityInput, type SignalKey } from "../src/core/velocity";
import { evaluateReject, DEFAULT_REJECT_CONFIG } from "../src/core/reject";
import { decide, DEFAULT_DECISION_CONFIG } from "../src/core/decision";
import { assessReadiness, whitespaceFactor, FACTOR_KEYS, type Factor } from "../src/core/readiness";
import { parseNumber, parseNumberList, parsePercent, parseRange } from "../src/core/settings-parse";
import { buildCoreConfig, deserializeBands, serializeBands, RULES_VERSION } from "../src/core/config";

// ───── اقتصاد: مثال ماء الكمأة حرفياً ─────
const KUMAA: EconomicsInput = { unitCostUsd: "2.20", offers: [{ qty: 1, price: "20", share: 1 }], deliveryFee: "2.5", returnFee: "0", returnRate: "0.25", safetyMargin: "0.3" };
const line = (p: ReturnType<typeof projectEconomics>, k: string) => p.lines.find((l) => l.key === k)!.value;
const scen = (p: ReturnType<typeof projectEconomics>, k: string) => p.scenarios.find((s) => s.key === k)!;

describe("الحاسبة: مثال ماء الكمأة (10.85 · 7.60 · 6.51 · 5.53 · خسارة 0.65 · 8.92)", () => {
  const p = projectEconomics(KUMAA);
  it("حد الخسارة وسقف التكلفة وسقف التكبير", () => {
    expect(line(p, "loss_limit")).toBe("10.85");
    expect(line(p, "cpa_ceiling")).toBe("7.60"); // 7.595 ← تقريب لفوق (بلا أخطاء الأعداد العائمة)
    expect(line(p, "scaling_ceiling")).toBe("6.51");
    expect([p.lossLimit, p.cpaCeiling, p.scalingCeiling]).toEqual(["10.85", "7.60", "6.51"]);
  });
  it("السيناريوهات الثلاثة", () => {
    expect(scen(p, "expected")).toMatchObject({ deliveredProfit: "5.53", returnRate: "25.0", spendPerShipment: "6.51", loss: false });
    expect(scen(p, "pessimistic")).toMatchObject({ deliveredProfit: "-0.65", returnRate: "33.0", spendPerShipment: "9.77", loss: true });
    expect(scen(p, "optimistic")).toMatchObject({ deliveredProfit: "8.92", returnRate: "20.0", spendPerShipment: "4.34", loss: false });
  });
  it("نفس النتيجة لو التكلفة بالدينار (1.56 × 1.41)", () => {
    const j = projectEconomics({ ...KUMAA, unitCostUsd: undefined, unitCostJod: "1.56", fxJodUsd: "1.41" });
    expect([j.lossLimit, j.cpaCeiling, j.scalingCeiling]).toEqual(["10.85", "7.60", "6.51"]);
    expect(scen(j, "expected").deliveredProfit).toBe("5.53");
    expect(scen(j, "pessimistic").deliveredProfit).toBe("-0.65");
    expect(scen(j, "optimistic").deliveredProfit).toBe("8.92");
  });
  it("كل رقم معه قاعدته بأرقامه", () => {
    for (const l of p.lines) expect(l.rule.length, l.key).toBeGreaterThan(10);
    expect(p.lines.find((l) => l.key === "loss_limit")!.rule).toContain("10.85");
    expect(scen(p, "pessimistic").rule).toContain("× 1.01");
  });
  it("عروض متعددة: متوسط القيمة والوحدات", () => {
    const m = projectEconomics({ ...KUMAA, offers: [{ qty: 1, price: "20", share: "0.6" }, { qty: 2, price: "35", share: "0.3" }, { qty: 3, price: "45", share: "0.1" }] });
    expect(line(m, "aov")).toBe("27.00");
    expect(line(m, "avg_units")).toBe("1.5");
  });
  it("أجرة المرتجع بتنخصم بنسبة المرتجع", () => {
    const w = projectEconomics({ ...KUMAA, returnFee: "2" });
    expect(line(w, "loss_limit")).toBe(text2(D("10.85").minus(D("0.25").times(2)))); // 10.35
  });
  it("الخسارة بلا خصم الـ 3%، والربح الموجب بينخصم 0.97", () => {
    const exp = shipmentExpected(D(20), D(1), D("2.2"), D("0.25"), D("2.5"), D(0));
    expect(deliveredProfit(exp, D("20"), D("0.25")).lt(0)).toBe(true); // صرف أكبر من الحد
    const neg = D(exp).minus(D("20").times("1.01")); // سالب
    expect(deliveredProfit(exp, D("20"), D("0.25")).toString()).toBe(neg.div("0.75").toString()); // بلا × 0.97
    const pos = exp.minus(D("1").times("1.01")).times("0.97").div("0.75");
    expect(deliveredProfit(exp, D(1), D("0.25")).toString()).toBe(pos.toString());
  });
  it("التحقق من المدخلات", () => {
    expect(() => projectEconomics({ ...KUMAA, offers: [] })).toThrow(EconomicsError);
    expect(() => projectEconomics({ ...KUMAA, offers: [{ qty: 1, price: "20", share: "0.5" }] })).toThrow("100%");
    expect(() => projectEconomics({ ...KUMAA, returnRate: "1" })).toThrow(EconomicsError);
    expect(() => projectEconomics({ ...KUMAA, safetyMargin: "-0.1" })).toThrow(EconomicsError);
    expect(() => projectEconomics({ ...KUMAA, unitCostUsd: undefined })).toThrow("تكلفة الوحدة");
    expect(() => projectEconomics({ ...KUMAA, offers: [{ qty: 1, price: "-5", share: 1 }] })).toThrow(EconomicsError);
    expect(() => projectEconomics({ ...KUMAA, deliveryFee: "-1" })).toThrow(EconomicsError);
  });
  it("التقريب لنص الخانة لفوق، والجمع العشري دقيق", () => {
    expect(text2("7.595")).toBe("7.60");
    expect(text2("7.594999")).toBe("7.59");
    expect(D("0.1").plus("0.2").toString()).toBe("0.3");
    expect(pct1("0.2586")).toBe("25.9");
  });
});

describe("الحاسبة بعد الاختبار: مثال الاختبار (715 · 10.70 · 258.89 · 6.02 · 5.89 · 25.9%)", () => {
  const a = actualEconomics({ adSpend: "350", orders: 75, confirmed: 60, shipped: 58, delivered: 43, returned: 15, collected: "860", deliveryFees: "145", returnFees: "0", cogsDelivered: "94.6" });
  it("الأرقام الستة والنتيجة ناجح", () => {
    expect(a.netCollected).toBe("715.00");
    expect(a.lossLimit).toBe("10.70");
    expect(a.profit).toBe("258.89");
    expect(a.profitPerDelivered).toBe("6.02");
    expect(a.costPerConfirmed).toBe("5.89");
    expect(a.returnRate).toBe("25.9%");
    expect(a.success).toBe(true);
  });
  it("باقي المؤشرات", () => {
    expect(a.scalingCeiling).toBe("6.42"); // 10.6965 × 0.6
    expect(a.costPerDelivered).toBe("8.22"); // 353.5 ÷ 43
    expect(a.deliveryRate).toBe("74.1%");
    expect(a.confirmRate).toBe("80.0%");
    expect(a.lines.find((l) => l.key === "actual_ad_spend")!.value).toBe("353.50");
  });
  it("منتج خاسر: الربح سالب بلا خصم 0.97، والنتيجة مش ناجح", () => {
    const bad = actualEconomics({ adSpend: "400", confirmed: 20, shipped: 18, delivered: 10, returned: 8, collected: "250", deliveryFees: "45", returnFees: "0", cogsDelivered: "30" });
    // 205 − 30 − 404 = −229 (بلا × 0.97)
    expect(bad.profit).toBe("-229.00");
    expect(bad.profitPerDelivered).toBe("-22.90");
    expect(bad.success).toBe(false);
  });
  it("بلا تسليم: ما في ربح طلب مُسلَّم، وما بيتقسم على صفر", () => {
    const z = actualEconomics({ adSpend: "100", confirmed: 5, shipped: 0, delivered: 0, returned: 0, collected: "0", deliveryFees: "0", returnFees: "0", cogsDelivered: "0" });
    expect(z.profitPerDelivered).toBeNull();
    expect(z.lossLimit).toBeNull();
    expect(z.success).toBe(false);
  });
});

// ───── مؤشر السرعة ─────
const EXAMPLE: VelocityInput = {
  trendAgeDays: 12, newCreators7d: 24, newCreatorsPrev7d: 10, intentComments: 13, commentSample: 120,
  engagementRate: 0.06, sellersCount: 4, yellowCartShare: 0.35, advertisersInMarket: 1, cumulativeSales: 30_000,
};
const only = (key: SignalKey, input: VelocityInput) => computeVelocity(input).signals.find((s) => s.key === key)!.score;

describe("مؤشر السرعة: المثال (66، وبلا الفراغ 68)", () => {
  it("66 بدرجات الإشارات: 85 · 80 · 80 · 75 · 70 · 70 · 70 وخصم 10", () => {
    const r = computeVelocity(EXAMPLE);
    expect(r.score).toBe(66);
    expect(r.signals.map((s) => s.score)).toEqual([85, 80, 80, 75, 70, 70, 70]);
    expect(r.penalty).toBe(10);
    expect(r.measuredWeight).toBe(100);
    expect(r.rule).toContain("7625");
    expect(r.warnings).toEqual([]);
  });
  it("الفراغ مش مقاس: 68 مع تنبيه «افحص مكتبة إعلانات سوقك»", () => {
    const r = computeVelocity({ ...EXAMPLE, advertisersInMarket: null });
    expect(r.score).toBe(68);
    expect(r.measuredWeight).toBe(80);
    expect(r.warnings.join()).toContain("افحص مكتبة إعلانات سوقك");
    expect(r.rule).toContain("6225");
  });
  it("إشارات مقاسة أوزانها أقل من 50 = «بيانات غير كافية»", () => {
    const r = computeVelocity({ trendAgeDays: 10, intentComments: 10, commentSample: 100 }); // 15 + 20 = 35
    expect(r).toMatchObject({ score: null, insufficient: true });
    expect(r.warnings).toContain("بيانات غير كافية");
    expect(computeVelocity({}).insufficient).toBe(true);
    expect(computeVelocity({ trendAgeDays: 10, newCreators7d: 5, newCreatorsPrev7d: 5, intentComments: 10, commentSample: 100 }).insufficient).toBe(false); // 50 بالضبط
  });
  it("عيّنة تعليقات أقل من 50: إشارة النية بتنشال", () => {
    const r = computeVelocity({ ...EXAMPLE, commentSample: 49 });
    expect(r.signals.find((s) => s.key === "intent")).toMatchObject({ measured: false, score: null });
    expect(r.warnings.join()).toContain("عيّنة التعليقات");
    expect(computeVelocity({ ...EXAMPLE, commentSample: 50 }).signals.find((s) => s.key === "intent")!.measured).toBe(true);
  });
  it("خصم المبيعات: 20 ألف = 10، 50 ألف = 20، أقل = صفر", () => {
    const pen = (s: number) => computeVelocity({ ...EXAMPLE, cumulativeSales: s }).penalty;
    expect([pen(19_999), pen(20_000), pen(49_999), pen(50_000), pen(100_000)]).toEqual([0, 10, 10, 20, 20]);
  });
  it("المؤشر محصور بين 0 و100", () => {
    const low = computeVelocity({ trendAgeDays: 45, newCreators7d: 1, newCreatorsPrev7d: 10, intentComments: 0, commentSample: 100, engagementRate: 0, sellersCount: 1, yellowCartShare: 0, advertisersInMarket: 20, cumulativeSales: 60_000 });
    expect(low.score).toBe(0);
    const high = computeVelocity({ trendAgeDays: 3, newCreators7d: 90, newCreatorsPrev7d: 10, intentComments: 40, commentSample: 100, engagementRate: 0.2, sellersCount: 10, yellowCartShare: 0.8, advertisersInMarket: 0, cumulativeSales: 100 });
    expect(high.score).toBe(100);
  });
  it("شرائح عمر الترند", () => {
    const at = (d: number) => only("age", { trendAgeDays: d });
    expect([7, 8, 14, 15, 21, 22, 30, 31, 45, 46].map(at)).toEqual([100, 85, 85, 70, 70, 50, 50, 25, 25, 0]);
  });
  it("شرائح تسارع الصنّاع (الجدد ÷ الجدد قبلها)", () => {
    const at = (a: number, b: number) => only("creator_ramp", { newCreators7d: a, newCreatorsPrev7d: b });
    expect([at(30, 10), at(299, 100), at(20, 10), at(15, 10), at(10, 10), at(9, 10), at(5, 0)]).toEqual([100, 80, 80, 60, 40, 10, 100]);
    expect(computeVelocity({ newCreators7d: 0, newCreatorsPrev7d: 0 }).signals[1].measured).toBe(false);
  });
  it("شرائح نية الشراء", () => {
    const at = (p: number) => only("intent", { intentComments: p, commentSample: 100 });
    expect([15, 14, 10, 9, 5, 4, 2, 1].map(at)).toEqual([100, 80, 80, 60, 60, 30, 30, 10]);
  });
  it("شرائح حرارة التفاعل", () => {
    const at = (p: number) => only("engagement", { engagementRate: p / 100 });
    expect([8, 7.9, 5, 4.9, 3, 2.9, 1, 0.9].map(at)).toEqual([100, 75, 75, 50, 50, 25, 25, 10]);
  });
  it("شرائح تعدد البائعين", () => {
    const at = (n: number) => only("multi_seller", { sellersCount: n });
    expect([1, 2, 3, 5, 6, 15, 16].map(at)).toEqual([20, 40, 70, 70, 100, 100, 60]);
  });
  it("شرائح السلة الصفراء", () => {
    const at = (p: number) => only("yellow_cart", { yellowCartShare: p / 100 });
    expect([50, 49, 20, 19, 1, 0].map(at)).toEqual([100, 70, 70, 40, 40, 0]);
  });
  it("شرائح الفراغ بسوقك", () => {
    const at = (n: number) => only("whitespace", { advertisersInMarket: n });
    expect([0, 1, 2, 3, 5, 6, 10, 11].map(at)).toEqual([100, 70, 70, 40, 40, 20, 20, 5]);
  });
  it("الأوزان الافتراضية: مجموعها 100، والحدود من الإعدادات بتغيّر النتيجة", () => {
    expect(Object.values(DEFAULT_VELOCITY_CONFIG.weights).reduce((a, b) => a + b, 0)).toBe(100);
    const cfg = { ...DEFAULT_VELOCITY_CONFIG, weights: { ...DEFAULT_VELOCITY_CONFIG.weights, whitespace: 0 }, minMeasuredWeight: 10 };
    const r = computeVelocity(EXAMPLE, cfg); // وزن الفراغ صفر: بيضل مقاس بس ما بيأثر
    expect(r.measuredWeight).toBe(80);
    expect(r.score).toBe(68);
  });
});

describe("قواعد الرفض الصارمة", () => {
  const hit = (i: Parameters<typeof evaluateReject>[0]) => evaluateReject(i).map((h) => h.rule);
  it("401 صانع = رفض، و400 لأ", () => {
    expect(hit({ lane: "manual", creators: 401 })).toEqual(["creators"]);
    expect(hit({ lane: "manual", creators: 400 })).toEqual([]);
  });
  it("عمر الترند فوق 45 للصيني المبكر بس", () => {
    expect(hit({ lane: "china_early", trendAgeDays: 46 })).toEqual(["trend_age"]);
    expect(hit({ lane: "china_early", trendAgeDays: 45 })).toEqual([]);
    expect(hit({ lane: "regional_proven", trendAgeDays: 120 })).toEqual([]); // المثبت إقليمياً بلا قاعدة العمر
    expect(hit({ lane: "manual", trendAgeDays: 120 })).toEqual([]);
  });
  it("مبيعات تراكمية 100,001 = رفض، و100,000 لأ", () => {
    expect(hit({ lane: "manual", cumulativeSales: 100_001 })).toEqual(["cumulative_sales"]);
    expect(hit({ lane: "manual", cumulativeSales: 100_000 })).toEqual([]);
  });
  it("مكوّن محظور، فئة ممنوعة، واقتصاد صفر أو أقل", () => {
    expect(hit({ lane: "manual", bannedIngredient: true })).toEqual(["banned_ingredient"]);
    expect(hit({ lane: "manual", forbiddenCategory: true })).toEqual(["forbidden_category"]);
    expect(hit({ lane: "manual", expectedPerShipment: 0 })).toEqual(["economics"]);
    expect(hit({ lane: "manual", expectedPerShipment: -3 })).toEqual(["economics"]);
    expect(hit({ lane: "manual", expectedPerShipment: 0.01 })).toEqual([]);
  });
  it("عدة قواعد معاً، والحدود من الإعدادات", () => {
    expect(hit({ lane: "china_early", creators: 500, trendAgeDays: 60, cumulativeSales: 200_000 })).toEqual(["creators", "trend_age", "cumulative_sales"]);
    expect(evaluateReject({ lane: "manual", creators: 250 }, { ...DEFAULT_REJECT_CONFIG, maxCreators: 200 })).toHaveLength(1);
    expect(hit({ lane: "china_early" })).toEqual([]); // الناقص ما بيرفض
  });
});

describe("قواعد القرار", () => {
  const base = { rejectHits: [], velocity: 66, dna: 78, cpaCeiling: 7.6, complianceVerdict: "pass" as const, readiness: "ready" as const };
  it("بحث معمّق: المؤشر 65+ والحمض 60+ والاقتصاد والامتثال والسوق تمام", () => {
    expect(decide(base).decision).toBe("deep_research");
    expect(decide({ ...base, velocity: 65, dna: 60 }).decision).toBe("deep_research");
    expect(decide({ ...base, complianceVerdict: "pass_with_edits" }).decision).toBe("deep_research");
    expect(decide({ ...base, readiness: "conditional" }).decision).toBe("deep_research");
  });
  it("بحث معمّق خارج الحمض: المؤشر 80+ والحمض أقل من 60، من حصة 20%", () => {
    const r = decide({ ...base, velocity: 82, dna: 40 });
    expect(r).toMatchObject({ decision: "deep_research_outside_dna", outsideBudgetShare: 0.2 });
    expect(decide({ ...base, velocity: 80, dna: 59 }).decision).toBe("deep_research_outside_dna");
  });
  it("راقب: المؤشر 45–65 أو الحمض 45–60 أو بيانات غير كافية (14 يوم)", () => {
    expect(decide({ ...base, velocity: 64, dna: 70 })).toMatchObject({ decision: "watch", watchDays: 14 });
    expect(decide({ ...base, velocity: 45, dna: 70 }).decision).toBe("watch");
    expect(decide({ ...base, velocity: 70, dna: 59 }).decision).toBe("watch");
    expect(decide({ ...base, velocity: 70, dna: 45 }).decision).toBe("watch");
    expect(decide({ ...base, velocity: 79, dna: 59 }).decision).toBe("watch");
    expect(decide({ ...base, velocity: null })).toMatchObject({ decision: "watch" });
  });
  it("ارفض: غير هيك (حدود)", () => {
    expect(decide({ ...base, velocity: 44, dna: 90 }).decision).toBe("reject");
    expect(decide({ ...base, velocity: 70, dna: 44 }).decision).toBe("reject");
    expect(decide({ ...base, velocity: 30, dna: 30 }).decision).toBe("reject");
  });
  it("سقف تكلفة الطلب لازم فوق الحد الأدنى للسوق، والامتثال والسوق شروط", () => {
    const r = decide({ ...base, cpaCeiling: 4 }); // مش فوق 4
    expect(r.decision).toBe("reject");
    expect(r.reasons.join()).toContain("سقف تكلفة الطلب");
    expect(decide({ ...base, cpaCeiling: 4.01 }).decision).toBe("deep_research");
    expect(decide({ ...base, complianceVerdict: "fail" })).toMatchObject({ decision: "reject" });
    expect(decide({ ...base, complianceVerdict: "fail" }).reasons.join()).toContain("الامتثال");
    expect(decide({ ...base, readiness: "not_ready" }).reasons.join()).toContain("السوق");
    expect(decide({ ...base, cpaCeiling: null }).decision).toBe("reject");
  });
  it("أي قاعدة رفض صارمة = رفض تلقائي (حتى لو الأرقام ممتازة)", () => {
    const r = decide({ ...base, velocity: 99, dna: 99, rejectHits: [{ rule: "creators", message: "401 صانع" }] });
    expect(r).toMatchObject({ decision: "reject_auto", reasons: ["401 صانع"] });
  });
  it("تعارض مع رأي المحقق بيعلّم البطاقة", () => {
    expect(decide({ ...base, investigator: "reject" }).conflict).toBe(true); // القواعد بحث معمّق والمحقق ارفض
    expect(decide({ ...base, investigator: "deep_research" }).conflict).toBe(false);
    expect(decide({ ...base, investigator: "watch" }).conflict).toBe(false);
    expect(decide({ ...base, velocity: 30, dna: 30, investigator: "deep_research" }).conflict).toBe(true); // العكس
    expect(decide({ ...base, velocity: 55, investigator: "deep_research" }).conflict).toBe(false); // راقب مش تعارض
    expect(decide({ ...base, velocity: 30, dna: 30, investigator: "reject" }).conflict).toBe(false);
    expect(decide({ ...base, rejectHits: [{ rule: "creators", message: "x" }], investigator: "deep_research" }).conflict).toBe(true);
    expect(decide(base).conflict).toBe(false); // بلا رأي
  });
  it("الحدود من الإعدادات", () => {
    const strict = { ...DEFAULT_DECISION_CONFIG, deepMinVelocity: 70, watchVelocity: [45, 70] as [number, number] };
    expect(decide({ ...base, velocity: 66 }, strict).decision).toBe("watch");
    expect(decide({ ...base, velocity: 66 }, { ...DEFAULT_DECISION_CONFIG, deepMinVelocity: 70 }).decision).toBe("reject"); // شريحة المراقبة إعداد منفصل
  });
});

describe("جاهزية السوق", () => {
  const all = (s: Factor["status"]): Factor[] => FACTOR_KEYS.map((key) => ({ key, status: s }));
  it("كل العوامل تمام = جاهز", () => expect(assessReadiness(all("ok"))).toEqual({ verdict: "ready", conditions: [], reasons: [] }));
  it("عامل سيّئ = مش جاهز مع السبب", () => {
    const r = assessReadiness([...all("ok").slice(1), { key: "logistics", status: "bad", note: "سائل بحرارة الصيف" }, { key: "ad_whitespace", status: "ok" }]);
    expect(r.verdict).toBe("not_ready");
    expect(r.reasons[0]).toContain("اللوجستيات: سائل بحرارة الصيف");
  });
  it("تحذير أو مجهول أو ناقص = جاهز بشروط مع الشروط", () => {
    const r = assessReadiness([...all("ok").slice(0, 5), { key: "cultural_fit", status: "warn", note: "الزاوية الدينية حساسة" }]);
    expect(r).toMatchObject({ verdict: "conditional" });
    expect(r.conditions).toEqual(["الملاءمة الثقافية: الزاوية الدينية حساسة"]);
    expect(assessReadiness(all("unknown")).conditions).toHaveLength(6);
    expect(assessReadiness([]).verdict).toBe("conditional");
  });
  it("الفراغ الإعلاني من عدد المعلنين", () => {
    expect([0, 2, 3, 5, 6, 12].map((n) => whitespaceFactor(n).status)).toEqual(["ok", "ok", "warn", "warn", "bad", "bad"]);
    expect(whitespaceFactor(null)).toMatchObject({ status: "unknown", note: expect.stringContaining("مكتبة إعلانات") });
  });
});

describe("قراءة قيم الإعدادات", () => {
  it("أرقام، نسب، مدى، وقوائم", () => {
    expect([parseNumber("14 يوم"), parseNumber("4$"), parseNumber("1,000"), parseNumber("تعبّيها"), parseNumber("—"), parseNumber(7), parseNumber(null)]).toEqual([14, 4, 1000, null, null, 7, null]);
    expect([parsePercent("25%"), parsePercent("20%"), parsePercent("0.3"), parsePercent("تعبّيها")]).toEqual([0.25, 0.2, 0.3, null]);
    expect([parseRange("45–65"), parseRange("45-60"), parseRange("65")]).toEqual([[45, 65], [45, 60], null]);
    expect([parseNumberList("0.5 · 0.3 · 0.2"), parseNumberList("a · b")]).toEqual([[0.5, 0.3, 0.2], null]);
  });
});

describe("بناء إعدادات الحسابات من الإعدادات المبذورة", () => {
  const seed = JSON.parse(readFileSync("prisma/seeds/seed-data.json", "utf8"));
  const values = new Map<string, unknown>(seed.settings.map((s: { key: string; label: string; raw: string }) => [s.key, { label: s.label, raw: s.raw }]));
  for (const m of seed.markets) values.set(`market.${m.code}`, { label: m.nameAr, values: m.values });
  const cfg = buildCoreConfig(values, "SY");

  it("كل حد من ملف البذور", () => {
    expect(cfg.velocity.weights).toEqual(DEFAULT_VELOCITY_CONFIG.weights);
    expect([cfg.velocity.minMeasuredWeight, cfg.velocity.minCommentSample, cfg.velocity.penalty50k100k, cfg.velocity.penalty20k50k]).toEqual([50, 50, 20, 10]);
    expect(cfg.reject).toEqual({ maxCreators: 400, maxTrendAgeDays: 45, maxCumulativeSales: 100000 });
    expect(cfg.decision).toMatchObject({ deepMinVelocity: 65, deepMinDna: 60, outsideMinVelocity: 80, watchVelocity: [45, 65], watchDna: [45, 60], watchDays: 14, outsideBudgetShare: 0.2, minCpaCeiling: 4 });
    expect(cfg.rulesVersion).toBe(RULES_VERSION);
  });
  it("افتراضيات السوق: سوريا بقيمها، و«تعبّيها» = null", () => {
    expect(cfg.market).toMatchObject({ code: "SY", fxJodUsd: 1.41, safetyMargin: 0.3, defaultReturn: 0.25, deliveryFee: null, returnFee: null, minCpaCeiling: 4 });
    const jo = buildCoreConfig(values, "JO");
    expect(jo.market).toMatchObject({ code: "JO", fxJodUsd: 1.41, safetyMargin: 0.3, defaultReturn: null, minCpaCeiling: null });
    expect(jo.decision.minCpaCeiling).toBe(DEFAULT_DECISION_CONFIG.minCpaCeiling); // الأردن: بيرجع للافتراضي لحد ما ينعبّى
  });
  it("المثال بالإعدادات المبذورة بيطلع 66 والحاسبة نفس الأرقام", () => {
    expect(computeVelocity(EXAMPLE, cfg.velocity).score).toBe(66);
    const p = projectEconomics({ ...KUMAA, safetyMargin: cfg.market.safetyMargin, returnRate: cfg.market.defaultReturn!, deliveryFee: "2.5" });
    expect(p.cpaCeiling).toBe("7.60");
  });
  it("تعديل إعداد بيغيّر الحساب، وإعداد ناقص بياخد الافتراضي", () => {
    const edited = new Map(values);
    edited.set("reject.max_creators", { raw: "300" });
    edited.set("velocity.w.age", { raw: "30" });
    const c2 = buildCoreConfig(edited);
    expect(c2.reject.maxCreators).toBe(300);
    expect(evaluateReject({ lane: "manual", creators: 350 }, c2.reject)).toHaveLength(1);
    expect(c2.velocity.weights.age).toBe(30);
    const empty = buildCoreConfig(new Map());
    expect(empty.reject.maxCreators).toBe(400);
    expect(empty.market.safetyMargin).toBe(0.3);
  });
  it("الشرائح بتنحفظ وبترجع (Infinity ↔ null)", () => {
    const ser = serializeBands(DEFAULT_BANDS);
    expect(JSON.stringify(ser)).toContain('"max":null');
    expect(deserializeBands(ser)).toEqual(DEFAULT_BANDS);
    expect(deserializeBands(undefined)).toEqual(DEFAULT_BANDS);
  });
});
