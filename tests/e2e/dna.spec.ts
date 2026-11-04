import { expect, test } from "@playwright/test";

test.describe("الحمض", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("شاشة الحمض: الأوزان، مرجع يدوي بانتظار الاعتماد ثم معتمد، وفحص مرشح", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();
    await page.goto("/dna");
    await expect(page.getByRole("heading", { name: "الحمض", exact: true })).toBeVisible();
    await expect(page.locator("tr[data-trait]")).toHaveCount(10);
    await expect(page.locator('tr[data-trait="problem_clarity"]')).toContainText("وضوح المشكلة");
    await expect(page.locator('tr[data-trait="problem_clarity"]')).toContainText("عيّنة صغيرة"); // كل قيمة بحجم عيّنتها

    // مرجع يدوي
    const name = "مرجع المتصفح " + Date.now();
    await expect(async () => {
      await page.getByLabel("اسم المرجع").fill(name);
      await page.getByLabel("وضوح المشكلة").last().selectOption("عالي");
      await page.getByLabel("التكرار").last().selectOption("بيخلص وبينطلب");
      await page.getByRole("button", { name: "أضف", exact: true }).click();
      await expect(page.getByText(/انضاف «بانتظار الاعتماد»/)).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });

    await page.reload();
    const row = page.locator("tr[data-ref]", { hasText: name });
    await expect(row).toContainText("بانتظار الاعتماد");
    await row.getByRole("button", { name: "اعتمد كمرجع" }).click();
    await expect(row.getByText("اعتُمد، حدّث الصفحة")).toBeVisible();
    await page.reload();
    await expect(page.locator("tr[data-ref]", { hasText: name })).toContainText("مرجع معتمد");

    // فحص مرشح: بيطلع درجة وأقرب مرجع
    await page.getByLabel("وضوح المشكلة").first().selectOption("عالي");
    await page.getByLabel("التكرار").first().selectOption("بيخلص وبينطلب");
    await page.getByRole("button", { name: "احسب درجة الحمض" }).click();
    await expect(page.getByTestId("dna-result")).toContainText(/درجة الحمض: \d+/);
    await expect(page.getByTestId("dna-result")).toContainText("أقرب مرجع");

    // تعلّم الآن (الـ OMS الوهمي)
    await page.getByRole("button", { name: "تعلّم الآن من أداء الـ OMS" }).click();
    await expect(page.getByText(/نسخة \d+: \d+ منتج/)).toBeVisible();
  });

  test("الـ API: الأوزان، القيم الغلط، وصلاحية اعتماد المرجع", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    const w = await (await page.request.get("/api/dna/weights")).json();
    expect(Object.keys(w.model.traits)).toHaveLength(10);
    const bad = await page.request.post("/api/dna/score", { data: { traits: { problem_clarity: "ممتاز" } } });
    expect(bad.status()).toBe(400);
    expect((await bad.json()).error.message).toContain("المسموح");
    expect((await page.request.post("/api/dna/score", { data: {} })).status()).toBe(400);
    expect((await page.request.patch("/api/dna/references/nope", { data: { action: "approve" } })).status()).toBe(404);
    expect((await page.request.patch("/api/dna/references/nope", { data: { action: "x" } })).status()).toBe(400);
    expect((await page.request.post("/api/dna/profiles", { data: { ownerType: "product", ownerId: "pf_e2e", traits: { visible: "نعم" } } })).status()).toBe(200);
    for (const p of ["/api/dna/references", "/api/dna/weights"]) expect((await request.get(p)).status(), p).toBe(401);
    for (const p of ["/api/dna/score", "/api/dna/learn", "/api/dna/profiles", "/api/dna/references"]) expect((await request.post(p, { data: {} })).status(), p).toBe(401);
  });
});
