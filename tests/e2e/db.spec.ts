import { expect, test } from "@playwright/test";

// مع DATABASE_URL (الـ CI وتشغيلي المحلي): شاشة الفحص بتعرض 54 جدول وامتداد المتجهات.
// بدونه: بتعرض «القاعدة مش متصلة» بلا انهيار.
test("شاشة فحص القاعدة", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
  await expect(page.getByText("دورك: مالك")).toBeVisible();

  const api = await page.request.get("/api/admin/db");
  expect(api.status()).toBe(200);
  const body = await api.json();

  await page.goto("/admin/db");
  await expect(page.getByRole("heading", { name: "فحص قاعدة البيانات" })).toBeVisible();
  if (process.env.DATABASE_URL) {
    expect(body.connected).toBe(true);
    expect(body.tables.length).toBe(54);
    expect(body.vectorExtension).toBe(true);
    await expect(page.getByText("عدد الجداول: 54")).toBeVisible();
    await expect(page.getByRole("cell", { name: "Candidate", exact: true })).toBeVisible();
  } else {
    expect(body.connected).toBe(false);
    await expect(page.getByText("القاعدة مش متصلة")).toBeVisible();
  }
});

test("فحص القاعدة بلا دخول: 401", async ({ request }) => {
  expect((await request.get("/api/admin/db")).status()).toBe(401);
});
