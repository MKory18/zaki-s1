// سجل الطلبات الصادرة: المفتاح الفريد، إعادة المحاولة بالفواصل المكتوبة، «ميت» بعد 5 إعادات + تنبيه + إعادة إرسال يدوية.
// كل محاولة بنفس المفتاح الفريد، فما في تكرار حتى لو الطلب وصل أول مرة.
import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { validateShape } from "@/agents/shape";
import { raiseAlert } from "@/lib/alerts";
import { callSystem, ConfigProblem, type CallOptions } from "./client";
import { getMode, type Mode } from "./config";
import { OUTBOUND_CONTRACTS, SYSTEM_LABELS_AR, type SystemId } from "./contracts";
import { MAX_ATTEMPTS, dispositionOfFailure, messageAr, nextRetryAt, type ApiErrorBody } from "./errors";

export type OutboxStatus = "pending" | "ok" | "failed" | "dead";

export interface OutboxDeps {
  mode?: Mode;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: Date;
  sleep?: CallOptions["sleep"];
}

export interface OutboxRow {
  id: string;
  system: string;
  endpoint: string;
  idempotencyKey: string;
  attempts: number;
  status: OutboxStatus;
  responseCode: number | null;
  responseJson: unknown;
  nextRetryAt: string | null;
  createdAt: string;
}

export class ContractError extends Error {
  constructor(message: string, public errors: string[] = []) {
    super(message);
  }
}
export class IdempotencyConflictError extends Error {}

// ترتيب المفاتيح ثابت عشان مقارنة «نفس الجسم» ما تتأثر بترتيب الحقول
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
export const payloadHash = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");

const toRow = (r: Awaited<ReturnType<PrismaClient["outboundRequest"]["findUniqueOrThrow"]>>): OutboxRow => ({
  id: r.id,
  system: r.system,
  endpoint: r.endpoint,
  idempotencyKey: r.idempotencyKey,
  attempts: r.attempts,
  status: r.status,
  responseCode: r.responseCode,
  responseJson: r.responseJson,
  nextRetryAt: r.nextRetryAt?.toISOString() ?? null,
  createdAt: r.createdAt.toISOString(),
});

const label = (s: string) => SYSTEM_LABELS_AR[s as SystemId] ?? s;

// محاولة إرسال وحدة لصف موجود، وتحديث حالته حسب الرد
async function attempt(db: PrismaClient, id: string, deps: OutboxDeps): Promise<OutboxRow> {
  const row = await db.outboundRequest.findUniqueOrThrow({ where: { id } });
  const system = row.system as SystemId;
  const contract = OUTBOUND_CONTRACTS[`${system} POST ${row.endpoint}`];
  const now = deps.now ?? new Date();
  const mode = deps.mode ?? (await getMode(db, system));
  const payload = (row.payloadJson as { payload: unknown }).payload;

  let res;
  try {
    res = await callSystem({ system, mode, method: "POST", path: row.endpoint, body: payload, idempotencyKey: row.idempotencyKey, fetchImpl: deps.fetchImpl, env: deps.env, sleep: deps.sleep });
  } catch (e) {
    if (e instanceof ConfigProblem) {
      // إعداد ناقص: وقف بلا إعادة، وتنبيه
      const upd = await db.outboundRequest.update({ where: { id }, data: { attempts: row.attempts + 1, status: "failed", responseJson: { error: e.message } as never, nextRetryAt: null } });
      raiseAlert({ type: "integration_config", severity: "warning", message: `${label(system)}: ${e.message}` }, now);
      return toRow(upd);
    }
    throw e;
  }

  const attempts = row.attempts + 1;
  const body = res.body as ApiErrorBody | null;

  if (res.status >= 200 && res.status < 300) {
    const errors = contract?.response ? validateShape(contract.response, res.body) : [];
    if (errors.length) {
      const upd = await db.outboundRequest.update({
        where: { id },
        data: { attempts, status: "failed", responseCode: res.status, responseJson: { error: "رد النظام مش مطابق للعقد", details: errors.slice(0, 5), request_id: res.requestId } as never, nextRetryAt: null },
      });
      raiseAlert({ type: "contract_mismatch", severity: "warning", message: `${label(system)}: الرد مش مطابق للعقد (${errors[0]})` }, now);
      return toRow(upd);
    }
    const upd = await db.outboundRequest.update({ where: { id }, data: { attempts, status: "ok", responseCode: res.status, responseJson: (res.body ?? Prisma.JsonNull) as never, nextRetryAt: null } });
    return toRow(upd);
  }

  const disp = dispositionOfFailure(res.status);
  const errJson = { error: messageAr(res.status, body), status: res.status, request_id: res.requestId, code: body?.error?.code ?? null };

  if (disp === "retry" || disp === "rate_limited") {
    const when = nextRetryAt(attempts, now, disp === "rate_limited" ? res.retryAfterS : undefined);
    if (!when) {
      const upd = await db.outboundRequest.update({ where: { id }, data: { attempts, status: "dead", responseCode: res.status, responseJson: errJson as never, nextRetryAt: null } });
      raiseAlert({ type: "outbound_dead", severity: "critical", message: `طلب «ميت» لـ${label(system)} بعد ${MAX_ATTEMPTS} محاولات (${row.idempotencyKey}). اضغط «أعد الإرسال» لما يرجع النظام.` }, now);
      return toRow(upd);
    }
    const upd = await db.outboundRequest.update({ where: { id }, data: { attempts, status: "pending", responseCode: res.status, responseJson: errJson as never, nextRetryAt: when } });
    return toRow(upd);
  }

  const upd = await db.outboundRequest.update({ where: { id }, data: { attempts, status: "failed", responseCode: res.status, responseJson: errJson as never, nextRetryAt: null } });
  if (disp === "stop_alert") {
    raiseAlert({ type: res.status === 409 ? "idempotency_conflict" : "token_review", severity: "warning", message: `${label(system)}: ${errJson.error}` }, now);
  }
  return toRow(upd);
}

