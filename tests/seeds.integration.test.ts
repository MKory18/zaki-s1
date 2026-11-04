// قاعدة حقيقية (DATABASE_URL): استيراد البذور مرتين ما بيكرر، والإعدادات بنسخ مع رجوع، وبقاء المستخدمين بعد إعادة التشغيل.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds, loadSeedData } from "../src/seeds/import";
import { getSetting, listSettings, listVersions, rollbackSetting, setSetting, SettingError } from "../src/lib/settings";
import { ensureHydrated, drain } from "../src/lib/persist";
import { ensureUser, getUser, resetUsersForTests, setRole } from "../src/lib/users";
import { listAudit, recordAudit, resetAuditForTests } from "../src/lib/audit";

const has = Boolean(process.env.DATABASE_URL);
const data = loadSeedData();

describe.skipIf(!has)("البذور والإعدادات على قاعدة حقيقية", () => {
  const db = () => getDb();
  let first: Awaited<ReturnType<typeof importSeeds>>;

  beforeAll(async () => {
    first = await importSeeds(db());
  });
  afterAll(async () => {
    await db().$disconnect();
  });

  it("عدد السجلات بكل مكتبة مطابق للملف", async () => {
    const d = db();
    expect(await d.problem.count()).toBe(22);
    expect(await d.referenceText.count({ where: { kind: { in: ["hadith", "quran"] } } })).toBe(9);
    expect(await d.referenceText.count({ where: { kind: "heritage" } })).toBe(13);
    expect(await d.ingredient.count({ where: { status: "allowed" } })).toBe(25);
    expect(await d.ingredient.count({ where: { status: { in: ["banned", "restricted"] } } })).toBe(11);
    expect(await d.claimRule.count()).toBe(16);
    expect(await d.adPolicyRule.count()).toBe(10);
    expect(await d.rejectReason.count()).toBe(12);
    expect(await d.dnaReference.count()).toBe(3);
    expect(await d.brandRegistry.count()).toBe(6);
    expect(await d.market.count()).toBe(2);
    expect(await d.testPage.count()).toBe(3);
    expect(await d.keyword.count()).toBe(18);
    expect((await listSettings(d)).filter((s) => !s.key.startsWith("test.") && !s.key.startsWith("gateway.")).length).toBe(88);
    expect(first.problems.total).toBe(22);
  });

  it("النصوص: زمزم بيوقف لقرار مختص والباقي بانتظار المراجع", async () => {
    const d = db();
    expect((await d.referenceText.findUniqueOrThrow({ where: { code: "REF-09" } })).reviewStatus).toBe("needs_specialist");
    expect(await d.referenceText.count({ where: { code: { startsWith: "REF-" }, reviewStatus: "pending" } })).toBe(8);
  });

  it("إعادة الاستيراد ما بتكرر شي ولا بتكتب فوق تعديل المالك", async () => {
    const d = db();
    const before = {
      problems: await d.problem.count(),
      claims: await d.claimRule.count(),
      keywords: await d.keyword.count(),
      creators: await d.setting.count({ where: { key: "reject.max_creators" } }),
    };
    await setSetting(d, "reject.max_creators", { label: "أقصى عدد صنّاع", raw: "350" }, "owner-1");
    const second = await importSeeds(d, data);
    for (const r of Object.values(second)) expect(r.created).toBe(0);
    expect(await d.problem.count()).toBe(before.problems);
    expect(await d.claimRule.count()).toBe(before.claims);
    expect(await d.keyword.count()).toBe(before.keywords);
    // إعادة الاستيراد ما أضافت نسخ: نسخة المالك الجديدة بس (باقي المفاتيح بتتغيّر من اختبارات تانية بنفس الوقت، فبنفحص المفتاح نفسه)
    expect(await d.setting.count({ where: { key: "reject.max_creators" } })).toBe(before.creators + 1);
    expect(await d.setting.count({ where: { key: "velocity.w.age" } })).toBe(1);
    expect(((await getSetting(d, "reject.max_creators"))!.value as { raw: string }).raw).toBe("350");
    // نرجّع القيمة الأصلية عشان ما نوسّخ القاعدة لاختبارات تانية (الحدود بتأثر بحسابات الرفض)
    await setSetting(d, "reject.max_creators", { label: "أقصى عدد صنّاع", raw: "400" }, "owner-1");
  });

  it("الإعدادات بنسخ: تعديل ← نسخة جديدة، رجوع ← نسخة جديدة بالقيمة القديمة", async () => {
    const d = db();
    const key = "test.versions_" + Date.now(); // مفتاح جديد لكل تشغيل
    const first = await setSetting(d, key, { label: "تجربة", raw: "10" }, "owner-0");
    expect(first.after.version).toBe(1);
    const { after } = await setSetting(d, key, { label: "تجربة", raw: "12" }, "owner-1");
    expect(after.version).toBe(2);
    expect(after.updatedBy).toBe("owner-1");
    const back = await rollbackSetting(d, key, 1, "owner-2");
    expect(back.after.version).toBe(3);
    expect((back.after.value as { raw: string }).raw).toBe("10");
    const versions = await listVersions(d, key);
    expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
    await expect(rollbackSetting(d, key, 99, "x")).rejects.toBeInstanceOf(SettingError);
    await expect(setSetting(d, "bad key", {}, "x")).rejects.toBeInstanceOf(SettingError);
  });

  it("المستخدمين والتدقيق بيضلوا بعد إعادة التشغيل", async () => {
    const env = process.env as Record<string, string | undefined>;
    const prev = env.NODE_ENV;
    env.NODE_ENV = "development"; // الحفظ بالقاعدة مطفي بوضع الاختبار
    try {
      const g = globalThis as unknown as { __s1Hydrate?: unknown };
      g.__s1Hydrate = undefined;
      resetUsersForTests();
      resetAuditForTests();
      await ensureHydrated();
      const sub = "persist-" + Date.now();
      ensureUser(sub, "مستخدم دائم", "");
      setRole(sub, "researcher");
      recordAudit({ actorId: sub, action: "test.persist", entity: "X", entityId: "1", before: null, after: { ok: true, apiToken: "SECRET" } });
      await drain();

      // «إعادة تشغيل»: نمسح الذاكرة وحالة القراءة
      resetUsersForTests();
      resetAuditForTests();
      g.__s1Hydrate = undefined;
      await ensureHydrated();
      expect(getUser(sub)).toMatchObject({ name: "مستخدم دائم", role: "researcher", active: true });
      const entry = listAudit(50).find((e) => e.action === "test.persist");
      expect(entry).toBeTruthy();
      expect(JSON.stringify(entry!.after)).not.toContain("SECRET");
      const row = await db().auditLog.findFirst({ where: { action: "test.persist" }, orderBy: { createdAt: "desc" } });
      expect(JSON.stringify(row?.afterJson)).not.toContain("SECRET");
    } finally {
      env.NODE_ENV = prev;
    }
  });
});
