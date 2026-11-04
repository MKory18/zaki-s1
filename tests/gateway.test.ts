import { beforeEach, describe, expect, it } from "vitest";
import { callModel, containsPersonalData, costMicro } from "../src/gateway/gateway";
import { ConfigError, validateConfig } from "../src/gateway/config";
import { listUsage, resetUsageForTests, spentToday, ammanDay } from "../src/gateway/usage";
import { listAlerts, resetAlertsForTests } from "../src/lib/alerts";
import { GatewayError, type GatewayConfig } from "../src/gateway/types";

const ENV = { GLM_API_KEY: "k1", KIMI_API_KEY: "k2", INTERNAL_MODEL_KEY: "k3" };

function cfg(over: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    providers: [
      { id: "glm", name: "GLM", baseUrl: "https://glm.test/v1", keyEnv: "GLM_API_KEY", enabled: true, internal: false },
      { id: "kimi", name: "Kimi", baseUrl: "https://kimi.test/v1", keyEnv: "KIMI_API_KEY", enabled: true, internal: false },
      { id: "internal", name: "داخلي", baseUrl: "http://llm.local/v1", keyEnv: "INTERNAL_MODEL_KEY", enabled: true, internal: true },
    ],
    models: [
      { id: "m-glm", providerId: "glm", model: "glm-x", priceInPerMTok: 500_000, priceOutPerMTok: 2_000_000 },
      { id: "m-kimi", providerId: "kimi", model: "kimi-x", priceInPerMTok: 1_000_000, priceOutPerMTok: 3_000_000 },
      { id: "m-int", providerId: "internal", model: "local-x", priceInPerMTok: 0, priceOutPerMTok: 0 },
    ],
    agents: [
      { agent: "scanner", primary: "m-glm", fallback: "m-kimi", temperature: 0.2, maxTokens: 500, dailyBudgetMicro: 1_000_000 },
      { agent: "zero", primary: "m-glm", temperature: 0, maxTokens: 100, dailyBudgetMicro: 0 },
      { agent: "internal-fb", primary: "m-glm", fallback: "m-int", temperature: 0, maxTokens: 100, dailyBudgetMicro: 1_000_000 },
    ],
    monthlyBudgetMicro: 0,
    ...over,
  };
}

function okFetch(urls: string[] = [], tokens = { p: 1000, c: 200 }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return Response.json({ choices: [{ message: { content: "جواب" } }], usage: { prompt_tokens: tokens.p, completion_tokens: tokens.c } });
  }) as typeof fetch;
}

