import { apiError } from "@/lib/api-guard";
import { oidcCookie, redirect } from "@/lib/auth-routes";
import { buildAuthUrl, configFromEnv } from "@/lib/oidc";
import { getSecret, sign } from "@/lib/session";

export const dynamic = "force-dynamic";

// عام عن قصد: بداية الدخول
export async function GET() {
  const cfg = configFromEnv();
  if (!cfg) return apiError(503, "oidc_not_configured", "الدخول بالهوية المشتركة مش مضبوط بعد");
  try {
    const { url, state } = await buildAuthUrl(cfg);
    return redirect(url, 302, [oidcCookie(sign(state, getSecret()))]);
  } catch {
    return apiError(502, "oidc_unreachable", "تعذّر الوصول للهوية المشتركة");
  }
}
