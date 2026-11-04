// المستخدم الحالي للصفحات (خادم). الصفحات الحساسة بتفحص الصلاحية هون كمان، مش بس بنقاط الـ API.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { can } from "@/core/permissions";
import { SESSION_COOKIE, getSecret, readSession } from "@/lib/session";
import { getUser, type UserRecord } from "@/lib/users";

export async function getCurrentUser(): Promise<UserRecord | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const s = readSession(token, getSecret());
  if (!s) return null;
  const u = getUser(s.sub);
  return u && u.active ? u : null;
}

export async function requireUser(action?: string): Promise<UserRecord> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (action && !can(u.role, action)) redirect("/");
  return u;
}