// المزوّد glm واقع، والباقي شغّال
function glmDownFetch(urls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const u = String(input);
    urls.push(u);
    if (u.includes("glm.test")) return new Response("boom", { status: 503 });
    return Response.json({ choices: [{ message: { content: "من البديل" } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }) as typeof fetch;
}

beforeEach(() => {
  resetUsageForTests();
  resetAlertsForTests();
});

const msgs = [{ role: "user" as const, content: "مرحبا" }];

describe("بوابة الموديلات", () => {
  it("سؤال تجريبي بيرجع جواب وبيتسجّل بالتكلفة", async () => {
    const urls: string[] = [];
    const r = await callModel({ agent: "scanner", messages: msgs, config: cfg(), fetchImpl: okFetch(urls), env: ENV });
    expect(r.content).toBe("جواب");
    expect(urls[0]).toBe("https://glm.test/v1/chat/completions");
    // 1000*500000/1e6 + 200*2000000/1e6 = 500 + 400 = 900
    expect(r.costMicro).toBe(900);
    const [u] = listUsage(1);
    expect(u).toMatchObject({ agent: "scanner", model: "glm-x", tokensIn: 1000, tokensOut: 200, costMicro: 900, result: "ok", isFallback: false });
    expect(spentToday("scanner").costMicro).toBe(900);
  });

  it("إيقاف المزوّد الأول بيخلّي البديل يرد (ومسجّل + تنبيه)", async () => {
    const r = await callModel({ agent: "scanner", messages: msgs, config: cfg(), fetchImpl: glmDownFetch(), env: ENV });
    expect(r.usedFallback).toBe(true);
    expect(r.model).toBe("kimi-x");
    const log = listUsage(5);
    expect(log.map((e) => e.result).sort()).toEqual(["error", "ok"]);
    expect(log.find((e) => e.result === "error")?.model).toBe("glm-x");
    expect(listAlerts(5)[0].type).toBe("model_fallback");
  });

  it("وكيل بسقف صفر بينرفض قبل أي استدعاء", async () => {
    const urls: string[] = [];
    await expect(callModel({ agent: "zero", messages: msgs, config: cfg(), fetchImpl: okFetch(urls), env: ENV })).rejects.toMatchObject({ code: "budget" });
    expect(urls).toEqual([]);
    expect(listUsage(1)[0].result).toBe("blocked_budget");
    expect(listAlerts(1)[0].type).toBe("budget");
  });

  it("الميزانية اليومية: لما تخلص بينوقف", async () => {
    const c = cfg();
    c.agents[0].dailyBudgetMicro = 1000;
    await callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV }); // 900
    await callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV }); // 1800 >= 1000 بعدها
    await expect(callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV })).rejects.toMatchObject({ code: "budget" });
  });

  it("سقف عدد الاستدعاءات والسقف الشهري للكل", async () => {
    const c = cfg();
    c.agents[0].maxCallsPerDay = 1;
    await callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV });
    await expect(callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV })).rejects.toMatchObject({ code: "budget" });

    resetUsageForTests();
    const m = cfg({ monthlyBudgetMicro: 500 });
    await callModel({ agent: "scanner", messages: msgs, config: m, fetchImpl: okFetch(), env: ENV });
    await expect(callModel({ agent: "scanner", messages: msgs, config: m, fetchImpl: okFetch(), env: ENV })).rejects.toMatchObject({ code: "budget" });
  });

  it("بيانات الأشخاص ما بتروح لموديل خارجي", async () => {
    const urls: string[] = [];
    const bad = [{ role: "user" as const, content: "كلّم الزبون على 0791234567" }];
    await expect(callModel({ agent: "scanner", messages: bad, config: cfg(), fetchImpl: okFetch(urls), env: ENV })).rejects.toMatchObject({ code: "pii" });
    expect(urls).toEqual([]);
    expect(listUsage(5).every((e) => e.result === "blocked_pii")).toBe(true);
    expect(containsPersonalData([{ role: "user", content: "a@b.com" }])).toBe(true);
    expect(containsPersonalData([{ role: "user", content: "سعر 25 دولار وعدد 400" }])).toBe(false);
  });

  it("البديل الداخلي بياخد المحتوى الحساس بدل الخارجي", async () => {
    const urls: string[] = [];
    const bad = [{ role: "user" as const, content: "ايميل الزبون a@b.com" }];
    const r = await callModel({ agent: "internal-fb", messages: bad, config: cfg(), fetchImpl: okFetch(urls), env: ENV });
    expect(r.model).toBe("local-x");
    expect(urls).toEqual(["http://llm.local/v1/chat/completions"]);
  });

  it("المفتاح ناقص = خطأ مسجّل، وبعدين البديل", async () => {
    const r = await callModel({ agent: "scanner", messages: msgs, config: cfg(), fetchImpl: okFetch(), env: { KIMI_API_KEY: "k2" } });
    expect(r.model).toBe("kimi-x");
    expect(listUsage(5).some((e) => e.result === "error" && e.error?.includes("مش مضبوط"))).toBe(true);
  });

  it("فشل الكل = خطأ بالعربي، وكذلك لو كل المزوّدين موقوفين", async () => {
    const down = (async () => new Response("x", { status: 500 })) as typeof fetch;
    await expect(callModel({ agent: "scanner", messages: msgs, config: cfg(), fetchImpl: down, env: ENV })).rejects.toBeInstanceOf(GatewayError);
    const c = cfg();
    c.providers[0].enabled = false;
    c.providers[1].enabled = false;
    await expect(callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: okFetch(), env: ENV })).rejects.toMatchObject({ code: "failed" });
  });

  it("وكيل مجهول بينرفض، والمهلة بتتسجّل timeout", async () => {
    const slow = ((_u: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener("abort", () => rej(Object.assign(new Error("t"), { name: "TimeoutError" }))))) as typeof fetch;
    await expect(callModel({ agent: "nobody", messages: msgs, config: cfg(), fetchImpl: slow, env: ENV })).rejects.toMatchObject({ code: "unknown_agent" });
    const c = cfg();
    c.agents[0].fallback = undefined;
    await expect(callModel({ agent: "scanner", messages: msgs, config: c, fetchImpl: slow, env: ENV, timeoutMs: 20 })).rejects.toBeInstanceOf(GatewayError);
    expect(listUsage(1)[0].result).toBe("timeout");
  });

  it("التكلفة بأعداد صحيحة وبتتقرّب لفوق", () => {
    const m = { id: "x", providerId: "p", model: "x", priceInPerMTok: 150_000, priceOutPerMTok: 600_000 };
    expect(costMicro(m, 1, 0)).toBe(1); // 0.15 → 1
    expect(costMicro(m, 1_000_000, 1_000_000)).toBe(750_000);
    expect(Number.isInteger(costMicro(m, 12345, 6789))).toBe(true);
  });

  it("اليوم بتوقيت عمّان", () => {
    expect(ammanDay("2026-10-27T21:30:00Z")).toBe("2026-10-28"); // بعد منتصف الليل بعمّان
  });
});

describe("تحقق الإعدادات", () => {
  it("بيقبل إعدادات صحيحة", () => {
    expect(validateConfig(cfg()).agents.length).toBe(3);
  });

  it("بيرفض مرجع ناقص، مفتاح بصيغة قيمة، تسعيرة عائمة، وعنوان بلا http", () => {
    const bad = (mut: (c: GatewayConfig) => void) => {
      const c = cfg();
      mut(c);
      return () => validateConfig(c);
    };
    expect(bad((c) => (c.agents[0].primary = "nope"))).toThrow(ConfigError);
    expect(bad((c) => (c.providers[0].keyEnv = "sk-abc123"))).toThrow(ConfigError);
    expect(bad((c) => (c.models[0].priceInPerMTok = 0.5))).toThrow(ConfigError);
    expect(bad((c) => (c.providers[0].baseUrl = "ftp://x"))).toThrow(ConfigError);
    expect(bad((c) => (c.agents[0].dailyBudgetMicro = -1))).toThrow(ConfigError);
    expect(() => validateConfig(null)).toThrow(ConfigError);
  });
});
