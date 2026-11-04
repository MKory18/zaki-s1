import { expect, test } from "@playwright/test";

const CONFIG = {
  monthlyBudgetMicro: 0,
  providers: [
    { id: "glm", name: "GLM", baseUrl: "http://127.0.0.1:3218/ok", keyEnv: "GLM_API_KEY", enabled: true, internal: false },
    { id: "kimi", name: "Kimi", baseUrl: "http://127.0.0.1:3218/down", keyEnv: "KIMI_API_KEY", enabled: true, internal: false },
  ],
  models: [
    { id: "m-glm", providerId: "glm", model: "glm-x", priceInPerMTok: 500000, priceOutPerMTok: 2000000 },
    { id: "m-kimi", providerId: "kimi", model: "kimi-x", priceInPerMTok: 1000000, priceOutPerMTok: 3000000 },
  ],
  agents: [
    { agent: "tester", primary: "m-kimi", fallback: "m-glm", temperature: 0.2, maxTokens: 200, dailyBudgetMicro: 5000000 },
    { agent: "zero", primary: "m-glm", temperature: 0, maxTokens: 100, dailyBudgetMicro: 0 },
  ],
};

test("البوابة: سؤال تجريبي، البديل، السقف صفر، والمفاتيح ما بتطلع", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
  await expect(page.getByText("دورك: مالك")).toBeVisible();

  const put = await page.request.put("/api/gateway/config", { data: CONFIG });
  expect(put.status()).toBe(200);
  const view = await put.json();
  expect(view.providers[0].keySet).toBe(true);
  expect(JSON.stringify(view)).not.toContain("must-not-leak");

  const get = await page.request.get("/api/gateway/config");
  expect(await get.text()).not.toContain("must-not-leak");

  // الأساسي (kimi) واقع ← البديل (glm) بيرد
  const ok = await page.request.post("/api/gateway/test", { data: { agent: "tester", prompt: "مرحبا" } });
  expect(ok.status()).toBe(200);
  const body = await ok.json();
  expect(body.content).toBe("رد تجريبي");
  expect(body.usedFallback).toBe(true);

  // سقف صفر ← رفض
  const zero = await page.request.post("/api/gateway/test", { data: { agent: "zero", prompt: "مرحبا" } });
  expect(zero.status()).toBe(429);

  const usage = await (await page.request.get("/api/gateway/usage")).json();
  expect(usage.entries.some((e: { result: string }) => e.result === "error")).toBe(true);
  expect(usage.entries.some((e: { result: string }) => e.result === "blocked_budget")).toBe(true);
  expect(usage.alerts.length).toBeGreaterThan(0);

  // الشاشة
  await page.goto("/gateway");
  await expect(page.getByRole("heading", { name: "بوابة الموديلات" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "آخر الاستدعاءات" })).toBeVisible();
  await expect(async () => {
    await page.getByLabel("سؤال").fill("اختبار الشاشة");
    await page.getByRole("button", { name: "جرّب" }).click();
    await expect(page.getByText("رد تجريبي")).toBeVisible({ timeout: 3000 });
  }).toPass({ timeout: 15_000 });
});

test("بلا دخول ما حدا بيوصل للبوابة", async ({ request }) => {
  for (const p of ["/api/gateway/config", "/api/gateway/usage"]) {
    expect((await request.get(p)).status()).toBe(401);
  }
});
