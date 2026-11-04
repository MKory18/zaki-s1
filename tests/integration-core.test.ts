import { beforeEach, describe, expect, it } from "vitest";
import { validateShape } from "../src/agents/shape";
import * as C from "../src/adapters/contracts";
import { MAX_SKEW_S, parseTimestamp, signBody, verifySignature } from "../src/adapters/signing";
import { INBOUND_PER_SEC, OUTBOUND_PER_SEC, resetLimitsForTests, takeSlot } from "../src/adapters/limiter";
import { MAX_ATTEMPTS, RETRY_DELAYS_MS, dispositionOf, dispositionOfFailure, messageAr, nextRetryAt } from "../src/adapters/errors";
import { callSystem, ConfigProblem } from "../src/adapters/client";
import { MOCK_TOKEN, createMockFetch, mockState, resetMocksForTests } from "../src/adapters/mock";
import { validBaseUrl } from "../src/adapters/config";
import { authenticateReader } from "../src/adapters/inbound";

// أمثلة العقود حرفياً من docs/05-integration.md
const DRAFT = {
  source: "s1", external_ref: "pf_2031", name_ar: "زيت إكليل الجبل للشعر", brand: "اسم العلامة المعتمد", country: "SY", currency: "USD", unit_cost: "2.20",
  offers: [{ qty: 1, price: "20.00" }, { qty: 2, price: "35.00" }, { qty: 3, price: "45.00" }], delivery_fee: "2.50", classification: "cosmetic",
  license: { required: false, number: null }, compliance_url: "https://s1.zakai.io/api/s1/v1/products/pf_2031/compliance", images: ["https://s1.zakai.io/files/pf_2031/1.jpg"],
  note: "مسودة من سيستم 1 — بتحتاج اعتماد بالـ OMS",
};
const BRIEF = {
  external_ref: "tt_55",
  product: { ref: "pf_2031", name_ar: "زيت إكليل الجبل للشعر", problem: "تساقط الشعر", reference_pack_url: "https://s1.zakai.io/files/pf_2031/pack.zip", label_text: "نص الملصق المعتمد" },
  angles: [{ code: "A", angle: "مكوّن", hook: "خطّاف الزاوية", pattern: "نمط من مكتبة الإنتاج", page_ref: "pg_02" }],
  allowed_claims: ["بيغذّي فروة الراس"], banned_claims: ["ينبت الشعر"], references: [], ad_rules: ["18 وفوق"],
  compliance_updated_at: "2026-10-06T18:00:00+03:00", publish_requires_owner_approval: true, due: "2026-10-10",
};
const PLAN = {
  external_ref: "pt_12", product_ref: "pf_2031", oms_draft_id: "drf_1029", country: "SY", budget_usd: "350.00", duration_days: 6, winning_angles: ["A", "C"],
  stop_rules: { max_cost_per_confirmed: "6.51", min_spend_before_stop: "100.00", max_return_rate_first_50: 0.32 },
  ad_rules_url: "https://s1.zakai.io/api/s1/v1/products/pf_2031/compliance", requires_finance_check: true, requires_owner_approval: true,
};

