import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { SCORED_TRAITS, TRAIT_IDS, TraitError, cosine, costTierOf, dnaScore, learn, rankReferences, similarity, successRate, traitsMatch, validateTraits, type DnaModel, type Sample, type TraitId } from "../src/core/dna";
import { buildDnaConfig } from "../src/core/dna-config";

const seed = JSON.parse(readFileSync("prisma/seeds/seed-data.json", "utf8"));
const values = new Map<string, unknown>(seed.settings.map((s: { key: string; label: string; raw: string }) => [s.key, { label: s.label, raw: s.raw }]));
values.set("dna.points", { items: seed.dnaPoints });
const cfg = buildDnaConfig(values);

const near = (a: number, b: number, d = 4) => expect(a).toBeCloseTo(b, d);

describe("إعدادات الحمض من ملف البذور", () => {
  it("الأوزان الافتراضية مجموعها 1.00، والنقاط والثوابت من الملف", () => {
    expect(Object.values(cfg.weights).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
    expect(cfg.weights).toMatchObject({ problem_clarity: 0.2, result_speed: 0.15, repeat: 0.15, cost_tier: 0.12, demo: 0.1, heritage: 0.08, embarrassing: 0.05, visible: 0.05, logistics: 0.05, regulatory: 0.05 });
    expect(cfg.points.problem_clarity).toEqual({ عالي: 1.0, متوسط: 0.6, ضعيف: 0.2 });
    expect(cfg.points.demo["صعب"]).toBe(0.2);
    expect(cfg.points.heritage).toMatchObject({ "نص نبوي": 1.0, قرآن: 1.0, "تراث بلد": 0.8, بلا: 0.4 });
    expect([cfg.confidenceK, cfg.blendK, cfg.smallSample]).toEqual([10, 10, 3]);
    expect(cfg.simWeights).toEqual([0.5, 0.3, 0.2]);
  });
  it("كل صفة مسجّلة بقيمها المسموحة بالضبط من ملف المنطق", () => {
    expect(TRAIT_IDS).toHaveLength(10);
    for (const t of SCORED_TRAITS) expect(Object.keys(cfg.points[t.id]).sort(), t.id).toEqual([...t.values].sort());
  });
});

describe("تعلّم الحمض", () => {
  it("نسبة النجاح = (الناجحين + 2 × النقاط الافتراضية) ÷ (المنتجات + 2)", () => {
    near(successRate(0, 0, 0.6), 0.6); // قبل أي تجربة: الافتراضي بيحكم
    near(successRate(1, 1, 0.6), 2.2 / 3); // منتج ناجح واحد ما بيعطي 100%
    near(successRate(8, 10, 1.0), 10 / 12);
    near(successRate(2, 8, 0.6), 3.2 / 10);
    expect(successRate(1, 1, 0.6)).toBeLessThan(1);
    near(successRate(0, 4, 0.2), 0.4 / 6);
  });

  it("بلا أي منتج مختبر: الأوزان الافتراضية والنقاط الافتراضية، وكل القيم «عيّنة صغيرة»", () => {
    const m = learn([], cfg);
    expect(m.products).toBe(0);
    for (const id of TRAIT_IDS) {
      const t = m.traits[id];
      near(t.finalWeight, cfg.weights[id]);
      expect([t.learnedWeight, t.known, t.confidence]).toEqual([0, 0, 0]);
      for (const v of t.values) {
        near(v.rate, cfg.points[id][v.value]);
        expect(v.small).toBe(true);
        expect(v.count).toBe(0);
      }
    }
  });

  it("وزن الصفة المتعلَّم والدمج بالمعادلات (20 منتج)", () => {
    const samples: Sample[] = [
      ...Array.from({ length: 10 }, (_, i) => ({ traits: { problem_clarity: "عالي" }, success: i < 8 })),
      ...Array.from({ length: 6 }, (_, i) => ({ traits: { problem_clarity: "متوسط" }, success: i < 2 })),
      ...Array.from({ length: 4 }, () => ({ traits: { problem_clarity: "ضعيف" }, success: false })),
    ];
    const m = learn(samples, cfg);
    const t = m.traits.problem_clarity;
    expect(t.values.map((v) => [v.value, v.count, v.successes])).toEqual([["عالي", 10, 8], ["متوسط", 6, 2], ["ضعيف", 4, 0]]);
    near(t.values[0].rate, 10 / 12); // (8 + 2×1.0) ÷ 12
    near(t.values[1].rate, 3.2 / 8); // (2 + 2×0.6) ÷ 8
    near(t.values[2].rate, 0.4 / 6); // (0 + 2×0.2) ÷ 6
    expect(t.known).toBe(20);
    near(t.confidence, 20 / 30);
    near(t.learnedWeight, (10 / 12 - 0.4 / 6) * (20 / 30));
    near(t.finalWeight, (20 / 30) * t.learnedWeight + (10 / 30) * 0.2); // ن = 20
    // صفة ما اتعلّم منها شي: الثقة صفر، فالنهائي = الافتراضي × 10/(ن+10)
    near(m.traits.repeat.finalWeight, (10 / 30) * 0.15);
    expect(m.traits.repeat.known).toBe(0);
  });

  it("«عيّنة صغيرة» لأي قيمة بأقل من 3 منتجات", () => {
    const m = learn([{ traits: { visible: "نعم" }, success: true }, { traits: { visible: "نعم" }, success: true }, { traits: { visible: "لا" }, success: false }, { traits: { visible: "لا" }, success: true }, { traits: { visible: "لا" }, success: true }], cfg);
    const [yes, no] = m.traits.visible.values;
    expect([yes.count, yes.small]).toEqual([2, true]);
    expect([no.count, no.small]).toEqual([3, false]);
  });

  it("كل ما زادت التجارب بيحكم المتعلَّم أكتر: الوزن النهائي دمج ن ÷ (ن + 10)", () => {
    const make = (n: number): Sample[] => [
      ...Array.from({ length: n }, (): Sample => ({ traits: { demo: "صعب" }, success: false })),
      ...Array.from({ length: n }, (): Sample => ({ traits: { demo: "نتيجة بتنشاف" }, success: true })),
    ];
    for (const n of [1, 5, 50]) {
      const t = learn(make(n), cfg).traits.demo;
      const a = (2 * n) / (2 * n + 10); // ن = عدد المنتجات المختبرة (الكل)
      near(t.finalWeight, a * t.learnedWeight + (1 - a) * t.defaultWeight);
    }
    // حصة المتعلَّم بتكبر: 2 منتج ← 17%، 100 منتج ← 91%
    expect(2 / 12).toBeLessThan(100 / 110);
  });
});

// ───── درجة الحمض: مثال ملف المنطق (92) ─────
function customModel(spec: { id: TraitId; weight: number; rates: Record<string, number> }[]): DnaModel {
  const base = learn([], cfg);
  for (const s of spec) {
    base.traits[s.id] = { ...base.traits[s.id], finalWeight: s.weight, values: Object.entries(s.rates).map(([value, rate]) => ({ value, count: 5, successes: 3, rate, small: false })) };
  }
  return base;
}

describe("درجة الحمض", () => {
  it("المثال: أوزان 0.30 · 0.25 · 0.20 · 0.25 وبالرابعة 0.40 من أعلى 0.60 = 92", () => {
    const model = customModel([
      { id: "problem_clarity", weight: 0.3, rates: { عالي: 0.9, متوسط: 0.5, ضعيف: 0.2 } },
      { id: "result_speed", weight: 0.25, rates: { أيام: 0.6, أسابيع: 0.4, أشهر: 0.1 } }, // المرشح بالقيمة 0.40 من أعلى 0.60
      { id: "repeat", weight: 0.2, rates: { "بيخلص وبينطلب": 0.8, "مرة وحدة": 0.3 } },
      { id: "demo", weight: 0.25, rates: { "نتيجة بتنشاف": 0.7, "تجربة حسية": 0.5, شرح: 0.3, صعب: 0.1 } },
    ]);
    const r = dnaScore({ problem_clarity: "عالي", result_speed: "أسابيع", repeat: "بيخلص وبينطلب", demo: "نتيجة بتنشاف" }, model);
    expect(r.score).toBe(92);
    expect(r.parts.map((p) => +p.ratio.toFixed(3))).toEqual([1, 0.667, 1, 1]);
    expect(r.rule).toContain("0.9167");
    expect(r.missing).toHaveLength(6); // الباقي ما انعبّى فانشال
  });

  it("بالنقاط الافتراضية: أفضل القيم = 100، وأسوأها = النسبة لأعلى نقطة", () => {
    const m = learn([], cfg);
    const best: Record<string, string> = {};
    for (const t of SCORED_TRAITS) best[t.id] = t.values[0];
    expect(dnaScore(best, m).score).toBe(100);
    expect(dnaScore({ problem_clarity: "ضعيف" }, m).score).toBe(20); // 0.2 ÷ 1.0
    expect(dnaScore({ heritage: "بلا" }, m).score).toBe(40); // 0.4 ÷ 1.0
    expect(dnaScore({ embarrassing: "لا" }, m).score).toBe(75); // 0.6 ÷ 0.8
  });

  it("بلا صفات = بلا درجة، وقيمة غلط = خطأ، وصفة ناقصة بتنشال", () => {
    const m = learn([], cfg);
    expect(dnaScore({}, m)).toMatchObject({ score: null });
    expect(() => dnaScore({ problem_clarity: "ممتاز" }, m)).toThrow(TraitError);
    const r = dnaScore({ problem_clarity: "عالي", cost_tier: "فوق 5$" }, m);
    expect(r.missing).toHaveLength(8);
    // (0.20 × 1 + 0.12 × (0.3 ÷ 1)) ÷ 0.32 = 0.236 ÷ 0.32 = 73.75
    expect(r.score).toBe(74);
  });
});

describe("ملف الحمض: القيم المسموحة بالضبط", () => {
  it("بيقبل المسموح، وبيتجاهل «—» والفاضي", () => {
    expect(validateTraits({ problem_clarity: "عالي", visible: "—", embarrassing: "", category: "تجميل", seasonality: "رمضان", consumption_days: 30 })).toEqual({ problem_clarity: "عالي", category: "تجميل", seasonality: "رمضان", consumption_days: 30 });
  });
  it("بيرفض قيمة غلط أو صفة مجهولة أو مدة سالبة", () => {
    expect(() => validateTraits({ problem_clarity: "كتير" })).toThrow("المسموح");
    expect(() => validateTraits({ color: "red" })).toThrow("مجهولة");
    expect(() => validateTraits({ consumption_days: -3 })).toThrow(TraitError);
    expect(() => validateTraits({ consumption_days: 2.5 })).toThrow(TraitError);
    expect(() => validateTraits({ category: "سيارات" })).toThrow(TraitError);
  });
  it("شريحة التكلفة بيحسبها الكود", () => {
    expect([2.49, 2.5, 5, 5.01, 0.5].map(costTierOf)).toEqual(["أقل من 2.5$", "2.5–5$", "2.5–5$", "فوق 5$", "أقل من 2.5$"]);
  });
});

describe("التشابه وأقرب مرجع", () => {
  it("cosine", () => {
    near(cosine([1, 0, 0], [1, 0, 0]), 1);
    near(cosine([1, 0], [0, 1]), 0);
    near(cosine([1, 2, 3], [-1, -2, -3]), -1);
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(() => cosine([1, 2], [1])).toThrow();
  });
  it("0.5 × النص + 0.3 × الصورة + 0.2 × الصفات", () => {
    near(similarity({ text: 0.8, image: 0.6, traits: 1 }).value!, 0.5 * 0.8 + 0.3 * 0.6 + 0.2 * 1);
    const noText = similarity({ image: 0.6, traits: 1 });
    near(noText.value!, (0.3 * 0.6 + 0.2 * 1) / 0.5); // المكوّن الناقص بينشال وبتتوزّع الأوزان
    expect(noText.note).toContain("ناقصة");
    near(similarity({ traits: 0.5 }).value!, 0.5);
    expect(similarity({}).value).toBeNull();
    near(similarity({ text: 1, image: 0, traits: 0 }, [0.2, 0.2, 0.6]).value!, 0.2);
  });
  it("الصفات المتطابقة من المعروف عند الطرفين", () => {
    const r = traitsMatch({ problem_clarity: "عالي", visible: "نعم", demo: "شرح" }, { problem_clarity: "عالي", visible: "لا", repeat: "مرة وحدة" });
    expect(r.ratio).toBe(0.5); // مشتركة: وضوح + بتنشاف
    expect(r.matching).toEqual(["problem_clarity"]);
    expect(r.different).toEqual(["visible"]);
    expect(traitsMatch({}, { visible: "لا" }).ratio).toBeNull();
  });
  it("أقرب مرجع = الأعلى تشابهاً", () => {
    const refs = [
      { id: "a", name: "بديل الليزر", traits: { problem_clarity: "ضعيف" as const, demo: "صعب" as const } },
      { id: "b", name: "ماء الكمأة", traits: { problem_clarity: "عالي" as const, demo: "نتيجة بتنشاف" as const }, textSim: 0.5 },
    ];
    const ranked = rankReferences({ problem_clarity: "عالي", demo: "نتيجة بتنشاف" }, refs);
    expect(ranked[0].name).toBe("ماء الكمأة");
    expect(ranked[0].matching).toEqual(["problem_clarity", "demo"]);
    expect(ranked[1].similarity.value).toBe(0); // لا نص ولا صورة، صفاتهم مختلفة
  });
});
