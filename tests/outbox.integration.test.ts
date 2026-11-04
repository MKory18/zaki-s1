// قاعدة حقيقية: سجل الطلبات الصادرة، المفتاح الفريد، إعادة المحاولة بالفواصل، «ميت»، وإعادة الإرسال، والخطة المدفوعة.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { ContractError, IdempotencyConflictError, resend, retryDue, submit } from "../src/adapters/outbox";
import { PaidPlanBlocked, IntegrationError, getFinanceBudget, getOmsPerformance, sendOmsDraft, sendPaidTestPlan, sendProductionBrief, sendCostRequest } from "../src/adapters/systems";
import { mockState, resetMocksForTests } from "../src/adapters/mock";
import { resetLimitsForTests } from "../src/adapters/limiter";
import { listAlerts, resetAlertsForTests } from "../src/lib/alerts";
import { RETRY_DELAYS_MS } from "../src/adapters/errors";
import { getModes } from "../src/adapters/config";

const has = Boolean(process.env.DATABASE_URL);
const fast = { sleep: async () => undefined };
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const draft = (ref: string) => ({
  source: "s1", external_ref: ref, name_ar: "زيت إكليل الجبل للشعر", brand: "علامة", country: "SY", currency: "USD", unit_cost: "2.20",
  offers: [{ qty: 1, price: "20.00" }, { qty: 2, price: "35.00" }], delivery_fee: "2.50", classification: "cosmetic", license: { required: false, number: null },
  compliance_url: "https://s1.example/api/s1/v1/products/x/compliance", images: [], note: "مسودة",
});
const plan = (budget = "350.00") => ({
  external_ref: "pt_" + uniq(), product_ref: "pf_1", oms_draft_id: "drf_1", country: "SY", budget_usd: budget, duration_days: 6, winning_angles: ["A"],
  stop_rules: { max_cost_per_confirmed: "6.51", min_spend_before_stop: "100.00", max_return_rate_first_50: 0.32 },
  ad_rules_url: "https://s1.example/c", requires_finance_check: true, requires_owner_approval: true,
});