describe("العقود: أمثلة الملف بتطابق أشكالها", () => {
  it("المسودة والبريف والخطة والمالية والباقي", () => {
    expect(validateShape(C.OMS_DRAFT_REQUEST, DRAFT)).toEqual([]);
    expect(validateShape(C.OMS_DRAFT_RESPONSE, { draft_id: "drf_1029", status: "draft", created_at: "2026-10-07T09:12:00+03:00" })).toEqual([]);
    expect(validateShape(C.PRODUCTION_BRIEF_REQUEST, BRIEF)).toEqual([]);
    expect(validateShape(C.PRODUCTION_BRIEF_RESPONSE, { brief_id: "br_77", status: "accepted" })).toEqual([]);
    expect(validateShape(C.MEDIABUYER_PLAN_REQUEST, PLAN)).toEqual([]);
    expect(validateShape(C.MEDIABUYER_PLAN_RESPONSE, { plan_id: "mb_301", status: "pending_owner_approval" })).toEqual([]);
    expect(validateShape(C.MEDIABUYER_RESULTS_RESPONSE, { plan_id: "mb_301", status: "completed", spend: "350.00", started_at: "2026-10-13", ended_at: "2026-10-19", stopped_by_rule: null })).toEqual([]);
    expect(validateShape(C.FINANCE_BUDGET_RESPONSE, { month: "2026-10", total: "3000.00", committed: "1250.00", available: "1750.00", outside_dna_share: 0.2 })).toEqual([]);
    expect(validateShape(C.FINANCE_COST_REQUEST, { external_ref: "cr_88", kind: "samples", amount: "120.00", currency: "USD", product_ref: "pf_2031", note: "عيّنات من مورّدين" })).toEqual([]);
    expect(validateShape(C.WORKSPACE_IDEA_REQUEST, { external_ref: "cand_8f3a", title: "x", summary: "x", link: "https://x", tags: ["منتج"] })).toEqual([]);
    expect(validateShape(C.WORKSPACE_PROJECT_REQUEST, { external_ref: "pf_2031", title: "x", cards: [{ title: "العيّنات" }], link: "https://x" })).toEqual([]);
    expect(validateShape(C.TASKS_TASK_REQUEST, { external_ref: "pf_2031-samples", title: "x", assignee_role: "sourcing", due: "2026-10-12", checklist: ["a"], link: "https://x" })).toEqual([]);
    expect(validateShape(C.CLIPPER_BRIEF_REQUEST, { external_ref: "pf_2031", name_ar: "x", angles: ["A"], assets_url: "https://x", compliance_url: "https://x" })).toEqual([]);
    expect(validateShape(C.CRISIS_ALERT_REQUEST, { external_ref: "al_1", type: "batch_quality", severity: "high", product_ref: "pf_2031", message: "x", link: "https://x" })).toEqual([]);
    expect(validateShape(C.COMPLIANCE_RESPONSE, { product_ref: "pf_2031", classification: "cosmetic", verdict: "pass_with_edits", allowed_claims: ["a"], banned_claims: ["b"], references: [{ code: "REF-04", text: "t", source: "s", grading: "g", usage: "u" }], ad_rules: ["r"], updated_at: "2026-10-06T18:00:00+03:00" })).toEqual([]);
  });

  it("المبلغ نص بخانتين، والبلد حرفين، والعملة ثلاثة، والتاريخ ISO بمنطقة", () => {
    expect(validateShape(C.OMS_DRAFT_REQUEST, { ...DRAFT, unit_cost: 2.2 }).length).toBe(1);
    expect(validateShape(C.OMS_DRAFT_REQUEST, { ...DRAFT, unit_cost: "2.2" }).length).toBe(1);
    expect(validateShape(C.OMS_DRAFT_REQUEST, { ...DRAFT, country: "Syria" }).length).toBe(1);
    expect(validateShape(C.OMS_DRAFT_REQUEST, { ...DRAFT, currency: "US" }).length).toBe(1);
    expect(validateShape(C.PRODUCTION_BRIEF_REQUEST, { ...BRIEF, compliance_updated_at: "2026-10-06 18:00" }).length).toBe(1);
  });

  it("المسودة: الرد لازم يكون «draft» (ما بنقبل منتج شغّال)", () => {
    expect(validateShape(C.OMS_DRAFT_RESPONSE, { draft_id: "x", status: "active", created_at: "2026-10-07T09:12:00+03:00" }).length).toBe(1);
  });

  it("كل عقد صادر مسجّل مع شكل طلبه", () => {
    expect(Object.keys(C.OUTBOUND_CONTRACTS).length).toBe(9);
    expect(C.SYSTEMS.length).toBe(8);
  });
});

