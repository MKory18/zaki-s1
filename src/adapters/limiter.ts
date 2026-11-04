// حدود الطلبات (docs/05-integration.md): 5 طلبات بالثانية لكل نظام صادر، و20 للأحداث الواردة.
// الصادر: بنستنى (ما بنرفض). الوارد: بنرجّع 429 مع Retry-After.

export const OUTBOUND_PER_SEC = 5;
export const INBOUND_PER_SEC = 20;

const g = globalThis as unknown as { __s1Limits?: Map<string, number[]> };
const hits = (g.__s1Limits ??= new Map<string, number[]>());

// بيرجّع كم ميلي ثانية لازم تستنى لحد ما يصير مسموح (0 = مسموح هلأ) وبيسجّل الطلب إذا مسموح
export function takeSlot(key: string, perSec: number, nowMs = Date.now()): number {
  const arr = (hits.get(key) ?? []).filter((t) => nowMs - t < 1000);
  if (arr.length >= perSec) {
    hits.set(key, arr);
    return 1000 - (nowMs - arr[0]);
  }
  arr.push(nowMs);
  hits.set(key, arr);
  return 0;
}

export async function waitForSlot(key: string, perSec = OUTBOUND_PER_SEC, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))) {
  for (let i = 0; i < 20; i++) {
    const wait = takeSlot(key, perSec);
    if (wait <= 0) return;
    await sleep(Math.min(wait + 5, 1000));
  }
}

export function resetLimitsForTests() {
  hits.clear();
}
