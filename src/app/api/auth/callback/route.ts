import { OIDC_COOKIE, clearCookie, redirect, sessionCookie } from "@/lib/auth-routes";
import { configFromEnv, exchangeCode, type OidcState } from "@/lib/oidc";
import { createSession, getSecret, parseCookies, verify } from "@/lib/session";
import { ensureUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// عام عن قصد: رجعة الهوية المشتركة
export async function GET(req: Request) {
  const cfg = configFromEnv();
  const url = new URL(req.url);
  const saved = verify<OidcState>(parseCookies(req.headers.get("cookie"))[OIDC_COOKIE], getSecret());
  if (!cfg || !saved) return redirect("/login?error=1", 302, [clearCookie(OIDC_COOKIE)]);
  try {
    const who = await exchangeCode(cfg, saved, {
      code: url.searchParams.get("code") ?? "",
      state: url.searchParams.get("state") ?? "",
    });
    const user = ensureUser(who.sub, who.name);
    if (!user.active) return redirect("/login?error=2", 302, [clearCookie(OIDC_COOKIE)]);
    return redirect("/", 302, [sessionCookie(createSession(who.sub, who.name, getSecret())), clearCookie(OIDC_COOKIE)]);
  } catch {
    return redirect("/login?error=1", 302, [clearCookie(OIDC_COOKIE)]);
  }
}
