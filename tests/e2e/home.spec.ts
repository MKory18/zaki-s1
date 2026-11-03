import { expect, test } from "@playwright/test";

test("الصفحة عربية من اليمين لليسار وفيها «سيستم 1»", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "سيستم 1" })).toBeVisible();
});

test("نقطة الصحة بترجع سليم", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("ok");
});
