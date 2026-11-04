// قاعدة حقيقية (DATABASE_URL): الوكلاء والبرومبتات مبذورة، تشغيل بتكلفة، فشل مسجّل، سقف صفر، ونسخ البرومبتات.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { setSetting } from "../src/lib/settings";
import { setGatewayConfig } from "../src/gateway/config";
import { AgentRunError } from "../src/agents/runner";
import { createVersion, lineDiff, listRuns, loadAgent, rollbackVersion, runAgent } from "../src/agents/service";
import { validateShape } from "../src/agents/shape";
import { resetAlertsForTests, listAlerts } from "../src/lib/alerts";
import { resetUsageForTests } from "../src/gateway/usage";
import { TOOLS, callTool } from "../src/agents/tools";

const has = Boolean(process.env.DATABASE_URL);
const ENV = { FAKE_KEY: "k" };

function fake(replies: string[]): typeof fetch {
  let i = 0;
  return (async () =>
    Response.json({ choices: [{ message: { content: replies[Math.min(i++, replies.length - 1)] } }], usage: { prompt_tokens: 2000, completion_tokens: 200 } })) as typeof fetch;
}

describe.skipIf(!has)("الوكلاء والبرومبتات على قاعدة حقيقية", () => {
  const db = () => getDb();
  let seeded: Awaited<ReturnType<typeof importSeeds>>;

  beforeAll(async () => {
    seeded = await importSeeds(db());
    setGatewayConfig({
      providers: [{ id: "fk", name: "وهمي", baseUrl: "https://fake.test/v1", keyEnv: "FAKE_KEY", enabled: true, internal: false }],
      models: [{ id: "m-fk", providerId: "fk", model: "fake-1", priceInPerMTok: 500_000, priceOutPerMTok: 1_000_000 }],
      agents: [],
      monthlyBudgetMicro: 100_000_000,
    });
    await setSetting(db(), "agents.tiers", { label: "درجات", items: { cheapest: { primary: "m-fk" }, cheap: { primary: "m-fk" }, strong: { primary: "m-fk" } } }, "test");
    await db().agent.update({ where: { code: "A06" }, data: { enabled: true, dailyBudgetUsd: 1 } });
    resetAlertsForTests();
    resetUsageForTests();
  });
  afterAll(async () => {
    await db().$disconnect();
  });

  it("19 وكيل و20 برومبت (مع الرأس المشترك) بحقولهم", async () => {
    expect(await db().agent.count()).toBe(19);
    expect(await db().prompt.count()).toBe(20);
    expect(seeded.agents.total).toBe(19);
    const a07 = await db().agent.findUniqueOrThrow({ where: { code: "A07" } });
    expect(a07).toMatchObject({ nameAr: "المحقق", team: "التقييم", modelRoute: "strong", maxCallsPerDay: 40 });
    expect(a07.dailyBudgetUsd.toString()).toBe("5");
    const h01 = await db().agent.findUniqueOrThrow({ where: { code: "H01" } });
    expect(h01.modelRoute).toBe("internal");
    expect(h01.dailyBudgetUsd.toString()).toBe("0");
    expect(h01.maxCallsPerDay).toBe(100000);
    const a05 = await db().agent.findUniqueOrThrow({ where: { code: "A05" } });
    expect(a05.dailyBudgetUsd.toString()).toBe("0.5");
  });

  it("أدوات كل وكيل مسموحة من السجل بس", async () => {
    for (const a of await db().agent.findMany()) {
      for (const t of a.tools as string[]) expect(Object.keys(TOOLS)).toContain(t);
    }
  });

  it("كل مثال بالبرومبتات المحفوظة بيطابق شكلها", async () => {
    for (const a of await db().agent.findMany()) {
      const { meta } = await loadAgent(db(), a.code);
      if (!meta.textOutput) expect(validateShape(meta.shape!, meta.example), a.code).toEqual([]);
    }
  });

  it("تشغيل تجريبي بيتسجّل بتكلفته بجدول AgentRun", async () => {
    const r = await runAgent(db(), "A06", { title_ar: "زيت", problem: "تساقط", image_caption: "زجاجة", lane: "manual", trend_age_days: 10, intent_ratio: 0.1 }, {
      inputRef: "t1", override: { fetchImpl: fake(['{"verdict":"continue","reason":"سبب"}']), env: ENV },
    });
    expect(r.output).toEqual({ verdict: "continue", reason: "سبب" });
    const run = (await listRuns(db(), 5)).find((x) => x.inputRef === "t1")!;
    expect(run).toMatchObject({ agentCode: "A06", status: "ok", model: "fake-1", tokensIn: 2000, tokensOut: 200 });
    expect(run.costUsd).toBe("0.0012"); // 2000*0.5 + 200*1 = 1200 وحدة = 0.0012$
  });

  it("مخرج غلط مرتين = فشل مسجّل بلا نتيجة", async () => {
    const vars = { title_ar: "زيت", problem: "x", image_caption: "x", lane: "manual", trend_age_days: 1, intent_ratio: 0.1 };
    await expect(runAgent(db(), "A06", vars, { inputRef: "t2", override: { fetchImpl: fake(["مش JSON", '{"verdict":"x"}']), env: ENV } })).rejects.toMatchObject({ code: "invalid_output" });
    const run = (await listRuns(db(), 10)).find((x) => x.inputRef === "t2")!;
    expect(run.status).toBe("invalid_output");
    expect(run.error).toContain("مخرج غلط مرتين");
  });

  it("وكيل بسقف صفر بيوقف وبيطلّع تنبيه، والموقوف بيتسجّل", async () => {
    await db().agent.update({ where: { code: "A06" }, data: { dailyBudgetUsd: 0 } });
    const vars = { title_ar: "زيت", problem: "x", image_caption: "x", lane: "manual", trend_age_days: 1, intent_ratio: 0.1 };
    await expect(runAgent(db(), "A06", vars, { inputRef: "t3", override: { fetchImpl: fake(["{}"]), env: ENV } })).rejects.toMatchObject({ code: "budget" });
    expect((await listRuns(db(), 10)).find((x) => x.inputRef === "t3")?.status).toBe("blocked_budget");
    expect(listAlerts(5).some((a) => a.type === "budget")).toBe(true);
    await db().agent.update({ where: { code: "A06" }, data: { dailyBudgetUsd: 1, enabled: false } });
    await expect(runAgent(db(), "A06", vars, { override: { fetchImpl: fake(["{}"]), env: ENV } })).rejects.toBeInstanceOf(AgentRunError);
    await db().agent.update({ where: { code: "A06" }, data: { enabled: true } });
  });

  it("درجة بلا موديل مضبوط = خطأ واضح بلا استدعاء (kimi)", async () => {
    await expect(runAgent(db(), "A02", { rows: [], keyword: "x", today: "2026-10-01", lexicon: {} }, { override: { fetchImpl: fake(["{}"]), env: ENV } })).rejects.toMatchObject({ code: "no_tier" });
  });

  it("مركز البرومبتات: نسخة جديدة، مقارنة، رجوع بنسخة جديدة", async () => {
    const before = await db().prompt.findUniqueOrThrow({ where: { code: "H02" }, include: { versions: true } });
    const v1 = before.versions.find((v) => v.version === 1)!;
    const v2 = await createVersion(db(), "H02", v1.body + "\nسطر إضافي للتجربة", "owner-1", "تجربة");
    expect(v2.version).toBe(before.versions.length + 1);
    expect((await db().prompt.findUniqueOrThrow({ where: { code: "H02" } })).activeVersionId).toBe(v2.id);
    expect(lineDiff(v1.body, v2.body).filter((l) => l.type === "add").map((l) => l.text)).toEqual(["سطر إضافي للتجربة"]);
    const back = await rollbackVersion(db(), "H02", 1, "owner-2");
    expect(back.version).toBe(v2.version + 1);
    expect(back.body).toBe(v1.body);
    expect(back.note).toBe("رجوع لنسخة 1");
    await expect(createVersion(db(), "H02", "  ", "x")).rejects.toThrow();
    await expect(rollbackVersion(db(), "H02", 99, "x")).rejects.toThrow();
  });

  it("الأدوات: قراءة المكتبات شغّالة، ومسودة بحالة «مسودة»، وغير المسموح مرفوض", async () => {
    const claims = (await callTool(db(), ["read_claims"], "read_claims")) as unknown[];
    expect(claims.length).toBe(16);
    const d = (await callTool(db(), ["save_draft"], "save_draft", { kind: "rfq", body: "طلب عرض سعر" })) as { status: string };
    expect(d.status).toBe("draft");
    await expect(callTool(db(), ["save_draft"], "save_draft", { kind: "send_now", body: "x" })).rejects.toThrow();
    await expect(callTool(db(), ["read_claims"], "save_draft", { kind: "rfq", body: "x" })).rejects.toThrow();
    await db().draftMessage.deleteMany({ where: { body: "طلب عرض سعر" } });
  });

  it("إعادة استيراد البذور ما بتكرر الوكلاء ولا بتكتب فوق التعديل", async () => {
    await db().agent.update({ where: { code: "A09" }, data: { dailyBudgetUsd: 7 } });
    const again = await importSeeds(db());
    expect(again.agents.created).toBe(0);
    expect(again.prompts.created).toBe(0);
    expect((await db().agent.findUniqueOrThrow({ where: { code: "A09" } })).dailyBudgetUsd.toString()).toBe("7");
    await db().agent.update({ where: { code: "A09" }, data: { dailyBudgetUsd: 0.5 } });
  });
});
