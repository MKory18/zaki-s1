import { expect, test } from "@playwright/test";

const GATEWAY = {
  monthlyBudgetMicro: 100000000,
  providers: [
    { id: "glm", name: "GLM", baseUrl: "http://127.0.0.1:3218/ok", keyEnv: "GLM_API_KEY", enabled: true, internal: false },
    { id: "kimi", name: "Kimi", baseUrl: "http://127.0.0.1:3218/junk", keyEnv: "KIMI_API_KEY", enabled: true, internal: false },
  ],
  models: [
    { id: "m-ok", providerId: "glm", model: "glm-ok", priceInPerMTok: 500000, priceOutPerMTok: 1000000 },
    { id: "m-junk", providerId: "kimi", model: "kimi-junk", priceInPerMTok: 500000, priceOutPerMTok: 1000000 },
  ],
  agents: [],
};

const A06_VARS = { title_ar: "زيت إكليل الجبل", problem: "تساقط الشعر", image_caption: "زجاجة زيت", lane: "manual", trend_age_days: 12, intent_ratio: 0.11 };

test.describe("الوكلاء ومركز البرومبتات", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("تشغيل وكيل، فشل مكشوف، إيقاف وتفعيل، وسجل التشغيل", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();

    expect((await page.request.put("/api/gateway/config", { data: GATEWAY })).status()).toBe(200);
    // نبدأ من حالة معروفة (الاختبار قابل للإعادة على نفس القاعدة)
    expect((await page.request.patch("/api/agents/A06", { data: { enabled: true, dailyBudgetUsd: 1 } })).status()).toBe(200);
    const tiers = { label: "درجات", items: { cheapest: { primary: "m-ok" }, cheap: { primary: "m-junk" }, strong: { primary: "m-ok" } } };
    expect((await page.request.put("/api/settings", { data: { key: "agents.tiers", value: tiers } })).status()).toBe(200);

    // الماسح (A06): مخرج صالح
    const ok = await page.request.post("/api/agents/A06/run", { data: { vars: A06_VARS } });
    expect(ok.status()).toBe(200);
    const body = await ok.json();
    expect(body.output).toEqual({ verdict: "continue", reason: "زيت شعر بمشكلة واضحة" });
    expect(body.attempts).toBe(1);

    // كشّاف الأسواق (A01) على موديل بيرجّع نص مش JSON: فشل مسجّل بلا نتيجة مفبركة
    const bad = await page.request.post("/api/agents/A01/run", { data: { vars: { page_text: "x", images: [], site: "aliexpress", url: "https://example.com", captured_at: "2026-10-27" } } });
    expect(bad.status()).toBe(502);
    expect((await bad.json()).error.message).toContain("مخرج غلط مرتين");

    // متغيّر ناقص: 400 بلا استدعاء
    const missing = await page.request.post("/api/agents/A06/run", { data: { vars: {} } });
    expect(missing.status()).toBe(400);
    expect((await missing.json()).error.message).toContain("متغيّرات ناقصة");

    // الشاشة: 19 وكيل وسجل التشغيل
    await page.goto("/agents");
    await expect(page.getByRole("heading", { name: "الوكلاء", exact: true })).toBeVisible();
    await expect(page.locator("tr[data-agent]")).toHaveCount(19);
    await expect(page.getByText("تمّ").first()).toBeVisible();
    await expect(page.getByText(/مخرج غلط/).first()).toBeVisible();

    // إيقاف A06 ثم تفعيله
    const row = page.locator('tr[data-agent="A06"]');
    await expect(async () => {
      await row.getByRole("button", { name: "إيقاف A06" }).click();
      await expect(row.getByRole("button", { name: "تفعيل A06" })).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 15_000 });
    const blocked = await page.request.post("/api/agents/A06/run", { data: { vars: A06_VARS } });
    expect(blocked.status()).toBe(409);
    await row.getByRole("button", { name: "تفعيل A06" }).click();
    await expect(row.getByRole("button", { name: "إيقاف A06" })).toBeVisible();
    expect((await page.request.post("/api/agents/A06/run", { data: { vars: A06_VARS } })).status()).toBe(200);

    // التعديل بالتدقيق
    const audit = await (await page.request.get("/api/audit?limit=200")).json();
    expect(audit.entries.some((e: { entity: string; entityId: string }) => e.entity === "Agent" && e.entityId === "A06")).toBe(true);
  });

  test("وكيل بسقف صفر بينوقف", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    expect((await page.request.put("/api/gateway/config", { data: GATEWAY })).status()).toBe(200);
    expect((await page.request.put("/api/settings", { data: { key: "agents.tiers", value: { label: "درجات", items: { cheapest: { primary: "m-ok" } } } } })).status()).toBe(200);
    expect((await page.request.patch("/api/agents/A06", { data: { enabled: true, dailyBudgetUsd: 0 } })).status()).toBe(200);
    const r = await page.request.post("/api/agents/A06/run", { data: { vars: A06_VARS } });
    expect(r.status()).toBe(429);
    expect((await page.request.patch("/api/agents/A06", { data: { dailyBudgetUsd: 1 } })).status()).toBe(200);
    expect((await page.request.patch("/api/agents/A06", { data: { dailyBudgetUsd: -5 } })).status()).toBe(400);
  });

  test("مركز البرومبتات: تعديل بنسخة جديدة، مقارنة، تجربة، ورجوع", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    const list = await (await page.request.get("/api/prompts")).json();
    expect(list.prompts.length).toBe(20);

    await page.goto("/prompts/H02");
    await expect(page.getByRole("heading", { name: /حَكَم المكرر/ })).toBeVisible();
    const editor = page.getByLabel("نص البرومبت");
    const original = await editor.inputValue();
    expect(original).toContain("{{a}}");

    await expect(async () => {
      await editor.fill(original + "\nملاحظة اختبار المتصفح");
      await page.getByRole("button", { name: "احفظ كنسخة جديدة" }).click();
      await expect(page.getByText(/انحفظت نسخة \d+/)).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 15_000 });

    const detail = await (await page.request.get("/api/prompts/H02")).json();
    const newest = detail.versions[0];
    expect(newest.body).toContain("ملاحظة اختبار المتصفح");
    expect(newest.active).toBe(true);

    const diff = await (await page.request.get(`/api/prompts/H02/diff?a=${newest.version - 1}&b=${newest.version}`)).json();
    expect(diff.diff.filter((l: { type: string }) => l.type === "add").length).toBeGreaterThan(0);

    const rb = await page.request.post("/api/prompts/H02/rollback", { data: { version: 1 } });
    expect(rb.status()).toBe(200);
    const after = await (await page.request.get("/api/prompts/H02")).json();
    expect(after.versions[0].body).toBe(detail.versions.at(-1).body);
    expect(after.versions.length).toBe(detail.versions.length + 1);

    // تجربة على مدخل نموذجي: بتمرّ من البوابة (H02 داخلي بلا موديل مضبوط = خطأ واضح بدل نتيجة)
    const t = await page.request.post("/api/prompts/H02/test", { data: { vars: { a: {}, b: {}, scores: {} } } });
    expect([409, 200, 502]).toContain(t.status());
    expect((await page.request.post("/api/prompts/H02/versions", { data: { body: "   " } })).status()).toBe(400);
    expect((await page.request.post("/api/prompts/NOPE/versions", { data: { body: "x" } })).status()).toBe(404);
  });

  test("بلا دخول: كل نقاط الوكلاء والبرومبتات 401", async ({ request }) => {
    for (const p of ["/api/agents", "/api/agent-runs", "/api/prompts", "/api/prompts/A06", "/api/prompts/A06/diff?a=1&b=1"]) {
      expect((await request.get(p)).status(), p).toBe(401);
    }
    for (const p of ["/api/agents/A06/run", "/api/prompts/A06/test", "/api/prompts/A06/versions", "/api/prompts/A06/rollback"]) {
      expect((await request.post(p, { data: {} })).status(), p).toBe(401);
    }
    expect((await request.patch("/api/agents/A06", { data: { enabled: false } })).status()).toBe(401);
  });
});
