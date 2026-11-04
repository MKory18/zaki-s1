// قاعدة حقيقية: مرجعيات الحمض (يدوي · من الـ OMS · بانتظار الاعتماد)، ملفات الحمض، التعلّم من أداء الـ OMS الوهمي، ونسخ الأوزان.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { DnaError, addManualReference, currentModel, listReferences, listWeightSets, runLearning, scoreTraits, setProfile, setReferenceState } from "../src/lib/dna";
import { mockState, resetMocksForTests } from "../src/adapters/mock";
import { resetLimitsForTests } from "../src/adapters/limiter";
import { IntegrationError } from "../src/adapters/systems";
import { listAlerts, resetAlertsForTests } from "../src/lib/alerts";

const has = Boolean(process.env.DATABASE_URL);
const fast = { sleep: async () => undefined };
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

describe.skipIf(!has)("الحمض على قاعدة حقيقية", () => {
  const db = () => getDb();
  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().$disconnect();
  });
  beforeEach(() => {
    resetMocksForTests();
    resetLimitsForTests();
    resetAlertsForTests();
  });

  it("مرجع يدوي: بيدخل «بانتظار الاعتماد» وما بيظهر كمرجع لحد ما المالك يعتمده", async () => {
    const name = "منتج يدوي " + uniq();
    const r = await addManualReference(db(), { name, traits: { problem_clarity: "عالي", repeat: "بيخلص وبينطلب", cost_tier: "أقل من 2.5$", demo: "نتيجة بتنشاف" } });
    const before = (await listReferences(db())).find((x) => x.id === r.id)!;
    expect(before).toMatchObject({ state: "pending", origin: "manual", approvedBy: null });

    const probe = { problem_clarity: "عالي", repeat: "بيخلص وبينطلب", cost_tier: "أقل من 2.5$", demo: "نتيجة بتنشاف" };
    expect((await scoreTraits(db(), probe)).references.find((x) => x.id === r.id)).toBeUndefined();

    await setReferenceState(db(), r.id, "approve", "owner-1");
    const after = (await listReferences(db())).find((x) => x.id === r.id)!;
    expect(after).toMatchObject({ state: "approved", approvedBy: "owner-1" });

    const scored = await scoreTraits(db(), probe);
    const mine = scored.references.find((x) => x.id === r.id)!;
    expect(mine).toBeTruthy();
    expect(mine.matching).toHaveLength(4); // صفاته نفس صفات المرشح بالضبط
    expect(scored.score.score).toBeGreaterThan(80);
    expect(scored.weightsVersion === null || typeof scored.weightsVersion === "number").toBe(true);
  });

  it("رفض مرجع = حذف ناعم، ومرجع بصفات غلط أو بلا اسم مرفوض", async () => {
    const r = await addManualReference(db(), { name: "للرفض " + uniq(), traits: { visible: "نعم" } });
    await setReferenceState(db(), r.id, "reject", "owner-1");
    expect((await listReferences(db())).find((x) => x.id === r.id)).toBeUndefined();
    expect((await db().dnaReference.findUniqueOrThrow({ where: { id: r.id } })).deletedAt).not.toBeNull();
    await expect(addManualReference(db(), { name: "x " + uniq(), traits: { visible: "ممكن" } })).rejects.toBeInstanceOf(DnaError);
    await expect(addManualReference(db(), { name: "  ", traits: {} })).rejects.toBeInstanceOf(DnaError);
    await expect(setReferenceState(db(), "nope", "approve", "x")).rejects.toMatchObject({ code: "not_found" });
    await expect(scoreTraits(db(), { demo: "غلط" })).rejects.toBeInstanceOf(DnaError);
  });

  it("ملف حمض لمنتج مختبر بيتخزّن ويتحدّث بالقيم المسموحة بس", async () => {
    const ref = "pf_" + uniq();
    const a = await setProfile(db(), "product", ref, { problem_clarity: "عالي" }, "owner-1");
    const b = await setProfile(db(), "product", ref, { problem_clarity: "متوسط", visible: "نعم" }, "owner-2");
    expect(b.id).toBe(a.id); // نفس الصف
    expect(b.traitsJson).toEqual({ problem_clarity: "متوسط", visible: "نعم" });
    expect(b.filledBy).toBe("owner-2");
    await expect(setProfile(db(), "product", ref, { problem_clarity: "????" }, "x")).rejects.toBeInstanceOf(DnaError);
  });

  describe("التعلّم من أداء الـ OMS (الوهمي)", () => {
    // الـ OMS الوهمي بيرجّع منتج واحد pf_1880 بأرقام مثال الاختبار (ناجح: ربح الطلب المُسلَّم 6.02$)
    it("منتج بلا ملف حمض ما بيدخل بالحساب (وتنبيه)، وبعد ما ينعبّى ملفه بيدخل كناجح ومعه مرجع مقترح", async () => {
      await db().dnaProfile.deleteMany({ where: { ownerType: "product", ownerId: "pf_1880" } });
      await db().dnaReference.deleteMany({ where: { productRef: "pf_1880" } });
      const versionBefore = (await listWeightSets(db(), 1))[0]?.version ?? 0;

      const none = await runLearning(db(), fast);
      expect(none).toMatchObject({ products: 0, skippedNoProfile: 1, successes: 0, proposedReferences: 0 });
      expect(none.version).toBe(versionBefore + 1);
      expect(listAlerts(5).some((a) => a.type === "dna_missing_profiles")).toBe(true);

      await setProfile(db(), "product", "pf_1880", { problem_clarity: "عالي", repeat: "بيخلص وبينطلب", demo: "نتيجة بتنشاف", cost_tier: "أقل من 2.5$" }, "owner-1");
      const r = await runLearning(db(), fast);
      expect(r).toMatchObject({ products: 1, skippedNoProfile: 0, successes: 1, proposedReferences: 1 });
      expect(r.version).toBe(none.version + 1);

      const { model, version } = await currentModel(db());
      expect(version).toBe(r.version);
      expect(model.products).toBe(1);
      const clarity = model.traits.problem_clarity.values.find((v) => v.value === "عالي")!;
      expect([clarity.count, clarity.successes, clarity.small]).toEqual([1, 1, true]); // عيّنة صغيرة، بحجمها ظاهر
      expect(clarity.rate).toBeCloseTo((1 + 2 * 1.0) / 3, 6);
      expect(model.traits.problem_clarity.known).toBe(1);

      const prop = (await listReferences(db())).find((x) => x.productRef === "pf_1880")!;
      expect(prop).toMatchObject({ origin: "oms", state: "pending" });
      expect(prop.performance).toMatchObject({ source: "oms", returnRate: "25.9%" });

      // إعادة التعلّم ما بتكرر المرجع المقترح
      await runLearning(db(), fast);
      expect(await db().dnaReference.count({ where: { productRef: "pf_1880", deletedAt: null } })).toBe(1);

      // النسخة محفوظة بتاريخها وحجم عيّنتها
      const row = await db().dnaWeightSet.findFirstOrThrow({ where: { version: r.version } });
      expect(row.productsCount).toBe(1);
      expect(Object.keys(row.weightsJson as object).sort()).toEqual(["cost_tier", "demo", "embarrassing", "heritage", "logistics", "problem_clarity", "regulatory", "repeat", "result_speed", "visible"]);
    });

    it("الـ OMS واقف: التعلّم بيفشل بخطأ واضح وبتضل آخر نسخة فعّالة", async () => {
      const before = (await listWeightSets(db(), 1))[0].version;
      mockState().down.oms = true;
      await expect(runLearning(db(), fast)).rejects.toBeInstanceOf(IntegrationError);
      expect((await listWeightSets(db(), 1))[0].version).toBe(before);
      expect((await currentModel(db())).version).toBe(before);
    });

    it("شرح A05 اختياري: بينحفظ إذا نجح، وفشله ما بيوقف التعلّم", async () => {
      const ok = await runLearning(db(), { ...fast, explain: async () => "سرعة النتيجة صارت أهم" });
      expect(ok.explanation).toBe("سرعة النتيجة صارت أهم");
      const failed = await runLearning(db(), {
        ...fast,
        explain: async () => {
          throw new Error("الموديل واقف");
        },
      });
      expect(failed.explanation).toBeNull();
      expect(failed.version).toBe(ok.version + 1);
    });
  });
});
