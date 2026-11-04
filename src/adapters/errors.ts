// أخطاء الربط وقرار «شو بيعمل سيستم 1» لكل حالة (docs/05-integration.md الجزء الرابع، قسم 2 و3).

export type Disposition = "retry" | "stop" | "stop_alert" | "rate_limited";

// الفواصل: دقيقة · 5 دقايق · 30 دقيقة · ساعتين · 6 ساعات. وبعدها «ميت».
export const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000] as const;
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length + 1; // المحاولة الأولى + 5 إعادات

export interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: { field?: string; issue?: string }[] };
  request_id?: string;
}

// الحالة ← القرار. بس 429 و5xx وانقطاع الاتصال بيعيدوا المحاولة.
export function dispositionOf(status: number): Disposition {
  if (status === 429) return "rate_limited";
  if (status >= 500) return "retry";
  if (status === 401 || status === 403 || status === 409) return "stop_alert";
  return "stop"; // 400 · 404 · 422 وغيرها: خطأ بالطلب نفسه
}

export const NETWORK_FAILURE = 0; // انقطاع الاتصال أو مهلة

export function dispositionOfFailure(status: number): Disposition {
  return status === NETWORK_FAILURE ? "retry" : dispositionOf(status);
}

export function nextRetryAt(attemptsDone: number, now: Date, retryAfterS?: number): Date | null {
  if (attemptsDone >= MAX_ATTEMPTS) return null; // ميت
  const delay = retryAfterS !== undefined ? Math.max(retryAfterS * 1000, 1000) : RETRY_DELAYS_MS[attemptsDone - 1] ?? RETRY_DELAYS_MS.at(-1)!;
  return new Date(now.getTime() + delay);
}

// رسالة عربية للشاشة
export function messageAr(status: number, body: ApiErrorBody | null): string {
  const base = body?.error?.message;
  switch (status) {
    case NETWORK_FAILURE:
      return "ما انوصل للنظام (انقطاع اتصال أو مهلة)";
    case 401:
    case 403:
      return "التوكن بده مراجعة" + (base ? ` — ${base}` : "");
    case 409:
      return "نفس المفتاح الفريد بجسم مختلف" + (base ? ` — ${base}` : "");
    case 422:
      return base ?? "رفض النظام الطلب (قاعدة عمل)";
    case 429:
      return "النظام طلب نستنى (حد الطلبات)";
    default:
      return base ?? `رد النظام بخطأ ${status}`;
  }
}
