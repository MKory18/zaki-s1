// سجل الاستهلاك: لكل استدعاء الوكيل · الموديل · التوكنز · التكلفة · الزمن · النتيجة.
// بالذاكرة لحد B03 (جدول AgentRun). اليوم والشهر بتوقيت عمّان.
import type { UsageEntry } from "./types";

const g = globalThis as unknown as { __s1Usage?: { list: UsageEntry[]; seq: number } };
const state = (g.__s1Usage ??= { list: [], seq: 0 });

export function ammanDay(d: Date | string): string {
  return new Date(d).toLocaleDateString("sv-SE", { timeZone: "Asia/Amman" });
}

export function recordUsage(e: Omit<UsageEntry, "id" | "at">, now: Date = new Date()): UsageEntry {
  const entry: UsageEntry = { ...e, id: ++state.seq, at: now.toISOString() };
  state.list.push(entry);
  if (state.list.length > 20_000) state.list.shift();
  return entry;
}

export function listUsage(limit = 200): UsageEntry[] {
  return state.list.slice(-limit).reverse();
}

export function spentToday(agent: string, now: Date = new Date()): { costMicro: number; calls: number } {
  const day = ammanDay(now);
  let costMicro = 0;
  let calls = 0;
  for (const e of state.list) {
    if (e.agent === agent && e.result === "ok" && ammanDay(e.at) === day) {
      costMicro += e.costMicro;
      calls += 1;
    }
  }
  return { costMicro, calls };
}

export function spentThisMonth(now: Date = new Date()): number {
  const month = ammanDay(now).slice(0, 7);
  let total = 0;
  for (const e of state.list) {
    if (e.result === "ok" && ammanDay(e.at).slice(0, 7) === month) total += e.costMicro;
  }
  return total;
}

export function summary(now: Date = new Date()) {
  const day = ammanDay(now);
  const month = day.slice(0, 7);
  const byAgent = new Map<string, { calls: number; costMicro: number; tokens: number; errors: number }>();
  for (const e of state.list) {
    const inMonth = ammanDay(e.at).slice(0, 7) === month;
    if (!inMonth) continue;
    const row = byAgent.get(e.agent) ?? { calls: 0, costMicro: 0, tokens: 0, errors: 0 };
    if (e.result === "ok") {
      row.calls += 1;
      row.costMicro += e.costMicro;
      row.tokens += e.tokensIn + e.tokensOut;
    } else row.errors += 1;
    byAgent.set(e.agent, row);
  }
  return {
    day,
    month,
    monthCostMicro: spentThisMonth(now),
    byAgent: [...byAgent].map(([agent, v]) => ({ agent, ...v })),
  };
}

export function resetUsageForTests() {
  state.list.length = 0;
  state.seq = 0;
}
