import { expect, test } from "@playwright/test";

const rand = () => Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");

test.describe("بوابة الامتثال والجودة والتراخيص", () => {
  test.skip(!process.env.DATABASE_URL, "بحاجة قاعدة بيانات");

  test("بلا دخول: كل النقاط الجديدة 401، والأحداث الصادرة مقفولة بالتوكن", async ({ request }) => {
    for (const p of ["/api/compliance/claims", "/api/compliance/ingredients", "/api/compliance/ad-rules", "/api/compliance/references", "/api/compliance/inbox/texts", "/api/compliance/inbox/claims", "/api/compliance/check/x", "/api/batches", "/api/licenses"]) {
      expect((await request.get(p)).status(), p).toBe(401);
    }
    for (const p of ["/api/compliance/claims", "/api/compliance/references", "/api/compliance/check/x", "/api/compliance/checks/x/review", "/api/compliance/references/x/review", "/api/batches", "/api/batches/x/release", "/api/batches/x/block", "/api/licenses"]) {
      expect((await request.post(p, { data: {} })).status(), p).toBe(401);
    }
    expect((await request.patch("/api/batches/x", { data: {} })).status()).toBe(401);
    expect((await request.delete("/api/licenses/x")).status()).toBe(401);
    // الأحداث الصادرة: بلا توكن أو بتوكن غلط = 401، وبتوكن القراءة = 200
    expect((await request.get("/api/s1/v1/events")).status()).toBe(401);
    expect((await request.get("/api/s1/v1/events", { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
    const ok = await request.get("/api/s1/v1/events?type=compliance.updated", { headers: { authorization: "Bearer e2e-reader-token-production" } }); // scan:ok
    expect(ok.status()).toBe(200);
    expect(Array.isArray((await ok.json()).events)).toBe(true);
    expect((await request.get("/api/s1/v1/events?type=nope", { headers: { authorization: "Bearer e2e-reader-token-production" } })).status()).toBe(400); // scan:ok
  });

  test("«بيعالج الفطريات» على تجميلي: رفض مع بديل بالبطاقة، والمكتبة بتتعدّل من الشاشة، والدفعة بلا شهادة ما بتنفرج", async ({ page }) => {
    page.on("dialog", (d) => void d.accept());
    await page.goto("/login");
    await page.getByRole("button", { name: "دخول المالك (تطوير)" }).click();
    await expect(page.getByText("دورك: مالك")).toBeVisible();

    // مرشح جديد بالـ API
    const title = `كريم للقدم ${rand()}`;
    const cand = await page.request.post("/api/candidates", { data: { title, url: `https://example.com/${rand()}`, market: "SY" } });
    expect(cand.status(), await cand.text()).toBe(201);
    const id = ((await cand.json()) as { id: string }).id;
    expect(id).toBeTruthy();

    // قبل أي فحص: البطاقة بتقول ما انفحص
    await page.goto(`/candidates/${id}`);
    await expect(page.getByTestId("compliance")).toContainText("ما انفحص");

    // فحص بادعاء علاجي على منتج مسجّل تجميلي
    const r = await page.request.post(`/api/compliance/check/${id}`, { data: { stage: "full", claims: ["بيعالج الفطريات", "بيرطّب الجلد"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" } });
    expect(r.status()).toBe(201);
    const run = await r.json();
    expect(run.verdict).toBe("fail");
    expect(run.result.claims.find((c: { text: string }) => c.text === "بيعالج الفطريات")).toMatchObject({ status: "banned" });
    expect(run.result.claims.find((c: { text: string }) => c.text === "بيعالج الفطريات").alternative).toBeTruthy();
    expect(run.result.allowed_claims).toEqual(["بيرطّب الجلد"]);
    expect(JSON.stringify(run)).not.toContain("e2e-glm-key");

    await page.goto(`/candidates/${id}`);
    await expect(page.getByTestId("compliance-verdict")).toHaveText("مرفوض");
    await page.getByText("الفحوصات الثمانية").click();
    await expect(page.getByTestId("compliance-checks").locator("tr")).toHaveCount(9); // الترويسة + 8
    await expect(page.getByTestId("compliance-claims")).toContainText("البديل المقترح");
    // الرفض بالكود ما بيظهر له زر قرار مراجع (بس إعادة الفحص)
    await expect(page.getByRole("button", { name: "سجّل قراري" })).toHaveCount(0);

    // مكتبة الادعاءات: إضافة وحذف من الشاشة
    const phrase = `عبارة اختبار ${rand()}`;
    await page.goto("/libraries?tab=claims");
    const add = page.getByTestId("add-row");
    await add.getByLabel("الممنوع (جديد)").fill(phrase);
    await add.getByLabel("ليش (جديد)").fill("اختبار المتصفح");
    await add.getByRole("button", { name: "أضف" }).click();
    await expect(page.getByTestId("lib-msg")).toHaveText("تمّ");
    const row = page.locator("tr[data-id]", { hasText: phrase });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: "احذف" }).click();
    await expect(page.locator("tr[data-id]", { hasText: phrase })).toHaveCount(0);

    // دفعة بلا شهادة تحليل ما بتنفرج
    const ref = `pf_${rand()}`;
    const b = await page.request.post("/api/batches", { data: { productRef: ref, batchNo: "B-1", qty: 10 } });
    expect(b.status()).toBe(201);
    const batch = await b.json();
    const rel = await page.request.post(`/api/batches/${batch.id}/release`);
    expect(rel.status()).toBe(409);
    expect((await rel.json()).error.blockers).toContain("ما في شهادة تحليل (COA) للدفعة");
    await page.goto("/batches");
    await expect(page.locator("tr[data-status='pending']", { hasText: ref })).toContainText("ناقصة");
    expect((await page.request.post("/api/batches", { data: { productRef: ref, batchNo: "B-1", qty: 10 } })).status()).toBe(409);

    // ترخيص: بيظهر بالشاشة مع الباقي
    const lic = await page.request.post("/api/licenses", { data: { productRef: ref, country: "jo", authority: "المؤسسة العامة للغذاء والدواء", type: "تسجيل", status: "active", expiresAt: new Date(Date.now() + 20 * 86_400_000).toISOString() } });
    expect(lic.status()).toBe(201);
    await page.goto("/licenses");
    await expect(page.locator("tr[data-alert='expiring']", { hasText: ref })).toBeVisible();
    expect((await page.request.post("/api/licenses", { data: { productRef: ref, country: "JO", authority: "ج", type: "ت", status: "weird" } })).status()).toBe(400);

    // صندوق المراجعة والأحداث
    await page.goto("/review");
    await expect(page.getByRole("heading", { name: "المراجعة" })).toBeVisible();
    await expect(page.getByRole("heading", { name: /^النصوص بانتظار المراجع الشرعي/ })).toBeVisible();
    const texts = await (await page.request.get("/api/compliance/inbox/texts")).json();
    expect(texts.items.some((t: { code: string }) => t.code === "REF-09")).toBe(true);
    // اعتماد نص مختلف فيه بلا أساس قرار = 409
    const all = await (await page.request.get("/api/compliance/references")).json();
    const zamzam = all.items.find((t: { code: string }) => t.code === "REF-09");
    expect((await page.request.post(`/api/compliance/references/${zamzam.id}/review`, { data: { decision: "approve" } })).status()).toBe(409);
  });
});
