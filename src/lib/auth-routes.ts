// مساعدات نقاط الدخول: كوكيات وتحويلات.
import { SESSION_COOKIE, SESSION_TTL_S, cookieHeader } from "@/lib/session";

export function isSecure(env = process.env): boolean {
  return (env.APP_URL ?? "").startsWith("https://");
}

export function redirect(to: string, status = 303, cookies: string[] = []): Response {
  const h = new Headers({ location: to });
  for (const c of cookies) h.append("set-cookie", c);
  return new Response(null, { status, headers: h });
}

export const OIDC_COOKIE = "s1_oidc";

export function sessionCookie(token: string) {
  return cookieHeader(SESSION_COOKIE, token, SESSION_TTL_S, isSecure());
}
export function clearCookie(name: string) {
  return cookieHeader(name, "", 0, isSecure());
}
export function oidcCookie(value: string) {
  return cookieHeader(OIDC_COOKIE, value, 600, isSecure());
}

// دخول المالك المحلي: لنسخة التطوير بس. بالإنتاج ممنوع دايماً، حتى لو انضبط المتغيّر.
export function devLoginAllowed(env = process.env): boolean {
  return env.NODE_ENV !== "production" && env.AUTH_DEV_OWNER === "1";
}
