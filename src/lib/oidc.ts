// الدخول بالهوية المشتركة (OIDC، تدفق الرمز مع PKCE). الأسرار من .env على الخادم بس.
// الهوية بتجي من نقطة userinfo بتوكن وصول اجتمع مباشرة من نقطة التوكن (خادم لخادم عبر HTTPS).
import { createHash, randomBytes } from "node:crypto";

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OidcState {
  state: string;
  verifier: string;
}

type Fetch = typeof fetch;

export function configFromEnv(env = process.env): OidcConfig | null {
  const issuer = env.AUTH_OIDC_ISSUER ?? "";
  const clientId = env.AUTH_OIDC_CLIENT_ID ?? "";
  const clientSecret = env.AUTH_OIDC_CLIENT_SECRET ?? "";
  const appUrl = (env.APP_URL ?? "").replace(/\/$/, "");
  if (!issuer || !clientId || !clientSecret || !appUrl) return null;
  return { issuer: issuer.replace(/\/$/, ""), clientId, clientSecret, redirectUri: `${appUrl}/api/auth/callback` };
}

async function discover(cfg: OidcConfig, f: Fetch) {
  const r = await f(`${cfg.issuer}/.well-known/openid-configuration`);
  if (!r.ok) throw new Error("فشل جلب إعدادات الهوية المشتركة");
  const d = (await r.json()) as { authorization_endpoint: string; token_endpoint: string; userinfo_endpoint: string };
  if (!d.authorization_endpoint || !d.token_endpoint || !d.userinfo_endpoint) throw new Error("إعدادات الهوية ناقصة");
  return d;
}

export async function buildAuthUrl(cfg: OidcConfig, f: Fetch = fetch) {
  const d = await discover(cfg, f);
  const state = randomBytes(16).toString("base64url");
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const u = new URL(d.authorization_endpoint);
  u.search = new URLSearchParams({
    response_type: "code",
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    scope: "openid profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();
  return { url: u.toString(), state: { state, verifier } satisfies OidcState };
}

export async function exchangeCode(cfg: OidcConfig, saved: OidcState, params: { code: string; state: string }, f: Fetch = fetch) {
  if (!params.code || params.state !== saved.state) throw new Error("حالة الدخول مش مطابقة");
  const d = await discover(cfg, f);
  const tr = await f(d.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: params.code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      code_verifier: saved.verifier,
    }),
  });
  if (!tr.ok) throw new Error("رفضت الهوية المشتركة الرمز");
  const tok = (await tr.json()) as { access_token?: string };
  if (!tok.access_token) throw new Error("ما رجع توكن وصول");
  const ur = await f(d.userinfo_endpoint, { headers: { authorization: `Bearer ${tok.access_token}` } });
  if (!ur.ok) throw new Error("فشل جلب بيانات المستخدم");
  const info = (await ur.json()) as { sub?: string; name?: string; preferred_username?: string };
  if (!info.sub) throw new Error("بيانات المستخدم بلا رقم هوية");
  return { sub: info.sub, name: info.name || info.preferred_username || "مستخدم" };
}
