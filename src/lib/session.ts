// جلسة بكوكي موقّع (HMAC-SHA256) بسر AUTH_SECRET. الدور ما بينحفظ بالكوكي: بيتقرا من المستخدمين كل طلب.
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "s1_session";
export const SESSION_TTL_S = 60 * 60 * 12;

export interface SessionPayload {
  sub: string;
  name: string;
  exp: number; // ثواني
}

export function getSecret(): string {
  const s = process.env.AUTH_SECRET ?? "";
  if (s.length < 32) throw new Error("AUTH_SECRET لازم يكون 32 حرف على الأقل");
  return s;
}

const b64 = (b: Buffer) => b.toString("base64url");

export function sign(data: unknown, secret: string): string {
  const body = b64(Buffer.from(JSON.stringify(data), "utf8"));
  const mac = b64(createHmac("sha256", secret).update(body).digest());
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null, secret: string): T | null {
  if (!token) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  const want = createHmac("sha256", secret).update(body).digest();
  let got: Buffer;
  try {
    got = Buffer.from(mac, "base64url");
  } catch {
    return null;
  }
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

export function createSession(sub: string, name: string, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  return sign({ sub, name, exp: nowS + SESSION_TTL_S } satisfies SessionPayload, secret);
}

export function readSession(token: string | undefined | null, secret: string, nowS = Math.floor(Date.now() / 1000)) {
  const p = verify<SessionPayload>(token, secret);
  if (!p || typeof p.sub !== "string" || typeof p.exp !== "number" || p.exp <= nowS) return null;
  return p;
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(name: string, value: string, maxAgeS: number, secure: boolean): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeS}`,
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}
