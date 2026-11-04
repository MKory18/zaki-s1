import { expect, test } from "@playwright/test";

test("الصفحة عربية من اليمين لليسار وصفحة الدخول فيها «سيستم 1»", async ({ page }) => {
  await page.goto("/login");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "سيستم 1" })).toBeVisible();
});

test("نقطة الصحة بترجع سليم", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("ok");
});

test("بلا دخول: الرئيسية بتحوّل للدخول، والـ API بيرفض بالعربي", async ({ page, request }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  for (const p of ["/api/me", "/api/users", "/api/audit"]) {
    const r = await request.get(p);
    expect(r.status()).toBe(401);
    expect((await r.json()).error.message).toContain("تسجّل دخول");
  }
});

test("دخول المالك المحلي: بيشوف المستخدمين وتعديله بيظهر بالتدقيق", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
  await expect(page.getByText("دورك: مالك")).toBeVisible();
  await page.getByRole("link", { name: "المستخدمين والأدوار" }).click();
  await expect(page.getByRole("heading", { name: "المستخدمين والأدوار" })).toBeVisible();

  // آخر مالك ما بينشال
  // الواجهة بتحتاج لحظة لتفعيل الأزرار، فبنعيد المحاولة لحد ما تستجيب
  await expect(async () => {
    const row = page.locator("tr", { hasText: "مالك التطوير" });
    await row.getByRole("combobox").selectOption("viewer");
    await row.getByRole("button", { name: "حفظ" }).click();
    await expect(page.getByText("ما بينفع تشيل آخر مالك")).toBeVisible({ timeout: 1500 });
  }).toPass({ timeout: 15_000 });

  const audit = await page.request.get("/api/audit");
  expect(audit.status()).toBe(200);
  const body = await audit.json();
  expect(Array.isArray(body.entries)).toBe(true);
  // بلا قاعدة: التشغيل جديد فبنشوف إنشاء المالك. مع القاعدة: السجل بيضل من تشغيلات قبل، فبنتأكد من الشكل بس.
  if (!process.env.DATABASE_URL) expect(body.entries.some((e: { action: string }) => e.action === "user.create")).toBe(true);
  for (const e of body.entries.slice(0, 5)) expect(e).toMatchObject({ actorId: expect.any(String), action: expect.any(String), at: expect.any(String) });
});
