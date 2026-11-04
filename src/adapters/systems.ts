// محوّل لكل نظام بعقده. إذا نظام سمّى نقاطه بشكل مختلف بيتعدّل هون بس. مسودات واقتراحات بس.
import type { PrismaClient } from "@/generated/prisma/client";
import { validateShape, type Shape } from "@/agents/shape";
import { raiseAlert } from "@/lib/alerts";
import { callSystem, ConfigProblem } from "./client";
import { getMode } from "./config";
import * as C from "./contracts";
import type { SystemId } from "./contracts";
import { dispositionOfFailure, messageAr, type ApiErrorBody } from "./errors";
import { submit, ContractError, type OutboxDeps, type OutboxRow } from "./outbox";

export class IntegrationError extends Error {
  constructor(message: string, public system: SystemId, public status: number) {
    super(message);
  }
}

export class PaidPlanBlocked extends Error {}

// قراءة (GET) بعقد مفحوص. الفشل بيطلّع خطأ بالعربي وتنبيه، بلا نتيجة مفبركة.
async function read<T>(db: PrismaClient, system: SystemId, path: string, shape: Shape, deps: OutboxDeps): Promise<T> {
  const mode = deps.mode ?? (await getMode(db, system));
  let res;
  try {
    res = await callSystem({ system, mode, method: "GET", path, fetchImpl: deps.fetchImpl, env: deps.env, sleep: deps.sleep });
  } catch (e) {
    if (e instanceof ConfigProblem) throw new IntegrationError(e.message, system, 0);
    throw e;
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = messageAr(res.status, res.body as ApiErrorBody | null);
    if (dispositionOfFailure(res.status) === "stop_alert") raiseAlert({ type: "token_review", severity: "warning", message: `${C.SYSTEM_LABELS_AR[system]}: ${msg}` }, deps.now);
    throw new IntegrationError(msg, system, res.status);
  }
  const errors = validateShape(shape, res.body);
  if (errors.length) {
    raiseAlert({ type: "contract_mismatch", severity: "warning", message: `${C.SYSTEM_LABELS_AR[system]}: الرد مش مطابق للعقد (${errors[0]})` }, deps.now);
    throw new IntegrationError("رد النظام مش مطابق للعقد", system, res.status);
  }
  return res.body as T;
}

// ───── قراءات ─────
export interface OmsItem {
  product_id: string;
  external_ref: string;
  name: string;
  country: string;
  status: string;
  started_at: string;
  ad_spend: string;
  orders: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  returned: number;
  collected: string;
  delivery_fees: string;
  return_fees: string;
  cogs_delivered: string;
  offers_mix: { qty: number; share: number }[];
}
// أرقام الـ OMS دايماً بتغلب: أرقام مجمّعة لكل منتج، ولا بيانات زبائن
export const getOmsPerformance = (db: PrismaClient, q: { from: string; to: string; country?: string }, deps: OutboxDeps = {}) =>
  read<{ generated_at: string; items: OmsItem[] }>(db, "oms", `/api/v1/products/performance?from=${q.from}&to=${q.to}${q.country ? `&country=${q.country}` : ""}`, C.OMS_PERFORMANCE_RESPONSE, deps);

export const getProductionMetrics = (db: PrismaClient, briefId: string, deps: OutboxDeps = {}) =>
  read<{ items: Record<string, unknown>[] }>(db, "production", `/api/v1/organic-metrics?brief_id=${encodeURIComponent(briefId)}`, C.PRODUCTION_METRICS_RESPONSE, deps);

export const getMediaBuyerResults = (db: PrismaClient, productRef: string, deps: OutboxDeps = {}) =>
  read<Record<string, unknown>>(db, "mediabuyer", `/api/v1/test-results?product_ref=${encodeURIComponent(productRef)}`, C.MEDIABUYER_RESULTS_RESPONSE, deps);

export const getFinanceBudget = (db: PrismaClient, month: string, deps: OutboxDeps = {}) =>
  read<{ month: string; total: string; committed: string; available: string; outside_dna_share: number }>(db, "finance", `/api/v1/budgets/test?month=${month}`, C.FINANCE_BUDGET_RESPONSE, deps);

// ───── إرسال (بالسجل: مفتاح فريد وإعادة محاولة) ─────
const send = (db: PrismaClient, system: SystemId, endpoint: string, payload: unknown, key: string, deps: OutboxDeps): Promise<OutboxRow> =>
  submit(db, { system, endpoint, payload, idempotencyKey: key }, deps);

// مسودة منتج للـ OMS: مسودة بس، والتفعيل بالـ OMS بموافقتك. المفتاح: s1-draft-<ref>-v<n>
export const sendOmsDraft = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "oms", "/api/v1/product-drafts", payload, key, deps);
export const sendProductionBrief = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "production", "/api/v1/briefs", payload, key, deps);
export const sendCostRequest = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "finance", "/api/v1/cost-requests", payload, key, deps);
export const sendWorkspaceIdea = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "workspace", "/api/v1/ideas", payload, key, deps);
export const sendWorkspaceProject = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "workspace", "/api/v1/projects", payload, key, deps);
export const sendTask = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "tasks", "/api/v1/tasks", payload, key, deps);
export const sendClipperBrief = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "clipper", "/api/v1/product-briefs", payload, key, deps);
export const sendCrisisAlert = (db: PrismaClient, payload: unknown, key: string, deps: OutboxDeps = {}) => send(db, "crisis", "/api/v1/alerts", payload, key, deps);

// خطة اختبار مدفوع: اقتراح للميديا باير بعد قراءة ميزانية المالية. المالية واقفة أو الميزانية مش معروفة = ولا خطة (الأمان أولاً).
export async function sendPaidTestPlan(db: PrismaClient, plan: { budget_usd: string; requires_finance_check?: boolean; requires_owner_approval?: boolean } & Record<string, unknown>, key: string, month: string, deps: OutboxDeps = {}): Promise<OutboxRow> {
  if (plan.requires_finance_check !== true || plan.requires_owner_approval !== true) {
    throw new ContractError("الخطة المدفوعة لازم تمرّ على المالية وعلى موافقتك");
  }
  let budget;
  try {
    budget = await getFinanceBudget(db, month, deps);
  } catch (e) {
    throw new PaidPlanBlocked(`المالية مش متاحة أو الميزانية مش معروفة، فما بتنبعت خطة مدفوعة (${e instanceof Error ? e.message : "؟"})`);
  }
  if (parseFloat(budget.available) < parseFloat(plan.budget_usd)) {
    throw new PaidPlanBlocked(`الميزانية المتاحة (${budget.available}$) أقل من المطلوب (${plan.budget_usd}$)`);
  }
  return send(db, "mediabuyer", "/api/v1/test-plans", plan, key, deps);
}
