// الخوادم الوهمية للأنظمة الثمانية، بنفس العقود (docs/05-integration.md): توكن، مفتاح فريد، تحقق من الشكل، أخطاء بالشكل الموحّد.
// بتنبني كـ fetch بالذاكرة، فعميل HTTP الحقيقي بيشتغل عليها بلا تغيير. حالتها على globalThis (وبتتصفّر بالاختبارات).
import { createHash } from "node:crypto";
import { validateShape, type Shape } from "@/agents/shape";
import * as C from "../contracts";
import type { SystemId } from "../contracts";

export const MOCK_TOKEN = (s: SystemId) => `mock-token-${s}`;

interface MockState {
  seq: number;
  idem: Map<string, { hash: string; status: number; body: unknown }>;
  drafts: Map<string, unknown>;
  received: Record<string, unknown[]>;
  /** حقن أعطال للاختبار: الحالة والعدد (وRetry-After) */
  fail: Partial<Record<SystemId, { status: number; count: number; retryAfter?: number }>>;
  down: Partial<Record<SystemId, boolean>>;
  financeBudget: { total: string; committed: string } | null;
  metrics: unknown[];
}

const g = globalThis as unknown as { __s1Mock?: MockState };
const fresh = (): MockState => ({ seq: 1000, idem: new Map(), drafts: new Map(), received: {}, fail: {}, down: {}, financeBudget: { total: "3000.00", committed: "1250.00" }, metrics: [] });
export const mockState = (): MockState => (g.__s1Mock ??= fresh());
export function resetMocksForTests() {
  g.__s1Mock = fresh();
}

const nextId = (prefix: string) => `${prefix}_${++mockState().seq}`;
const hashOf = (body: string) => createHash("sha256").update(body).digest("hex");

function err(status: number, code: string, message: string, requestId: string, details?: { field: string; issue: string }[], headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { code, message, ...(details ? { details } : {}) }, request_id: requestId }), {
    status,
    headers: { "content-type": "application/json", "x-request-id": requestId, ...headers },
  });
}
const ok = (body: unknown, requestId: string, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "x-request-id": requestId } });

type Handler = (ctx: { url: URL; method: string; body: unknown; requestId: string; system: SystemId }) => Response;

function validated(shape: Shape, ctx: { body: unknown; requestId: string }, then: () => Response): Response {
  const errors = validateShape(shape, ctx.body);
  if (errors.length) {
    return err(422, "VALIDATION_FAILED", "الطلب مش مطابق للعقد", ctx.requestId, errors.slice(0, 5).map((e) => ({ field: e.split(":")[0].replace(/^\$\.?/, ""), issue: e.split(": ")[1] ?? "غلط" })));
  }
  return then();
}

