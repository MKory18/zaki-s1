import { expect, test } from "@playwright/test";

test.describe("الحاسبة", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("الشاشة: مثال ماء الكمأة، مثال الاختبار، والمؤشر مع الرفض", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();
    await page.goto("/calc");
    await expect(page.getByRole("heading", { name: "الحاسبة" })).toBeVisible();

    // قبل الاختبار: تكلفة 1.56 دينار، سعر 20، توصيل 2.5، مرتجع 25%، هامش 30% (الافتراضيات من إعدادات السوق)
    await expect(async () => {
      await page.getByLabel("أجرة التوصيل لكل شحنة ($)").fill("2.5");
      await page.getByRole("button", { name: "احسب" }).click();
      await expect(page.locator('tr[data-line="loss_limit"]')).toContainText("10.85", { timeout: 2500 });
    }).toPass({ timeout: 15_000 });
    await expect(page.locator('tr[data-line="cpa_ceiling"]')).toContainText("7.60");
    await expect(page.locator('tr[data-line="scaling_ceiling"]')).toContainText("6.51");
    await expect(page.locator('tr[data-scenario="expected"]')).toContainText("5.53");
    await expect(page.locator('tr[data-scenario="pessimistic"]')).toContainText("خسارة 0.65$");
    await expect(page.locator('tr[data-scenario="optimistic"]')).toContainText("8.92");
    await page.locator('tr[data-line="loss_limit"] summary').click();
    await expect(page.locator('tr[data-line="loss_limit"] details')).toContainText("10.85");

    // بعد الاختبار (من الـ OMS)
    await page.getByRole("button", { name: /اقتصاد بعد الاختبار/ }).click();
    await page.getByRole("button", { name: "احسب" }).click();
    await expect(page.getByTestId("verdict")).toContainText("ناجح");
    await expect(page.locator('tr[data-line="profit"]')).toContainText("258.89");
    await expect(page.locator('tr[data-line="profit_per_delivered"]')).toContainText("6.02");
    await expect(page.locator('tr[data-line="cost_per_confirmed"]')).toContainText("5.89");
    await expect(page.locator('tr[data-line="return_rate"]')).toContainText("25.9%");

    // مؤشر السرعة: 66، و401 صانع = رفض تلقائي
    await page.getByRole("button", { name: /مؤشر السرعة/ }).click();
    await page.getByRole("button", { name: "احسب" }).click();
    await expect(page.getByTestId("velocity-score")).toContainText("المؤشر: 66");
    await expect(page.getByTestId("reject")).toHaveCount(0);
    await page.getByLabel("عدد الصنّاع الكلي (للرفض)").fill("401");
    await page.getByRole("button", { name: "احسب" }).click();
    await expect(page.getByTestId("reject")).toContainText("401");
    await page.getByLabel("معلنين بسوقك (فاضي = غير مقاس)").fill("");
    await page.getByRole("button", { name: "احسب" }).click();
    await expect(page.getByTestId("velocity-score")).toContainText("المؤشر: 68");
    await expect(page.getByText(/افحص مكتبة إعلانات سوقك/)).toBeVisible();
  });

  test("الـ API: الحساب، الإدخال الناقص، المدخل الغلط، والقرار", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    const post = (path: string, data: unknown) => page.request.post(path, { data });
    const input = { unitCostJod: "1.56", offers: [{ qty: 1, price: "20", share: 1 }], deliveryFee: "2.5" };

    const ok = await (await post("/api/calc/economics", { mode: "projection", input })).json();
    expect(ok.result.cpaCeiling).toBe("7.60");
    expect(ok.usedInput.fxJodUsd).toBe(1.41); // من الإعدادات
    expect(ok.rulesVersion).toMatch(/^2026-/);

    // أجرة التوصيل ما انعبّت بإعدادات السوق ولا انحطت: خطأ بالعربي
    const miss = await post("/api/calc/economics", { mode: "projection", input: { unitCostJod: "1.56", offers: [{ qty: 1, price: "20", share: 1 }] } });
    expect(miss.status()).toBe(422);
    expect((await miss.json()).error.message).toContain("أجرة التوصيل");
    // نسب العروض مش 100%
    const bad = await post("/api/calc/economics", { mode: "projection", input: { ...input, offers: [{ qty: 1, price: "20", share: 0.5 }] } });
    expect(bad.status()).toBe(422);
    expect((await post("/api/calc/economics", { input })).status()).toBe(400);

    const dec = await (await post("/api/calc/decision", { input: { velocity: 66, dna: 78, cpaCeiling: 7.6, complianceVerdict: "pass", readiness: "ready", investigator: "reject" } })).json();
    expect(dec).toMatchObject({ decision: "deep_research", label: "بحث معمّق", conflict: true });
    const rej = await (await post("/api/calc/decision", { input: { velocity: 99, dna: 99, cpaCeiling: 9, rejectHits: [{ rule: "creators", message: "401 صانع" }] } })).json();
    expect(rej.decision).toBe("reject_auto");

    const v = await (await post("/api/calc/velocity", { lane: "china_early", input: { trendAgeDays: 46 }, reject: { creators: 10 } })).json();
    expect(v.velocity.insufficient).toBe(true);
    expect(v.rejectHits.map((h: { rule: string }) => h.rule)).toEqual(["trend_age"]);
  });

  test("بلا دخول: 401", async ({ request }) => {
    for (const p of ["/api/calc/economics", "/api/calc/velocity", "/api/calc/decision"]) expect((await request.post(p, { data: {} })).status(), p).toBe(401);
  });
});
