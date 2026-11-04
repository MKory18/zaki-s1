// توقيع الأحداث (docs/05-integration.md الجزء الرابع، قسم 1):
// X-Zaki-Timestamp و X-Zaki-Signature. التوقيع = sha256 بمفتاح سري مشترك على (الوقت + "." + نص الطلب الخام).
import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_SKEW_S = 5 * 60;

export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "no_secret" | "missing_headers" | "bad_timestamp" | "stale" | "bad_signature" };

// الوقت بالثواني (epoch) أو ISO 8601. أقدم من 5 دقايق (أو بالمستقبل بأكتر من 5 دقايق) = رفض.
export function parseTimestamp(ts: string): number | null {
  if (/^\d{9,11}$/.test(ts)) return parseInt(ts, 10);
  const d = Date.parse(ts);
  return Number.isNaN(d) ? null : Math.floor(d / 1000);
}

export function verifySignature(opts: { secret: string | undefined; timestamp: string | null; signature: string | null; rawBody: string; nowS?: number }): VerifyResult {
  if (!opts.secret) return { ok: false, reason: "no_secret" };
  if (!opts.timestamp || !opts.signature) return { ok: false, reason: "missing_headers" };
  const t = parseTimestamp(opts.timestamp);
  if (t === null) return { ok: false, reason: "bad_timestamp" };
  const now = opts.nowS ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > MAX_SKEW_S) return { ok: false, reason: "stale" };
  const want = Buffer.from(signBody(opts.secret, opts.timestamp, opts.rawBody), "hex");
  let got: Buffer;
  try {
    got = Buffer.from(opts.signature.replace(/^sha256=/, ""), "hex");
  } catch {
    return { ok: false, reason: "bad_signature" };
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return { ok: false, reason: "bad_signature" };
  return { ok: true };
}
