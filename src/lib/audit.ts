// سجل التدقيق: مين · شو · على أي سجل · قبل وبعد · متى — لكل تعديل وقرار.
// التخزين بالذاكرة لحد مهمة B03 (جدول AuditLog بقاعدة البيانات). الواجهة نفسها ما بتتغيّر.
export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  action: string;
  entity: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
}

export type AuditInput = Omit<AuditEntry, "id" | "at">;

import { sinks } from "@/lib/hooks";

const SENSITIVE = /(token|secret|key|password|authorization|cookie)/i;
const MAX_ENTRIES = 10_000;

// الأسرار ما بتنكتب بالتدقيق أبداً
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || typeof value !== "object" || depth > 6) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE.test(k) ? "[محجوب]" : redact(v, depth + 1);
  }
  return out;
}

// على globalThis: نفس السجل لكل نقاط الـ API والصفحات (Next بيعمل نسخ منفصلة للوحدات)
const g = globalThis as unknown as { __s1Audit?: { store: AuditEntry[]; seq: number } };
const state = (g.__s1Audit ??= { store: [], seq: 0 });
const store = state.store;

export function hydrateAudit(entries: AuditEntry[]) {
  store.length = 0;
  store.push(...entries);
  state.seq = entries.length;
}

export function recordAudit(input: AuditInput, now: Date = new Date()): AuditEntry {
  const entry: AuditEntry = {
    ...input,
    id: ++state.seq,
    at: now.toISOString(),
    before: redact(input.before ?? null),
    after: redact(input.after ?? null),
  };
  store.push(entry);
  if (store.length > MAX_ENTRIES) store.shift();
  sinks.audit?.(entry);
  return entry;
}

export function listAudit(limit = 100): AuditEntry[] {
  return store.slice(-limit).reverse();
}

export function resetAuditForTests() {
  store.length = 0;
  state.seq = 0;
}
