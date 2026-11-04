import { configFromEnv } from "@/lib/oidc";
import { devLoginAllowed } from "@/lib/auth-routes";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  "1": "تعذّر تسجيل الدخول. جرّب مرة ثانية.",
  "2": "حسابك موقوف. كلّم المالك.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const oidc = configFromEnv() !== null;
  return (
    <main className="shell">
      <h1>سيستم 1</h1>
      <p>سجّل دخولك بالهوية المشتركة لأنظمة Zaki.</p>
      {error && ERRORS[error] && <p className="error" role="alert">{ERRORS[error]}</p>}
      {oidc ? (
        <a className="btn" href="/api/auth/login">دخول بالهوية المشتركة</a>
      ) : (
        <p className="muted">الدخول بالهوية المشتركة مش مضبوط بعد.</p>
      )}
      {devLoginAllowed() && (
        <form action="/api/auth/dev-login" method="post">
          <button type="submit">دخول المالك (تطوير)</button>
        </form>
      )}
    </main>
  );
}
