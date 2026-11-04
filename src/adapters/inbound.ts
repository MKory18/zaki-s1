// استقبال الأحداث: توقيع + وقت + رفض المكرر. وقراءة الأنظمة التانية من سيستم 1 (قواعد الادعاءات والمرشحين) بتوكن لكل نظام.
import { timingSafeEqual } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { validateShape } from "@/agents/shape";
import { raiseAlert } from "@/lib/alerts";
import { EVENT_ENVELOPE, INBOUND_EVENT_TYPES, type InboundSystem } from "./contracts";
import { INBOUND_PER_SEC, takeSlot } from "./limiter";
import { verifySignature } from "./signing";

export const secretEnv = (s: InboundSystem) => `WEBHOOK_SECRET_${s.toUpperCase()}`;

export type EventHandler = (db: PrismaClient, e: { system: InboundSystem; type: string; eventId: string; occurredAt: string; data: unknown }) => Promise<void>;
// معالجات الأحداث بتنضاف مع وحدتها (مختبر الترند، الربط الحقيقي...). هلأ بنسجّل بس.
const handlers = new Map<string, EventHandler>();
export const registerEventHandler = (type: string, h: EventHandler) => void handlers.set(type, h);
export const clearEventHandlersForTests = () => handlers.clear();

export interface InboundResult {
  status: number;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

const reject = (status: number, code: string, message: string, headers?: Record<string, string>): InboundResult => ({ status, body: { error: { code, message } }, headers });

export async function receiveEvent(
  db: PrismaClient,
  system: InboundSystem,
  req: { rawBody: string; timestamp: string | null; signature: string | null },
  env: Record<string, string | undefined> = process.env,
  nowS?: number,
): Promise<InboundResult> {
  // الحد: 20 حدث بالثانية
  const wait = takeSlot(`in:${system}`, INBOUND_PER_SEC);
  if (wait > 0) return reject(429, "RATE_LIMITED", "كتير أحداث، استنى", { "retry-after": String(Math.ceil(wait / 1000) || 1) });

  const v = verifySignature({ secret: env[secretEnv(system)], timestamp: req.timestamp, signature: req.signature, rawBody: req.rawBody, nowS });
  if (!v.ok) {
    // الحدث المرفوض بيتسجّل بدون محتواه (غير موثوق)
    await db.inboundEvent.create({ data: { system, eventType: "rejected", signatureOk: false, payloadJson: { reason: v.reason } as never, error: v.reason } });
    if (v.reason === "no_secret") raiseAlert({ type: "integration_config", severity: "warning", message: `سر توقيع ${system} مش مضبوط (${secretEnv(system)})` });
    return reject(v.reason === "no_secret" ? 503 : 401, "UNAUTHORIZED", v.reason === "stale" ? "الوقت قديم" : v.reason === "no_secret" ? "الاستقبال مش مضبوط" : "توقيع غلط");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(req.rawBody);
  } catch {
    return reject(400, "BAD_REQUEST", "الجسم مش JSON");
  }
  const errors = validateShape(EVENT_ENVELOPE, payload);
  // data كائن حر: بنتجاهل أخطاء مفاتيحه الزايدة ونفحص الغلاف بس
  const envelopeErrors = errors.filter((e) => !e.startsWith("$.data."));
  if (envelopeErrors.length) return reject(422, "VALIDATION_FAILED", `الحدث مش مطابق للعقد: ${envelopeErrors[0]}`);

  const ev = payload as { event_id: string; type: string; occurred_at: string; data: unknown };
  if (!(INBOUND_EVENT_TYPES[system] as readonly string[]).includes(ev.type)) return reject(422, "VALIDATION_FAILED", `نوع الحدث ${ev.type} مش من أحداث هالنظام`);

  // رفض المكرر: بيرجع نجاح بلا معالجة تانية. القيد الفريد بالقاعدة هو الحكم.
  try {
    await db.inboundEvent.create({ data: { system, eventType: ev.type, eventId: ev.event_id, signatureOk: true, payloadJson: payload as never } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { status: 200, body: { status: "duplicate", event_id: ev.event_id } };
    throw e;
  }

  const h = handlers.get(ev.type);
  let error: string | null = null;
  if (h) {
    try {
      await h(db, { system, type: ev.type, eventId: ev.event_id, occurredAt: ev.occurred_at, data: ev.data });
    } catch (e) {
      error = e instanceof Error ? e.message : "فشلت المعالجة";
    }
  }
  await db.inboundEvent.update({ where: { system_eventId: { system, eventId: ev.event_id } }, data: { processedAt: new Date(), error } });
  return { status: 200, body: { status: error ? "recorded_with_error" : "ok", event_id: ev.event_id } };
}

// ───── قراءة الأنظمة التانية من سيستم 1: توكن لكل نظام بأقل صلاحية (قراءة بس) ─────
export const READER_SYSTEMS = ["production", "mediabuyer", "clipper", "responses", "workspace"] as const;
export type ReaderSystem = (typeof READER_SYSTEMS)[number];
export const readerTokenEnv = (s: ReaderSystem) => `S1_TOKEN_${s.toUpperCase()}`;

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function authenticateReader(authHeader: string | null, env: Record<string, string | undefined> = process.env): ReaderSystem | null {
  const m = /^Bearer\s+(.+)$/.exec(authHeader ?? "");
  if (!m) return null;
  for (const s of READER_SYSTEMS) {
    const t = env[readerTokenEnv(s)];
    if (t && safeEqual(t, m[1])) return s;
  }
  return null;
}
