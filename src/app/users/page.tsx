import { ROLES, ROLE_LABELS_AR } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { listUsers } from "@/lib/users";
import { UserRow } from "./user-row";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireUser("users.manage");
  const users = listUsers();
  return (
    <main className="shell">
      <h1>المستخدمين والأدوار</h1>
      <p className="muted">المستخدم الجديد بيدخل «مشاهد» لحد ما تغيّر دوره.</p>
      <table>
        <thead>
          <tr><th>الاسم</th><th>الدور</th><th>فعّال</th><th></th></tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <UserRow key={u.sub} user={u} roles={ROLES.map((r) => ({ value: r, label: ROLE_LABELS_AR[r] }))} />
          ))}
        </tbody>
      </table>
    </main>
  );
}
