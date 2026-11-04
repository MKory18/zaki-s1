import { expect, test } from "@playwright/test";

// بحاجة DATABASE_URL (الـ CI وتشغيلي المحلي): الإعدادات والمكتبات من القاعدة بعد استيراد البذور.
test.describe("الإعدادات والمكتبات", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("شاشة الإعدادات: تعديل بنسخة جديدة ثم رجوع", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();

    await page.goto("/settings?tab=velocity");
    await expect(page.getByRole("heading", { name: "الإعدادات" })).toBeVisible();
    const row = page.locator('tr[data-key="reject.max_creators"]');
    await expect(row).toBeVisible();

    await expect(async () => {
      await row.getByRole("textbox").fill("333");
      await row.getByRole("button", { name: "حفظ" }).click();
      await expect(row.getByText(/انحفظ \(نسخة \d+\)/)).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 15_000 });

    await row.getByRole("button", { name: /النسخ/ }).click();
    await expect(row.getByText(/نسخة 1 —/)).toBeVisible();
    await row.getByRole("button", { name: "رجوع لهالنسخة" }).last().click();
    await expect(row.getByText(/رجعت لنسخة 1/)).toBeVisible();
    await expect(row.getByRole("textbox")).toHaveValue("400");

    // التعديل ظاهر بسجل التدقيق
    const audit = await (await page.request.get("/api/audit?limit=100")).json();
    expect(audit.entries.some((e: { entity: string; entityId: string }) => e.entity === "Setting" && e.entityId === "reject.max_creators")).toBe(true);
  });

  test("شاشات المكتبات: الأعداد مطابقة", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    for (const [tab, n] of [["problems", 22], ["claims", 16], ["adrules", 10], ["reasons", 12], ["ingredients", 25], ["banned", 11]] as const) {
      await page.goto(`/libraries?tab=${tab}`);
      await expect(page.getByTestId("count")).toHaveText(`العدد: ${n}`);
    }
    await page.goto("/libraries?tab=texts");
    await expect(page.getByTestId("count")).toHaveText("العدد: 22");
  });

  test("الإعدادات بلا دخول: 401", async ({ request }) => {
    expect((await request.get("/api/settings")).status()).toBe(401);
    expect((await request.put("/api/settings", { data: { key: "a.b", value: {} } })).status()).toBe(401);
  });
});
