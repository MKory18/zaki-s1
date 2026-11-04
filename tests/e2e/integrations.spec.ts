import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

// نفس القيم اللي بـ playwright.config.ts (قيم تجربة وهمية)
const WEBHOOK_SECRET = "e2e-webhook-secret-production"; // scan:ok
const READER_TOKEN = "e2e-reader-token-production"; // scan:ok

function signed(body: object, secret = WEBHOOK_SECRET, ts = String(Math.floor(Date.now() / 1000))) {
  const raw = JSON.stringify(body);
  return { raw, headers: { "content-type": "application/json", "x-zaki-timestamp": ts, "x-zaki-signature": createHmac("sha256", secret).update(`${ts}.${raw}`).digest("hex") } };
}
const ev = (type: string, id = `evt_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`) => ({ event_id: id, type, occurred_at: "2026-10-12T12:00:00+03:00", data: { brief_id: "br_77" } });

test.describe("الربط بالأنظمة", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("شاشة الربط: ثمانية أنظمة وهمية، واختبار الاتصال، والتبديل لحقيقي بلا إعداد", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();

    await page.goto("/integrations");
    await expect(page.getByRole("heading", { name: "الربط بالأنظمة" })).toBeVisible();
    await expect(page.locator("tr[data-system]")).toHaveCount(8);
    await expect(page.locator('tr[data-system="oms"]')).toContainText("وهمي");

    // اختبار اتصال بالوهمي: بيرجع سليم، وبالـ API ما في أسرار
    const api = await page.request.get("/api/integrations");
    const body = await api.json();
    expect(body.systems).toHaveLength(8);
    expect(JSON.stringify(body)).not.toContain(WEBHOOK_SECRET);
    expect(JSON.stringify(body)).not.toContain(READER_TOKEN);
    for (const s of ["oms", "production", "mediabuyer", "finance", "workspace", "tasks", "clipper", "crisis"]) {
      const t = await page.request.post(`/api/integrations/${s}/test`);
      expect(t.status(), s).toBe(200);
      expect((await t.json()).ok, s).toBe(true);
    }
    await expect(async () => {
      await page.locator('tr[data-system="oms"]').getByRole("button", { name: "اختبار oms" }).click();
      await expect(page.locator('tr[data-system="oms"]').getByText(/الاتصال سليم/)).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 15_000 });

    // تبديل المالية لحقيقي بلا عنوان وتوكن مضبوطين: الاختبار بيقول السبب بالعربي، وبعدين نرجّعها وهمية
    const put = (raw: string) => page.request.put("/api/settings", { data: { key: "integration.finance", value: { label: "وضع الربط مع المالية (mock = وهمي، real = حقيقي)", raw } } });
    expect((await put("real")).status()).toBe(200);
    const real = await (await page.request.post("/api/integrations/finance/test")).json();
    expect(real).toMatchObject({ ok: false, mode: "real" });
    expect(real.message).toContain("مش مضبوط");
    expect((await put("mock")).status()).toBe(200);
    expect((await (await page.request.post("/api/integrations/finance/test")).json()).ok).toBe(true);

    // الإعدادات: تبويب «الربط» فيه الثمانية
    await page.goto("/settings?tab=integration");
    await expect(page.locator("tr[data-key^='integration.']")).toHaveCount(8);
  });

  test("استقبال الأحداث: توقيع صح، غلط، قديم، مكرر، ونظام مجهول", async ({ request }) => {
    const url = "/api/s1/v1/webhooks/production";
    const ok = signed(ev("brief.accepted"));
    const r1 = await request.post(url, { data: ok.raw, headers: ok.headers });
    expect(r1.status()).toBe(200);
    expect((await r1.json()).status).toBe("ok");

    // نفس الحدث مرة تانية: نجاح بلا معالجة
    const r2 = await request.post(url, { data: ok.raw, headers: ok.headers });
    expect(r2.status()).toBe(200);
    expect((await r2.json()).status).toBe("duplicate");

    // توقيع غلط (سر ثاني)
    const bad = signed(ev("brief.accepted"), "wrong-secret"); // scan:ok
    expect((await request.post(url, { data: bad.raw, headers: bad.headers })).status()).toBe(401);
    // وقت قديم (10 دقايق)
    const old = signed(ev("brief.accepted"), WEBHOOK_SECRET, String(Math.floor(Date.now() / 1000) - 600));
    const stale = await request.post(url, { data: old.raw, headers: old.headers });
    expect(stale.status()).toBe(401);
    expect((await stale.json()).request_id).toMatch(/^req_/);
    // بلا ترويسات
    expect((await request.post(url, { data: ok.raw, headers: { "content-type": "application/json" } })).status()).toBe(401);
    // نظام مجهول ونوع حدث مش لهالنظام
    const unknown = signed(ev("brief.accepted"));
    expect((await request.post("/api/s1/v1/webhooks/nothing", { data: unknown.raw, headers: unknown.headers })).status()).toBe(404);
    const wrongType = signed(ev("test.started"));
    expect((await request.post(url, { data: wrongType.raw, headers: wrongType.headers })).status()).toBe(422);
  });

  test("قراءة الأنظمة التانية: بتوكن بس (قواعد الادعاءات والمرشحين)", async ({ request }) => {
    const auth = { authorization: `Bearer ${READER_TOKEN}` };
    expect((await request.get("/api/s1/v1/products/pf_none/compliance")).status()).toBe(401);
    expect((await request.get("/api/s1/v1/products/pf_none/compliance", { headers: { authorization: "Bearer nope" } })).status()).toBe(401);
    const nf = await request.get("/api/s1/v1/products/pf_none/compliance", { headers: auth });
    expect(nf.status()).toBe(404);
    expect((await nf.json()).error.code).toBe("NOT_FOUND");
    expect((await request.get("/api/s1/v1/candidates")).status()).toBe(401);
    const list = await request.get("/api/s1/v1/candidates?status=deep_research&since=2026-10-01", { headers: auth });
    expect(list.status()).toBe(200);
    expect(Array.isArray((await list.json()).items)).toBe(true);
    expect((await request.get("/api/s1/v1/candidates?since=مش-تاريخ", { headers: auth })).status()).toBe(400);
  });

  test("بلا دخول: شاشات وإدارة الربط 401", async ({ request }) => {
    for (const p of ["/api/integrations", "/api/outbound"]) expect((await request.get(p)).status(), p).toBe(401);
    for (const p of ["/api/integrations/oms/test", "/api/outbound/retry", "/api/outbound/abc/resend"]) expect((await request.post(p, { data: {} })).status(), p).toBe(401);
  });
});
