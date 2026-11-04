// المستخدمين والأدوار. التخزين بالذاكرة لحد مهمة B03 (جدول User).
// أي مستخدم جديد بيدخل بدور «مشاهد» (أقل صلاحية). المالك بيتحدد برقم الهوية OWNER_OIDC_SUB من .env.
import { isRole, type Role } from "@/core/permissions";
import { recordAudit } from "@/lib/audit";
import { sinks } from "@/lib/hooks";

export interface UserRecord {
  sub: string;
  name: string;
  role: Role;
  active: boolean;
}

export class UserError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const g = globalThis as unknown as { __s1Users?: Map<string, UserRecord> };
const users = (g.__s1Users ??= new Map<string, UserRecord>());

export function hydrateUsers(list: UserRecord[]) {
  users.clear();
  for (const u of list) users.set(u.sub, u);
}

export function ensureUser(sub: string, name: string, ownerSub = process.env.OWNER_OIDC_SUB ?? ""): UserRecord {
  const existing = users.get(sub);
  if (existing) return existing;
  const u: UserRecord = { sub, name, role: ownerSub && sub === ownerSub ? "owner" : "viewer", active: true };
  users.set(sub, u);
  sinks.user?.(u);
  recordAudit({ actorId: "system", action: "user.create", entity: "User", entityId: sub, before: null, after: { name, role: u.role } });
  return u;
}

export function getUser(sub: string): UserRecord | undefined {
  return users.get(sub);
}

export function listUsers(): UserRecord[] {
  return [...users.values()].sort((a, b) => a.name.localeCompare(b.name, "ar"));
}

function activeOwners() {
  return [...users.values()].filter((u) => u.active && u.role === "owner");
}

// بيرجع القيم القديمة عشان المستدعي يسجّل التدقيق (قبل وبعد) عبر الحارس.
export function setRole(sub: string, role: unknown, active?: boolean): { user: UserRecord; before: { role: Role; active: boolean } } {
  const u = users.get(sub);
  if (!u) throw new UserError("not_found", "المستخدم مش موجود");
  if (!isRole(role)) throw new UserError("bad_role", "الدور مش صحيح");
  const nextActive = active ?? u.active;
  const losesOwner = u.role === "owner" && (role !== "owner" || !nextActive);
  if (losesOwner && activeOwners().length <= 1) {
    throw new UserError("last_owner", "ما بينفع تشيل آخر مالك");
  }
  const before = { role: u.role, active: u.active };
  u.role = role;
  u.active = nextActive;
  sinks.user?.(u);
  return { user: u, before };
}

export function resetUsersForTests() {
  users.clear();
}
