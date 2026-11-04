import { apiError } from "@/lib/api-guard";
import { devLoginAllowed, redirect, sessionCookie } from "@/lib/auth-routes";
import { createSession, getSecret } from "@/lib/session";
import { ensureUser } from "@/lib/users";

export const dynamic = "force-dynamic";

// عام عن قصد (ومقفول بالإنتاج): دخول مالك محلي لنسخة التطوير بس. بالإنتاج بيرفض دايماً، حتى لو انضبط المتغيّر.
export async function POST() {
  if (!devLoginAllowed()) return apiError(404, "not_found", "مش متاح");
  const u = ensureUser("dev-owner", "مالك التطوير", "dev-owner");
  return redirect("/", 303, [sessionCookie(createSession(u.sub, u.name, getSecret()))]);
}