describe("التوقيع", () => {
  const secret = "shared-secret-for-tests"; // scan:ok
  const body = JSON.stringify({ event_id: "evt_1", type: "metrics.snapshot", occurred_at: "2026-10-12T12:00:00+03:00", data: {} });
  const now = 1_800_000_000;
  const ts = String(now);
  const sig = signBody(secret, ts, body);

  it("بيقبل توقيع صحيح (sha256 على الوقت + نقطة + الجسم الخام)", () => {
    expect(verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowS: now })).toEqual({ ok: true });
    expect(verifySignature({ secret, timestamp: ts, signature: `sha256=${sig}`, rawBody: body, nowS: now })).toEqual({ ok: true });
  });
  it("بيرفض توقيع غلط، جسم معدّل، سر غلط، ترويسات ناقصة، وبلا سر", () => {
    const bad = (o: Partial<Parameters<typeof verifySignature>[0]>) => verifySignature({ secret, timestamp: ts, signature: sig, rawBody: body, nowS: now, ...o });
    expect(bad({ signature: "00".repeat(32) })).toEqual({ ok: false, reason: "bad_signature" });
    expect(bad({ signature: "zz" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(bad({ rawBody: body + " " })).toEqual({ ok: false, reason: "bad_signature" });
    expect(bad({ secret: "other" })).toEqual({ ok: false, reason: "bad_signature" });
    expect(bad({ timestamp: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(bad({ signature: null })).toEqual({ ok: false, reason: "missing_headers" });
    expect(bad({ secret: undefined })).toEqual({ ok: false, reason: "no_secret" });
    expect(bad({ timestamp: "ليس وقت" })).toEqual({ ok: false, reason: "bad_timestamp" });
  });
  it("بيرفض وقت أقدم من 5 دقايق (أو بعيد بالمستقبل)", () => {
    const at = (t: number) => verifySignature({ secret, timestamp: String(t), signature: signBody(secret, String(t), body), rawBody: body, nowS: now });
    expect(at(now - MAX_SKEW_S)).toEqual({ ok: true });
    expect(at(now - MAX_SKEW_S - 1)).toEqual({ ok: false, reason: "stale" });
    expect(at(now + MAX_SKEW_S + 1)).toEqual({ ok: false, reason: "stale" });
  });
  it("الوقت بالثواني أو ISO", () => {
    expect(parseTimestamp("1800000000")).toBe(1800000000);
    expect(parseTimestamp("2026-10-12T12:00:00+03:00")).toBe(Math.floor(Date.parse("2026-10-12T12:00:00+03:00") / 1000));
    expect(parseTimestamp("x")).toBeNull();
  });
});

describe("حدود الطلبات والأخطاء", () => {
  beforeEach(() => resetLimitsForTests());

  it("5 صادر و20 وارد بالثانية", () => {
    expect([OUTBOUND_PER_SEC, INBOUND_PER_SEC]).toEqual([5, 20]);
    for (let i = 0; i < 5; i++) expect(takeSlot("k", 5, 1000 + i)).toBe(0);
    expect(takeSlot("k", 5, 1100)).toBeGreaterThan(0);
    expect(takeSlot("k", 5, 2100)).toBe(0); // بعد ثانية بيفتح
    for (let i = 0; i < 20; i++) expect(takeSlot("in", 20, 5000)).toBe(0);
    expect(takeSlot("in", 20, 5000)).toBeGreaterThan(0);
    expect(takeSlot("other", 5, 5000)).toBe(0); // لكل نظام عدّاد
  });

  it("جدول الحالات: شو بيعمل سيستم 1", () => {
    expect(dispositionOf(400)).toBe("stop");
    expect(dispositionOf(404)).toBe("stop");
    expect(dispositionOf(422)).toBe("stop");
    expect(dispositionOf(401)).toBe("stop_alert");
    expect(dispositionOf(403)).toBe("stop_alert");
    expect(dispositionOf(409)).toBe("stop_alert");
    expect(dispositionOf(429)).toBe("rate_limited");
    for (const s of [500, 502, 503, 504]) expect(dispositionOf(s)).toBe("retry");
    expect(dispositionOfFailure(0)).toBe("retry"); // انقطاع اتصال
  });

  it("الفواصل: دقيقة · 5 دقايق · 30 دقيقة · ساعتين · 6 ساعات، وبعدها ميت", () => {
    expect(RETRY_DELAYS_MS).toEqual([60_000, 300_000, 1_800_000, 7_200_000, 21_600_000]);
    expect(MAX_ATTEMPTS).toBe(6);
    const t0 = new Date("2026-10-01T00:00:00Z");
    const gaps = [1, 2, 3, 4, 5].map((n) => nextRetryAt(n, t0)!.getTime() - t0.getTime());
    expect(gaps).toEqual([...RETRY_DELAYS_MS]);
    expect(nextRetryAt(6, t0)).toBeNull();
    expect(nextRetryAt(2, t0, 90)!.getTime() - t0.getTime()).toBe(90_000); // Retry-After
  });

  it("رسائل عربية", () => {
    expect(messageAr(401, null)).toContain("التوكن بده مراجعة");
    expect(messageAr(422, { error: { message: "سعر العرض الأول ناقص" } })).toBe("سعر العرض الأول ناقص");
    expect(messageAr(0, null)).toContain("انقطاع");
  });
});

describe("عميل HTTP والخادم الوهمي", () => {
  beforeEach(() => {
    resetMocksForTests();
    resetLimitsForTests();
  });
  const post = (system: C.SystemId, path: string, body: unknown, key?: string, extra: object = {}) =>
    callSystem({ system, mode: "mock", method: "POST", path, body, idempotencyKey: key, ...extra });

  it("مسودة للـ OMS الوهمي بترجع رقم، والرد مطابق للعقد", async () => {
    const r = await post("oms", "/api/v1/product-drafts", DRAFT, "s1-draft-pf_2031-v1");
    expect(r.status).toBe(201);
    expect(validateShape(C.OMS_DRAFT_RESPONSE, r.body)).toEqual([]);
    expect((r.body as { draft_id: string }).draft_id).toMatch(/^drf_/);
    expect(r.requestId).toMatch(/^req_/);
  });

  it("نفس المفتاح مرتين = طلب واحد ونفس الرد، وبجسم مختلف = 409", async () => {
    const a = await post("oms", "/api/v1/product-drafts", DRAFT, "k1");
    const b = await post("oms", "/api/v1/product-drafts", DRAFT, "k1");
    expect(b.body).toEqual(a.body);
    expect(mockState().received.oms).toHaveLength(1);
    const c = await post("oms", "/api/v1/product-drafts", { ...DRAFT, name_ar: "غير" }, "k1");
    expect(c.status).toBe(409);
    expect((c.body as { error: { code: string } }).error.code).toBe("IDEMPOTENCY_CONFLICT");
    const d = await post("oms", "/api/v1/product-drafts", DRAFT, "k2"); // مفتاح جديد = طلب جديد
    expect((d.body as { draft_id: string }).draft_id).not.toBe((a.body as { draft_id: string }).draft_id);
  });

  it("التحقق: 422 بالشكل الموحّد مع التفاصيل، وقاعدة عمل: سعر تحت التكلفة", async () => {
    const bad = await post("oms", "/api/v1/product-drafts", { ...DRAFT, unit_cost: 2.2 }, "k3");
    expect(bad.status).toBe(422);
    const body = bad.body as { error: { code: string; details: { field: string }[] }; request_id: string };
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.details[0].field).toBe("unit_cost");
    expect(body.request_id).toBe(bad.requestId);
    const low = await post("oms", "/api/v1/product-drafts", { ...DRAFT, offers: [{ qty: 1, price: "1.00" }] }, "k4");
    expect(low.status).toBe(422);
    expect((low.body as { error: { code: string } }).error.code).toBe("BUSINESS_RULE");
  });

  it("توكن غلط 401، ونقطة مجهولة 404، وتوكن النظام الغلط مرفوض", async () => {
    const wrong = await createMockFetch("oms")("http://mock.oms.local/api/v1/products/performance", { headers: { authorization: `Bearer ${MOCK_TOKEN("finance")}` } });
    expect(wrong.status).toBe(401);
    const none = await callSystem({ system: "oms", mode: "mock", method: "GET", path: "/api/v1/nope" });
    expect(none.status).toBe(404);
  });

  it("إعادة المحاولة: أعطال 503 و429 مع Retry-After وانقطاع الاتصال", async () => {
    mockState().fail.finance = { status: 503, count: 1 };
    expect((await callSystem({ system: "finance", mode: "mock", method: "GET", path: "/api/v1/budgets/test?month=2026-10" })).status).toBe(503);
    mockState().fail.finance = { status: 429, count: 1, retryAfter: 7 };
    const r = await callSystem({ system: "finance", mode: "mock", method: "GET", path: "/api/v1/budgets/test?month=2026-10" });
    expect([r.status, r.retryAfterS]).toEqual([429, 7]);
    mockState().down.finance = true;
    expect((await callSystem({ system: "finance", mode: "mock", method: "GET", path: "/api/v1/budgets/test?month=2026-10" })).status).toBe(0);
  });

  it("كل نقاط الأنظمة الثمانية موجودة بعقودها", async () => {
    const day = (s: C.SystemId, p: string, shape?: Parameters<typeof validateShape>[0]) =>
      callSystem({ system: s, mode: "mock", method: "GET", path: p }).then((r) => {
        expect(r.status, p).toBe(200);
        if (shape) expect(validateShape(shape, r.body), p).toEqual([]);
      });
    await day("oms", "/api/v1/products/performance?from=2026-01-01&to=2026-10-01&country=SY", C.OMS_PERFORMANCE_RESPONSE);
    await day("production", "/api/v1/organic-metrics?brief_id=br_77", C.PRODUCTION_METRICS_RESPONSE);
    await day("mediabuyer", "/api/v1/test-results?product_ref=pf_2031", C.MEDIABUYER_RESULTS_RESPONSE);
    await day("finance", "/api/v1/budgets/test?month=2026-10", C.FINANCE_BUDGET_RESPONSE);
    expect((await post("production", "/api/v1/briefs", BRIEF, "b1")).status).toBe(201);
    expect((await post("mediabuyer", "/api/v1/test-plans", PLAN, "p1")).status).toBe(201);
    expect((await post("finance", "/api/v1/cost-requests", { external_ref: "cr_88", kind: "samples", amount: "120.00", currency: "USD", product_ref: "pf_2031", note: "x" }, "c1")).status).toBe(201);
    expect((await post("workspace", "/api/v1/ideas", { external_ref: "c", title: "t", summary: "s", link: "l", tags: [] }, "w1")).status).toBe(201);
    expect((await post("tasks", "/api/v1/tasks", { external_ref: "t", title: "t", assignee_role: "r", due: "2026-10-12", checklist: [], link: "l" }, "t1")).status).toBe(201);
    expect((await post("clipper", "/api/v1/product-briefs", { external_ref: "p", name_ar: "n", angles: [], assets_url: "u", compliance_url: "u" }, "cl1")).status).toBe(201);
    expect((await post("crisis", "/api/v1/alerts", { external_ref: "a", type: "t", severity: "high", product_ref: "p", message: "m", link: "l" }, "cr1")).status).toBe(201);
  });
});

describe("الوضع الحقيقي: العنوان والتوكن من .env، والتوكن ما بيتسرّب", () => {
  it("بلا عنوان آمن أو توكن: خطأ إعداد بلا اتصال", async () => {
    const call = (env: Record<string, string>) => callSystem({ system: "oms", mode: "real", method: "GET", path: "/x", env, fetchImpl: (async () => Response.json({})) as typeof fetch });
    await expect(call({})).rejects.toBeInstanceOf(ConfigProblem);
    await expect(call({ OMS_BASE_URL: "http://oms.example.com", OMS_TOKEN: "t" })).rejects.toThrow("https"); // http برّا localhost ممنوع
    await expect(call({ OMS_BASE_URL: "https://oms.example.com" })).rejects.toThrow("توكن");
  });

  it("بيبعت التوكن بالترويسة بس، بلا تحويلات، وبيحط المفتاح الفريد ومعرّف الطلب", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const f = (async (url: RequestInfo | URL, init?: RequestInit) => ((seen = { url: String(url), init: init! }), Response.json({ ok: 1 }))) as typeof fetch;
    const secretToken = "tok-live-123"; // scan:ok
    const r = await callSystem({ system: "oms", mode: "real", method: "POST", path: "/api/v1/product-drafts", body: { a: 1 }, idempotencyKey: "k", env: { OMS_BASE_URL: "https://oms.example.com/", OMS_TOKEN: secretToken }, fetchImpl: f });
    expect(seen!.url).toBe("https://oms.example.com/api/v1/product-drafts");
    const h = seen!.init.headers as Record<string, string>;
    expect(h.authorization).toBe(`Bearer ${secretToken}`);
    expect(h["idempotency-key"]).toBe("k");
    expect(h["x-request-id"]).toMatch(/^req_/);
    expect(seen!.init.redirect).toBe("manual");
    expect(JSON.stringify(r)).not.toContain(secretToken); // مش بالنتيجة
    expect(seen!.url).not.toContain(secretToken); // ولا بالرابط
  });

  it("رد مش JSON أو انقطاع: ما بينهار", async () => {
    const env = { OMS_BASE_URL: "https://oms.example.com", OMS_TOKEN: "t" };
    const html = await callSystem({ system: "oms", mode: "real", method: "GET", path: "/x", env, fetchImpl: (async () => new Response("<html>", { status: 502 })) as typeof fetch });
    expect(html.status).toBe(502);
    const dead = await callSystem({ system: "oms", mode: "real", method: "GET", path: "/x", env, fetchImpl: (async () => { throw new TypeError("fetch failed"); }) as typeof fetch });
    expect(dead.status).toBe(0);
  });

  it("قواعد العناوين: https أو localhost بس", () => {
    expect(validBaseUrl("https://a.example.com/")).toBe("https://a.example.com");
    expect(validBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(validBaseUrl("http://127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
    for (const bad of ["http://a.example.com", "ftp://x", "javascript:alert(1)", "", undefined, "مش رابط"]) expect(validBaseUrl(bad as string), String(bad)).toBeNull();
  });
});

describe("توكنات قراءة الأنظمة التانية", () => {
  const env = { S1_TOKEN_PRODUCTION: "prod-token-xyz", S1_TOKEN_CLIPPER: "clip-token-abc" }; // scan:ok
  it("كل نظام بتوكنه، والغلط أو الناقص مرفوض", () => {
    expect(authenticateReader("Bearer prod-token-xyz", env)).toBe("production");
    expect(authenticateReader("Bearer clip-token-abc", env)).toBe("clipper");
    expect(authenticateReader("Bearer nope", env)).toBeNull();
    expect(authenticateReader(null, env)).toBeNull();
    expect(authenticateReader("prod-token-xyz", env)).toBeNull();
    expect(authenticateReader("Bearer ", env)).toBeNull();
    expect(authenticateReader("Bearer anything", {})).toBeNull(); // بلا توكنات مضبوطة = ما حدا بيدخل
  });
});
