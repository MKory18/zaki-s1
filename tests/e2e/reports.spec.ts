import { expect, test } from "@playwright/test";

test.describe("التقارير والتنبيهات واليوم", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("بلا دخول: كل النقاط 401، والويبهوك مقفل بلا سر", async ({ request }) => {
    for (const p of ["/api/reports", "/api/reports/x", "/api/alerts"]) expect((await request.get(p)).status(), p).toBe(401);
    expect((await request.post("/api/reports", { data: { kind: "morning" } })).status()).toBe(401);
    expect((await request.post("/api/alerts/x/ack")).status()).toBe(401);
    // TELEGRAM_WEBHOOK_SECRET مش مضبوط ببيئة الاختبار: 503 مش 200
    expect((await request.post("/api/telegram/webhook", { data: { callback_query: { id: "1", data: "w:abcdefgh1234" } } })).status()).toBe(503);
  });

  test("شاشة اليوم والتقارير والتنبيهات: توليد تقرير وفتحه من الأرشيف وشفت تنبيه", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();

    await page.goto("/today");
    await expect(page.getByRole("heading", { name: /^اليوم — / })).toBeVisible();

    // توليد التقرير الصباحي بالقوة: الكاتب مش مضبوط ببيئة الاختبار فالقالب هو اللي بيطلع
    const gen = await page.request.post("/api/reports", { data: { kind: "morning", force: true } });
    expect(gen.status()).toBe(200);
    const made = await gen.json();
    expect(made.source).toBe("template");
    expect(made.text).toContain("تقرير الصبح —");
    expect(made.sent).toBe(false); // الإرسال مش مطلوب
    expect(JSON.stringify(made)).not.toContain("TELEGRAM_BOT_TOKEN");

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "التقارير" })).toBeVisible();
    await expect(page.locator("tr[data-kind='morning']").first()).toBeVisible();
    await page.goto(`/reports/${made.id}`);
    await expect(page.getByTestId("report-text")).toContainText("تقرير الصبح —");

    // أرشيف بالـ API: نوع غلط 400، وتقرير مجهول 404
    expect((await page.request.get("/api/reports?kind=nope")).status()).toBe(400);
    expect((await page.request.get("/api/reports/nope")).status()).toBe(404);
    expect((await page.request.post("/api/reports", { data: { kind: "nope" } })).status()).toBe(400);

    // تنبيه جديد من اختبار مصدر مش مفعّل: بيطلع بالقائمة المفتوحة، وبيختفي بعد «شفت»
    const board = await (await page.request.get("/api/alerts?state=all")).json();
    expect(Array.isArray(board.alerts)).toBe(true);
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { name: "التنبيهات" })).toBeVisible();
    const open = await (await page.request.get("/api/alerts")).json();
    if (open.alerts.length > 0) {
      const id = open.alerts[0].id as string;
      const ack = await page.request.post(`/api/alerts/${id}/ack`);
      expect(ack.status()).toBe(200);
      const after = await (await page.request.get("/api/alerts")).json();
      expect(after.alerts.some((a: { id: string }) => a.id === id)).toBe(false);
    }
    expect((await page.request.post("/api/alerts/nope/ack")).status()).toBe(404);
  });
});