describe.skipIf(!has)("الطلبات الصادرة على قاعدة حقيقية", () => {
  const db = () => getDb();
  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().$disconnect();
  });
  beforeEach(() => {
    resetMocksForTests();
    resetLimitsForTests();
    resetAlertsForTests();
  });

  it("كل الأنظمة افتراضياً وهمية (من الإعدادات المبذورة)", async () => {
    const m = await getModes(db());
    expect(Object.values(m).every((x) => x === "mock")).toBe(true);
    expect(Object.keys(m).length).toBe(8);
  });

  it("مسودة للـ OMS الوهمي بتنبعت وبترجع برقم، والسجل بيحفظها", async () => {
    const key = `s1-draft-${uniq()}-v1`;
    const row = await sendOmsDraft(db(), draft("pf_a"), key, fast);
    expect(row).toMatchObject({ status: "ok", attempts: 1, responseCode: 201, system: "oms", endpoint: "/api/v1/product-drafts" });
    expect((row.responseJson as { draft_id: string }).draft_id).toMatch(/^drf_/);
    expect((row.responseJson as { status: string }).status).toBe("draft");
  });

  it("نفس المفتاح مرتين = طلب واحد (صف واحد وإرسال واحد)، وبجسم مختلف = تعارض + تنبيه", async () => {
    const key = `s1-draft-${uniq()}-v1`;
    const a = await sendOmsDraft(db(), draft("pf_b"), key, fast);
    const b = await sendOmsDraft(db(), draft("pf_b"), key, fast);
    expect(b.id).toBe(a.id);
    expect(mockState().received.oms).toHaveLength(1);
    expect(await db().outboundRequest.count({ where: { idempotencyKey: key } })).toBe(1);
    await expect(sendOmsDraft(db(), { ...draft("pf_b"), name_ar: "اسم تاني" }, key, fast)).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(listAlerts(5).some((x) => x.type === "idempotency_conflict")).toBe(true);
    expect(mockState().received.oms).toHaveLength(1);
  });

  it("طلبين بنفس اللحظة والمفتاح = صف واحد", async () => {
    const key = `s1-draft-${uniq()}-v1`;
    const [x, y] = await Promise.all([sendOmsDraft(db(), draft("pf_c"), key, fast), sendOmsDraft(db(), draft("pf_c"), key, fast)]);
    expect(x.id).toBe(y.id);
    expect(await db().outboundRequest.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it("طلب مش مطابق للعقد ما بينبعت ولا بينحفظ", async () => {
    const key = `s1-draft-${uniq()}-v1`;
    await expect(sendOmsDraft(db(), { ...draft("pf_d"), unit_cost: 2.2 }, key, fast)).rejects.toBeInstanceOf(ContractError);
    expect(await db().outboundRequest.count({ where: { idempotencyKey: key } })).toBe(0);
    expect(mockState().received.oms ?? []).toHaveLength(0);
  });

  it("النظام واقف: بيضل معلّق بموعد دقيقة، وبعدين 5 دقايق... وبعد 5 إعادات «ميت» + تنبيه", async () => {
    mockState().down.oms = true;
    const key = `s1-draft-${uniq()}-v1`;
    const t0 = new Date("2026-10-01T00:00:00Z");
    let row = await sendOmsDraft(db(), draft("pf_e"), key, { ...fast, now: t0 });
    expect(row).toMatchObject({ status: "pending", attempts: 1 });
    expect(new Date(row.nextRetryAt!).getTime() - t0.getTime()).toBe(RETRY_DELAYS_MS[0]);

    // قبل الموعد ما بينعاد
    expect((await retryDue(db(), { ...fast, now: new Date(t0.getTime() + 30_000) })).filter((r) => r.idempotencyKey === key)).toHaveLength(0);

    let now = t0;
    for (let i = 0; i < RETRY_DELAYS_MS.length; i++) {
      now = new Date(new Date(row.nextRetryAt ?? now).getTime() + 1000);
      const done = (await retryDue(db(), { ...fast, now })).find((r) => r.idempotencyKey === key)!;
      expect(done.attempts).toBe(i + 2);
      row = done;
      if (i < RETRY_DELAYS_MS.length - 1) expect(new Date(done.nextRetryAt!).getTime() - now.getTime()).toBe(RETRY_DELAYS_MS[i + 1]);
    }
    expect(row).toMatchObject({ status: "dead", attempts: 6, nextRetryAt: null });
    expect(listAlerts(10).some((a) => a.type === "outbound_dead" && a.severity === "critical")).toBe(true);
    expect(mockState().received.oms ?? []).toHaveLength(0);

    // رجع النظام: زر «أعد الإرسال» بنفس المفتاح
    mockState().down.oms = false;
    const again = await resend(db(), row.id, fast);
    expect(again).toMatchObject({ status: "ok", attempts: 1 });
    expect(mockState().received.oms).toHaveLength(1);
    await expect(resend(db(), row.id, fast)).rejects.toBeInstanceOf(ContractError); // الناجح ما بينعاد
  });

  it("النظام طلب نستنى (429 مع Retry-After): بيحترم الموعد", async () => {
    mockState().fail.production = { status: 429, count: 1, retryAfter: 90 };
    const now = new Date("2026-10-01T00:00:00Z");
    const brief = {
      external_ref: "tt_" + uniq(), product: { ref: "pf_1", name_ar: "x", problem: "x", reference_pack_url: "u", label_text: "x" },
      angles: [{ code: "A", angle: "x", hook: "x", pattern: "x", page_ref: "pg_1" }], allowed_claims: [], banned_claims: [], references: [], ad_rules: [],
      compliance_updated_at: "2026-10-06T18:00:00+03:00", publish_requires_owner_approval: true, due: "2026-10-10",
    };
    const r = await sendProductionBrief(db(), brief, `s1-brief-${uniq()}`, { ...fast, now });
    expect(r.status).toBe("pending");
    expect(new Date(r.nextRetryAt!).getTime() - now.getTime()).toBe(90_000);
    const [done] = (await retryDue(db(), { ...fast, now: new Date(now.getTime() + 91_000) })).filter((x) => x.idempotencyKey === r.idempotencyKey);
    expect(done.status).toBe("ok");
  });

  it("422 بيوقف بلا إعادة، وسبب بالعربي للشاشة", async () => {
    const r = await sendOmsDraft(db(), { ...draft("pf_f"), offers: [{ qty: 1, price: "1.00" }] }, `s1-draft-${uniq()}-v1`, fast);
    expect(r.status).toBe("failed");
    expect(r.nextRetryAt).toBeNull();
    expect((r.responseJson as { error: string }).error).toContain("سعر العرض");
    expect((await retryDue(db(), { ...fast, now: new Date(Date.now() + 99_999_999) })).filter((x) => x.id === r.id)).toHaveLength(0);
  });

  it("401 بيوقف وبيطلّع «التوكن بده مراجعة»", async () => {
    const bad = (async () => Response.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 })) as typeof fetch;
    const r = await sendOmsDraft(db(), draft("pf_g"), `s1-draft-${uniq()}-v1`, { ...fast, fetchImpl: bad });
    expect(r.status).toBe("failed");
    expect(listAlerts(5).some((a) => a.type === "token_review" && a.message.includes("التوكن بده مراجعة"))).toBe(true);
  });

  it("رد مش مطابق للعقد (منتج «شغّال» بدل مسودة) = موقوف + تنبيه", async () => {
    const wrong = (async () => Response.json({ draft_id: "drf_9", status: "active", created_at: "2026-10-07T09:12:00+03:00" }, { status: 201 })) as typeof fetch;
    const r = await sendOmsDraft(db(), draft("pf_h"), `s1-draft-${uniq()}-v1`, { ...fast, fetchImpl: wrong });
    expect(r.status).toBe("failed");
    expect((r.responseJson as { error: string }).error).toContain("مش مطابق للعقد");
    expect(listAlerts(5).some((a) => a.type === "contract_mismatch")).toBe(true);
  });

  it("الوضع الحقيقي بلا إعداد: وقف بلا اتصال + تنبيه", async () => {
    const r = await sendOmsDraft(db(), draft("pf_i"), `s1-draft-${uniq()}-v1`, { ...fast, mode: "real", env: {} });
    expect(r.status).toBe("failed");
    expect(listAlerts(5).some((a) => a.type === "integration_config")).toBe(true);
  });

  describe("الخطة المدفوعة: ولا خطة إذا المالية مش متاحة أو الميزانية مش معروفة", () => {
    const month = "2026-10";
    it("ميزانية كافية: بتنبعت كاقتراح بانتظار موافقتك", async () => {
      const r = await sendPaidTestPlan(db(), plan("350.00"), `s1-plan-${uniq()}-v1`, month, fast);
      expect(r.status).toBe("ok");
      expect((r.responseJson as { status: string }).status).toBe("pending_owner_approval");
    });
    it("الميزانية المتاحة أقل من المطلوب: ممنوعة", async () => {
      await expect(sendPaidTestPlan(db(), plan("5000.00"), `s1-plan-${uniq()}`, month, fast)).rejects.toBeInstanceOf(PaidPlanBlocked);
      expect(mockState().received.mediabuyer ?? []).toHaveLength(0);
    });
    it("المالية واقفة أو الميزانية مش معروفة: ممنوعة", async () => {
      mockState().down.finance = true;
      await expect(sendPaidTestPlan(db(), plan(), `s1-plan-${uniq()}`, month, fast)).rejects.toBeInstanceOf(PaidPlanBlocked);
      mockState().down.finance = false;
      mockState().financeBudget = null;
      await expect(sendPaidTestPlan(db(), plan(), `s1-plan-${uniq()}`, month, fast)).rejects.toBeInstanceOf(PaidPlanBlocked);
      expect(mockState().received.mediabuyer ?? []).toHaveLength(0);
    });
    it("لازم تمرّ على المالية وموافقتك", async () => {
      await expect(sendPaidTestPlan(db(), { ...plan(), requires_owner_approval: false }, `s1-plan-${uniq()}`, month, fast)).rejects.toBeInstanceOf(ContractError);
      await expect(sendPaidTestPlan(db(), { ...plan(), requires_finance_check: false }, `s1-plan-${uniq()}`, month, fast)).rejects.toBeInstanceOf(ContractError);
    });
  });

  it("القراءات: أداء الـ OMS والميزانية بعقدهم، وفشل القراءة خطأ بالعربي", async () => {
    const perf = await getOmsPerformance(db(), { from: "2026-01-01", to: "2026-10-01", country: "SY" }, fast);
    expect(perf.items[0]).toMatchObject({ product_id: "p_101", orders: 75, delivered: 43 });
    const budget = await getFinanceBudget(db(), "2026-10", fast);
    expect(budget.available).toBe("1750.00");
    mockState().down.oms = true;
    await expect(getOmsPerformance(db(), { from: "2026-01-01", to: "2026-10-01" }, fast)).rejects.toBeInstanceOf(IntegrationError);
  });

  it("طلب تكلفة للمالية بيرجع بانتظار الموافقة (ما بيصرف شي)", async () => {
    const r = await sendCostRequest(db(), { external_ref: "cr_" + uniq(), kind: "samples", amount: "120.00", currency: "USD", product_ref: "pf_1", note: "عيّنات" }, `s1-cost-${uniq()}`, fast);
    expect((r.responseJson as { status: string }).status).toBe("pending_owner_approval");
  });

  it("المحاولات كلها بنفس المفتاح الفريد (ما في مفتاح جديد بكل إعادة)", async () => {
    const keys: (string | null)[] = [];
    const f = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get("idempotency-key"));
      return new Response("x", { status: 503 });
    }) as typeof fetch;
    const key = `s1-draft-${uniq()}-v1`;
    const t0 = new Date("2026-10-01T00:00:00Z");
    const r = await sendOmsDraft(db(), draft("pf_j"), key, { ...fast, fetchImpl: f, now: t0 });
    await retryDue(db(), { ...fast, fetchImpl: f, now: new Date(new Date(r.nextRetryAt!).getTime() + 1000) });
    expect(keys.filter((k) => k === key).length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
  });

  it("submit مباشرة: عقد مجهول مرفوض", async () => {
    await expect(submit(db(), { system: "oms", endpoint: "/api/v1/unknown", payload: {}, idempotencyKey: uniq() }, fast)).rejects.toBeInstanceOf(ContractError);
  });
});
