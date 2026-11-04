// الأحداث الصادرة (docs/05-integration.md الجزء السابع): compliance.updated · batch.blocked · license.expiring · product.approved.
// بتنحفظ بجدول OutboundEvent والأنظمة التانية بتسحبها من GET /api/s1/v1/events (بتوكن القراءة) وبتعيد قراءة القواعد قبل أي نشر.
import type { PrismaClient } from "@/generated/prisma/client";
import { OUTBOUND_EVENT_TYPES } from "@/adapters/contracts";

export type OutEventType = keyof typeof OUTBOUND_EVENT_TYPES;
export const isOutEventType = (v: unknown): v is OutEventType => typeof v === "string" && v in OUTBOUND_EVENT_TYPES;

export interface OutEvent {
  event_id: string;
  type: OutEventType;
  occurred_at: string;
  targets: string[];
  data: Record<string, unknown>;
}

export async function emitEvent(db: PrismaClient, type: OutEventType, data: Record<string, unknown>, now: Date = new Date()): Promise<OutEvent> {
  const targets = [...OUTBOUND_EVENT_TYPES[type]];
  const row = await db.outboundEvent.create({ data: { type, dataJson: data as never, targets: targets as never, createdAt: now } });
  return { event_id: row.id, type, occurred_at: row.createdAt.toISOString(), targets, data };
}

export async function listEvents(db: PrismaClient, q: { since?: string | null; type?: string | null; limit?: number } = {}): Promise<OutEvent[]> {
  const since = q.since ? new Date(q.since) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error("تاريخ since مش صحيح");
  if (q.type && !isOutEventType(q.type)) throw new Error("نوع الحدث غلط");
  const rows = await db.outboundEvent.findMany({
    where: { ...(since ? { createdAt: { gt: since } } : {}), ...(q.type ? { type: q.type } : {}) },
    orderBy: { createdAt: "asc" },
    take: Math.min(Math.max(q.limit ?? 100, 1), 500),
  });
  return rows.map((r) => ({ event_id: r.id, type: r.type as OutEventType, occurred_at: r.createdAt.toISOString(), targets: (r.targets as string[]) ?? [], data: (r.dataJson ?? {}) as Record<string, unknown> }));
}
