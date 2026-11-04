import { expect, test } from "@playwright/test";

test.describe("المصادر والاستيراد", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("شاشة الاستيراد: رفع، معاينة بربط مقترح، استيراد، وتقرير بالفاشل", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();
    await page.goto("/imports");
    await expect(page.getByRole("heading", { name: "الاستيراد", exact: true })).toBeVisible();

    const tag = "e" + Date.now();
    const csv = ["商品名称,链接,累计销量,带货达人数", `زيت المتصفح ${tag},https://www.douyin.com/p/${tag}-1,30000,140`, `ممسوح ${tag},https://www.douyin.com/p/${tag}-2,ليس رقم,10`].join("\n");
    await page.getByLabel("المصدر", { exact: true }).selectOption("douyin");
    await page.getByLabel("الملف", { exact: true }).setInputFiles({ name: "douyin.csv", mimeType: "text/csv", buffer: Buffer.from(csv, "utf8") });
    await expect(async () => {
      await page.getByRole("button", { name: "معاينة" }).click();
      await expect(page.getByTestId("preview")).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByLabel("ربط عنوان المنتج")).toHaveValue("商品名称");
    await expect(page.getByLabel("ربط الرابط")).toHaveValue("链接");
    await expect(page.getByLabel("ربط المبيعات التراكمية")).toHaveValue("累计销量");
    await page.getByRole("button", { name: "استورد", exact: true }).click();
    await expect(page.getByTestId("report")).toContainText("2 صف");
    await expect(page.getByTestId("report")).toContainText("1 تمّ");
    await expect(page.getByTestId("report")).toContainText("1 فشل");
    await expect(page.getByTestId("report")).toContainText("قيمة رقمية غلط");

    // نتيجة Kimi
    await page.getByLabel("المصدر", { exact: true }).selectOption("kimi");
    await page.getByLabel("نتيجة Kimi").fill("هاد مش JSON");
    await page.getByRole("button", { name: "استورد", exact: true }).click();
    await expect(page.getByText("النص مش JSON صالح")).toBeVisible();
  });

  test("شاشة المصادر: شغّل الآن (وهمي)، حالة المصدر، والكلمات المقترحة", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: "المصادر", exact: true })).toBeVisible();
    await expect(page.locator("tr[data-source]")).toHaveCount(8);

    await expect(async () => {
      await page.getByLabel("كلمة aliexpress").fill("rosemary oil");
      await page.getByRole("button", { name: "شغّل aliexpress الآن" }).click();
      await expect(page.getByText(/تمّ: 1\/1 كلمة/)).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });
    await page.reload();
    await expect(page.locator('tr[data-source="aliexpress"]')).toContainText("تمّ");

    // كلمة مقترحة من مخطط الكلمات ← اعتماد
    const w = "كلمة المتصفح " + Date.now().toString(36); // أحرف بس: الأرقام الطويلة بتنشال كأنها هاتف
    const kp = await page.request.post("/api/imports", { multipart: { source: "keyword_planner", file: { name: "kp.csv", mimeType: "text/csv", buffer: Buffer.from(`Keyword,Avg. monthly searches\n${w},500`, "utf8") } } });
    expect(kp.status()).toBe(200);
    await page.reload();
    const row = page.locator("tr[data-keyword]", { hasText: w });
    await expect(row).toContainText("keyword_planner:500");
    await expect(async () => {
      await row.getByRole("button", { name: "اعتمد" }).click();
      await expect(row.getByText("اعتُمدت")).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 15_000 });
    const approved = await (await page.request.get("/api/keywords?status=approved")).json();
    expect(approved.keywords.some((k: { text: string }) => k.text === w)).toBe(true);
  });

  test("الـ API: ملف غلط، مصدر مجهول، حجم، وبلا دخول", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    const up = (source: string, name: string, body: string) => page.request.post("/api/imports/preview", { multipart: { source, file: { name, mimeType: "text/plain", buffer: Buffer.from(body, "utf8") } } });
    expect((await up("douyin", "x.pdf", "a,b\n1,2")).status()).toBe(422);
    expect((await up("nothing", "x.csv", "a,b\n1,2")).status()).toBe(400);
    expect((await up("douyin", "x.csv", "a,b")).status()).toBe(422);
    expect((await page.request.post("/api/sources/google_trends/run", { data: {} })).status()).toBe(404);
    expect((await page.request.post("/api/imports", { data: { source: "douyin", text: "x" } })).status()).toBe(400); // JSON لـ Kimi بس
    expect((await page.request.patch("/api/keywords/nope", { data: { action: "approve" } })).status()).toBe(404);
    for (const p of ["/api/sources", "/api/imports", "/api/keywords"]) expect((await request.get(p)).status(), p).toBe(401);
    for (const p of ["/api/imports", "/api/imports/preview", "/api/sources/aliexpress/run"]) expect((await request.post(p, { data: {} })).status(), p).toBe(401);
  });
});