export interface SubmitInput {
  system: SystemId;
  endpoint: string; // /api/v1/...
  payload: unknown;
  idempotencyKey: string;
}

// الطريق الوحيد لإرسال طلب إنشاء لنظام تاني. بيحفظ بالسجل أول، وبعدين بيرسل.
export async function submit(db: PrismaClient, input: SubmitInput, deps: OutboxDeps = {}): Promise<OutboxRow> {
  const contract = OUTBOUND_CONTRACTS[`${input.system} POST ${input.endpoint}`];
  if (!contract) throw new ContractError(`ما في عقد معروف لـ ${input.system} ${input.endpoint}`);
  const errors = validateShape(contract.request, input.payload);
  if (errors.length) throw new ContractError("الطلب مش مطابق للعقد، ما انبعت", errors.slice(0, 8));

  const hash = payloadHash(input.payload);
  const stored = { payload: input.payload, hash };
  const existing = await db.outboundRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) {
    const prevHash = (existing.payloadJson as { hash?: string }).hash;
    if (prevHash !== hash) {
      raiseAlert({ type: "idempotency_conflict", severity: "warning", message: `نفس المفتاح ${input.idempotencyKey} بجسم مختلف (${label(existing.system)}). المفتاح الجديد لكل نسخة.` }, deps.now);
      throw new IdempotencyConflictError("نفس المفتاح الفريد بجسم مختلف");
    }
    return toRow(existing); // نفس المفتاح ونفس الجسم = طلب واحد (ما بنرسل ولا بنكرر)
  }

  let created;
  try {
    created = await db.outboundRequest.create({ data: { system: input.system, endpoint: input.endpoint, idempotencyKey: input.idempotencyKey, payloadJson: stored as never } });
  } catch (e) {
    // سباق بين طلبين بنفس المفتاح: القيد الفريد بالقاعدة بيحمينا، والخاسر بيرجّع الصف الموجود
    const again = await db.outboundRequest.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
    if (again) return toRow(again);
    throw e;
  }
  return attempt(db, created.id, deps);
}

// مهمة outbound.retry (كل 5 دقايق): الطلبات المعلّقة اللي حان موعدها
export async function retryDue(db: PrismaClient, deps: OutboxDeps = {}, limit = 50): Promise<OutboxRow[]> {
  const now = deps.now ?? new Date();
  const stuck = new Date(now.getTime() - 60_000);
  const rows = await db.outboundRequest.findMany({
    where: { status: "pending", OR: [{ nextRetryAt: { lte: now } }, { nextRetryAt: null, attempts: 0, createdAt: { lte: stuck } }] },
    orderBy: { createdAt: "asc" },
    take: limit,
  });
  const out: OutboxRow[] = [];
  for (const r of rows) out.push(await attempt(db, r.id, deps));
  return out;
}

// زر «أعد الإرسال»: لطلب ميت أو موقوف
export async function resend(db: PrismaClient, id: string, deps: OutboxDeps = {}): Promise<OutboxRow> {
  const row = await db.outboundRequest.findUnique({ where: { id } });
  if (!row) throw new ContractError("الطلب مش موجود");
  if (row.status !== "dead" && row.status !== "failed") throw new ContractError("بس الطلب الميت أو الموقوف بينعاد إرساله");
  await db.outboundRequest.update({ where: { id }, data: { status: "pending", attempts: 0, nextRetryAt: null, responseJson: Prisma.JsonNull } });
  return attempt(db, id, deps);
}

export async function listOutbox(db: PrismaClient, limit = 100): Promise<OutboxRow[]> {
  return (await db.outboundRequest.findMany({ orderBy: { createdAt: "desc" }, take: limit })).map(toRow);
}

export async function outboxCounts(db: PrismaClient): Promise<Record<string, Record<OutboxStatus, number>>> {
  const groups = await db.outboundRequest.groupBy({ by: ["system", "status"], _count: { _all: true } });
  const out: Record<string, Record<OutboxStatus, number>> = {};
  for (const g of groups) {
    out[g.system] ??= { pending: 0, ok: 0, failed: 0, dead: 0 };
    out[g.system][g.status] = g._count._all;
  }
  return out;
}
