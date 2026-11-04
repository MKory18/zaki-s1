// التنبيهات. التخزين بالذاكرة لحد B03 (جدول Alert)، وإرسال تيليجرام بيجي مع B12.
import { sinks } from "@/lib/hooks";

export interface AlertEntry {
  id: number;
  at: string;
  type: string;
  severity: "info" | "warning" | "critical";
  message: string;
  link: string | null;
}

const g = globalThis as unknown as { __s1Alerts?: { list: AlertEntry[]; seq: number } };
const state = (g.__s1Alerts ??= { list: [], seq: 0 });

export function hydrateAlerts(entries: AlertEntry[]) {
  state.list.length = 0;
  state.list.push(...entries);
  state.seq = entries.length;
}

export function raiseAlert(a: Omit<AlertEntry, "id" | "at" | "link"> & { link?: string | null }, now: Date = new Date()): AlertEntry {
  const entry: AlertEntry = { id: ++state.seq, at: now.toISOString(), link: null, ...a };
  state.list.push(entry);
  if (state.list.length > 2000) state.list.shift();
  sinks.alert?.(entry);
  return entry;
}

export function listAlerts(limit = 100): AlertEntry[] {
  return state.list.slice(-limit).reverse();
}

export function resetAlertsForTests() {
  state.list.length = 0;
  state.seq = 0;
}
