import { clearCookie, redirect } from "@/lib/auth-routes";
import { SESSION_COOKIE } from "@/lib/session";

// عام عن قصد: خروج
export async function POST() {
  return redirect("/login", 303, [clearCookie(SESSION_COOKIE)]);
}
