import { expect, test } from "@playwright/test";

const rand = () => Array.from({ length: 10 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");

test.describe("المرشحين والبطاقة", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("إدخال يدوي ← القائمة ← البطاقة، والقرار مقفول قبل التحقق", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();
    await page.goto("/candidates");
    await expect(page.getByRole("heading", { name: "المرشحين", exact: true })).toBeVisible();

    const title = `منتج المتصفح ${rand()}`;
    await page.getByRole("button", { name: "＋ إدخال يدوي" }).click();
    await expect(async () => {
      await page.getByLabel("اسم المنتج أو الفكرة").fill(title);
      await page.getByLabel("الرابط", { exact: true }).fill(`https://example.com/${rand()}`);
      await page.getByLabel("السوق (SY أو JO)").fill("sy");
      await page.getByRole("button", { name: "أضف", exact: true }).click();
      await expect(page.getByText("انضاف المرشح")).toBeVisible({ timeout: 2500 });
    }).toPass({ timeout: 20_000 });

    await page.goto(`/candidates?q=${encodeURIComponent(title)}`);
    const row = page.locator("tr[data-candidate]", { hasText: title });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("جديد");
    await row.getByRole("link", { name: title }).click();

    await expect(page.getByRole("heading", { name: new RegExp(title) })).toBeVisible();
    await expect(page.getByTestId("status")).toHaveText("جديد");
    await expect(page.getByTestId("velocity")).toContainText("بيانات غير كافية");
    await expect(page.getByTestId("dna")).toContainText("ما انعبّى ملف الحمض");
    await expect(page.getByTestId("economics")).toContainText("بيانات ناقصة");
    await expect(page.getByTestId("compliance")).toContainText("ما انفحص امتثاله");
    await expect(page.locator('tr[data-source="manual"]')).toContainText("يدوي");
    await expect(page.getByText("البطاقة مش جاهزة لقرارك")).toBeVisible();
    await expect(page.getByRole("button", { name: "ابدأ بحث معمّق" })).toHaveCount(0);

    // القرار من الـ API مقفول كمان (409)
    const id = page.url().split("/").pop()!;
    const dec = await page.request.post(`/api/candidates/${id}/decision`, { data: { action: "watch" } });
    expect(dec.status()).toBe(409);
    expect((await dec.json()).error.message).toContain("لسا ما انتحقق");
  });

  test("الـ API: قائمة بفلاتر، بطاقة، دمج وفك يدوي، تشغيل مرحلة، وأخطاء", async ({ page, request }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    const make = async (title: string) => (await (await page.request.post("/api/candidates", { data: { title, url: `https://example.com/${rand()}` } })).json()) as { id: string };
    const a = await make(`دمج ${rand()} أ`);
    const b = await make(`دمج ${rand()} ب`);

    const list = await (await page.request.get(`/api/candidates?status=new&q=${encodeURIComponent("دمج")}`)).json();
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    expect(list.counts.new).toBeGreaterThanOrEqual(2);
    expect((await page.request.get("/api/candidates?status=banana")).status()).toBe(200); // حالة مجهولة = بلا فلتر

    const card = await (await page.request.get(`/api/candidates/${a.id}`)).json();
    expect(card.header).toMatchObject({ id: a.id, status: "new", laneLabel: "فكرة يدوية" });
    expect(card.numbers.velocity.insufficient).toBe(true);
    expect(card.sources[0]).toMatchObject({ source: "manual", trust: "low" });
    expect(card.decision.rule.decision).toBe("watch"); // بيانات غير كافية = راقب
    expect((await page.request.get("/api/candidates/nope")).status()).toBe(404);

    // دمج يدوي ثم فك
    expect((await page.request.post(`/api/candidates/${b.id}/merge`, { data: { intoId: a.id } })).status()).toBe(200);
    expect((await page.request.get(`/api/candidates/${b.id}`)).status()).toBe(404); // المدموج انحذف ناعم
    const merged = await (await page.request.get(`/api/candidates/${a.id}`)).json();
    expect(merged.sources).toHaveLength(2);
    const split = await page.request.post(`/api/candidates/${a.id}/split`, { data: { observationIds: [merged.sources[0].id] } });
    expect(split.status()).toBe(200);
    expect((await page.request.post(`/api/candidates/${a.id}/merge`, { data: { intoId: a.id } })).status()).toBe(400);
    expect((await page.request.post(`/api/candidates/${a.id}/split`, { data: {} })).status()).toBe(400);

    // مرحلة من الخط (بدون موديلات): الحساب والبطاقات
    const run = await page.request.post("/api/pipeline/run", { data: { stage: "compute" } });
    expect(run.status()).toBe(200);
    expect((await run.json()).stage).toBe("compute");
    expect((await page.request.post("/api/pipeline/run", { data: { stage: "launch" } })).status()).toBe(400);

    // إدخال يدوي: تحقق
    expect((await page.request.post("/api/candidates", { data: { title: "  " } })).status()).toBe(400);
    expect((await page.request.post("/api/candidates", { data: { title: "x", url: "ftp://x" } })).status()).toBe(400);
    expect((await page.request.post("/api/candidates", { data: { title: "x", market: "SYR" } })).status()).toBe(400);

    for (const p of ["/api/candidates", `/api/candidates/${a.id}`]) expect((await request.get(p)).status(), p).toBe(401);
    for (const p of ["/api/candidates", `/api/candidates/${a.id}/decision`, `/api/candidates/${a.id}/merge`, `/api/candidates/${a.id}/split`, "/api/pipeline/run"]) expect((await request.post(p, { data: {} })).status(), p).toBe(401);
  });
});