const ROUTES: Record<SystemId, Record<string, Handler>> = {
  oms: {
    "GET /api/v1/products/performance": ({ requestId }) =>
      ok(
        {
          generated_at: new Date().toISOString().replace("Z", "+00:00"),
          items: [
            { product_id: "p_101", external_ref: "pf_1880", name: "منتج مثال", country: "SY", status: "active", started_at: "2026-03-02", ad_spend: "350.00", orders: 75, confirmed: 60, shipped: 58, delivered: 43, returned: 15, collected: "860.00", delivery_fees: "145.00", return_fees: "0.00", cogs_delivered: "94.60", offers_mix: [{ qty: 1, share: 0.62 }, { qty: 2, share: 0.29 }, { qty: 3, share: 0.09 }] },
          ],
        },
        requestId,
      ),
    "POST /api/v1/product-drafts": (ctx) =>
      validated(C.OMS_DRAFT_REQUEST, ctx, () => {
        const b = ctx.body as { unit_cost: string; offers: { qty: number; price: string }[] };
        if (b.offers.length === 0 || b.offers.some((o) => parseFloat(o.price) <= parseFloat(b.unit_cost))) {
          return err(422, "BUSINESS_RULE", "سعر العرض لازم يكون أعلى من التكلفة", ctx.requestId);
        }
        const id = nextId("drf");
        mockState().drafts.set(id, ctx.body);
        return ok({ draft_id: id, status: "draft", created_at: new Date().toISOString().replace("Z", "+00:00") }, ctx.requestId, 201);
      }),
  },
  production: {
    "POST /api/v1/briefs": (ctx) => validated(C.PRODUCTION_BRIEF_REQUEST, ctx, () => ok({ brief_id: nextId("br"), status: "accepted" }, ctx.requestId, 201)),
    "GET /api/v1/organic-metrics": ({ requestId }) => ok({ items: mockState().metrics }, requestId),
  },
  mediabuyer: {
    "POST /api/v1/test-plans": (ctx) => validated(C.MEDIABUYER_PLAN_REQUEST, ctx, () => ok({ plan_id: nextId("mb"), status: "pending_owner_approval" }, ctx.requestId, 201)),
    "GET /api/v1/test-results": ({ requestId }) => ok({ plan_id: "mb_301", status: "completed", spend: "350.00", started_at: "2026-10-13", ended_at: "2026-10-19", stopped_by_rule: null }, requestId),
  },
  finance: {
    "GET /api/v1/budgets/test": ({ url, requestId }) => {
      const b = mockState().financeBudget;
      if (!b) return err(503, "UNAVAILABLE", "الميزانية مش معروفة", requestId);
      const available = (parseFloat(b.total) - parseFloat(b.committed)).toFixed(2);
      return ok({ month: url.searchParams.get("month") ?? "2026-10", total: b.total, committed: b.committed, available, outside_dna_share: 0.2 }, requestId);
    },
    "POST /api/v1/cost-requests": (ctx) => validated(C.FINANCE_COST_REQUEST, ctx, () => ok({ request_id: nextId("fin"), status: "pending_owner_approval" }, ctx.requestId, 201)),
  },
  workspace: {
    "POST /api/v1/ideas": (ctx) => validated(C.WORKSPACE_IDEA_REQUEST, ctx, () => ok({ id: nextId("idea"), status: "received" }, ctx.requestId, 201)),
    "POST /api/v1/projects": (ctx) => validated(C.WORKSPACE_PROJECT_REQUEST, ctx, () => ok({ id: nextId("prj"), status: "received" }, ctx.requestId, 201)),
  },
  tasks: { "POST /api/v1/tasks": (ctx) => validated(C.TASKS_TASK_REQUEST, ctx, () => ok({ id: nextId("tsk"), status: "open" }, ctx.requestId, 201)) },
  clipper: { "POST /api/v1/product-briefs": (ctx) => validated(C.CLIPPER_BRIEF_REQUEST, ctx, () => ok({ id: nextId("cb"), status: "received" }, ctx.requestId, 201)) },
  crisis: { "POST /api/v1/alerts": (ctx) => validated(C.CRISIS_ALERT_REQUEST, ctx, () => ok({ id: nextId("al"), status: "received" }, ctx.requestId, 201)) },
};

export function createMockFetch(system: SystemId): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const st = mockState();
    const url = new URL(String(input));
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    const requestId = headers.get("x-request-id") ?? "req_none";
    if (st.down[system]) throw new TypeError("fetch failed"); // انقطاع اتصال
    if (headers.get("authorization") !== `Bearer ${MOCK_TOKEN(system)}`) return err(401, "UNAUTHORIZED", "توكن غلط", requestId);

    const injected = st.fail[system];
    if (injected && injected.count > 0) {
      injected.count -= 1;
      return err(injected.status, injected.status === 429 ? "RATE_LIMITED" : "SERVER_ERROR", "عطل مصطنع للاختبار", requestId, undefined, injected.retryAfter ? { "retry-after": String(injected.retryAfter) } : {});
    }

    const rawBody = typeof init?.body === "string" ? init.body : "";
    // المفتاح الفريد: نفس المفتاح بنفس الجسم = نفس الرد بلا تكرار، وبجسم مختلف = 409
    const idemKey = headers.get("idempotency-key");
    if (method === "POST" && idemKey) {
      const prev = st.idem.get(`${system}:${idemKey}`);
      if (prev) {
        if (prev.hash !== hashOf(rawBody)) return err(409, "IDEMPOTENCY_CONFLICT", "نفس المفتاح بجسم مختلف", requestId);
        return ok(prev.body, requestId, prev.status);
      }
    }

    let body: unknown = undefined;
    if (rawBody) {
      try {
        body = JSON.parse(rawBody);
      } catch {
        return err(400, "BAD_REQUEST", "الجسم مش JSON", requestId);
      }
    }
    const route = ROUTES[system][`${method} ${url.pathname}`] ?? (url.pathname.startsWith("/api/v1/product-drafts/") && system === "oms" && method === "GET" ? (({ requestId: r }) => ok({ draft_id: url.pathname.split("/").pop(), status: "draft" }, r)) as Handler : undefined);
    if (!route) return err(404, "NOT_FOUND", "النقطة مش موجودة", requestId);

    const res = route({ url, method, body, requestId, system });
    if (method === "POST") {
      (st.received[system] ??= []).push(body);
      if (idemKey && res.status < 300) st.idem.set(`${system}:${idemKey}`, { hash: hashOf(rawBody), status: res.status, body: await res.clone().json() });
    }
    return res;
  }) as typeof fetch;
}
