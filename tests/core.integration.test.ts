// قاعدة حقيقية: إعدادات الحسابات من الإعدادات المبذورة، وحفظ النتائج مع نسخة القواعد.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { loadCoreConfig, RULES_VERSION } from "../src/core/config";
import { setSetting } from "../src/lib/settings";
import { actualEconomics, projectEconomics } from "../src/core/economics";
import { computeVelocity } from "../src/core/velocity";
import { saveActual, saveProjection, saveVelocity } from "../src/core/save";
import { DEFAULT_BANDS } from "../src/core/velocity";

const has = Boolean(process.env.DATABASE_URL);

describe.skipIf(!has)("الحسابات على قاعدة حقيقية", () => {
  const db = () => getDb();
  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().$disconnect();
  });

  it("الإعدادات المبذورة بتطلع نفس حدود ملف المنطق", async () => {
    const cfg = await loadCoreConfig(db(), "SY");
    expect(cfg.velocity.weights).toMatchObject({ age: 15, creator_ramp: 15, intent: 20, engagement: 10, multi_seller: 10, yellow_cart: 10, whitespace: 20 });
    expect(cfg.velocity.bands).toEqual(DEFAULT_BANDS); // الشرائح المحفوظة بالإعدادات (Infinity ↔ null)
    expect(cfg.reject.maxCreators).toBe(400);
    expect(cfg.decision.minCpaCeiling).toBe(4);
    expect(cfg.market).toMatchObject({ fxJodUsd: 1.41, safetyMargin: 0.3, defaultReturn: 0.25, deliveryFee: null });
    expect((await loadCoreConfig(db(), "JO")).market.defaultReturn).toBeNull();
  });

  it("تعديل الإعداد من الشاشة بيغيّر الحساب، والرجوع بيرجّعه", async () => {
    const d = db();
    const key = "velocity.penalty.20k_50k";
    const before = (await d.setting.findFirstOrThrow({ where: { key }, orderBy: { version: "desc" } })).valueJson as { label: string; raw: string };
    const ex = { trendAgeDays: 12, newCreators7d: 24, newCreatorsPrev7d: 10, intentComments: 13, commentSample: 120, engagementRate: 0.06, sellersCount: 4, yellowCartShare: 0.35, advertisersInMarket: 1, cumulativeSales: 30_000 };
    expect(computeVelocity(ex, (await loadCoreConfig(d)).velocity).score).toBe(66);
    await setSetting(d, key, { ...before, raw: "0" }, "test");
    expect(computeVelocity(ex, (await loadCoreConfig(d)).velocity).score).toBe(76); // بلا خصم 10
    await setSetting(d, key, before, "test");
    expect(computeVelocity(ex, (await loadCoreConfig(d)).velocity).score).toBe(66);
  });

  it("حفظ الاقتصاد والمؤشر مع نسخة القواعد وبأرقام عشرية دقيقة", async () => {
    const d = db();
    const c = await d.candidate.create({ data: { titleAr: "ماء كمأة تجريبي", titleSrc: "x", lane: "manual" } });
    const input = { unitCostUsd: "2.20", offers: [{ qty: 1, price: "20", share: 1 }], deliveryFee: "2.5", returnFee: "0", returnRate: 0.25, safetyMargin: 0.3 };
    const p = projectEconomics(input);
    const row = await saveProjection(d, c.id, "SY", input, p);
    expect(row.lossLimit.toString()).toBe("10.85");
    expect(row.cpaCeiling.toString()).toBe("7.6");
    expect(row.scalingCeiling.toString()).toBe("6.51");
    expect(row.kind).toBe("projection");
    expect((row.inputsJson as { rulesVersion: string }).rulesVersion).toBe(RULES_VERSION);
    expect((row.scenariosJson as { rulesVersion: string; scenarios: unknown[] }).scenarios).toHaveLength(3);

    const a = actualEconomics({ adSpend: "350", confirmed: 60, shipped: 58, delivered: 43, returned: 15, collected: "860", deliveryFees: "145", returnFees: "0", cogsDelivered: "94.6" });
    const act = await saveActual(d, c.id, "SY", { adSpend: "350" }, a);
    expect(act.kind).toBe("actual");
    expect(act.cpaCeiling.toString()).toBe("5.89"); // تكلفة الطلب المؤكد الفعلية
    expect((act.scenariosJson as { success: boolean }).success).toBe(true);

    const v = computeVelocity({ trendAgeDays: 12, newCreators7d: 24, newCreatorsPrev7d: 10, intentComments: 13, commentSample: 120, engagementRate: 0.06, sellersCount: 4, yellowCartShare: 0.35, advertisersInMarket: 1, cumulativeSales: 30_000 });
    const snap = await saveVelocity(d, c.id, v);
    expect(snap.rulesVersion).toBe(RULES_VERSION);
    expect((await d.candidate.findUniqueOrThrow({ where: { id: c.id } })).velocityScore).toBe(66);

    // بيانات غير كافية ما بتكتب درجة على المرشح
    const c2 = await d.candidate.create({ data: { titleAr: "ناقص", titleSrc: "x", lane: "manual" } });
    await saveVelocity(d, c2.id, computeVelocity({}));
    expect((await d.candidate.findUniqueOrThrow({ where: { id: c2.id } })).velocityScore).toBeNull();
  });
});
