import Link from "next/link";
import { ROLE_LABELS_AR, can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  return (
    <main className="shell">
      <h1>سيستم 1</h1>
      <p>أهلاً {user.name}. دورك: {ROLE_LABELS_AR[user.role]}.</p>
      <p className="muted">الهيكل جاهز. الميزات بتنضاف مهمة مهمة حسب خطة البناء.</p>
      <nav className="row">
        {can(user.role, "users.manage") && <Link href="/users">المستخدمين والأدوار</Link>}
        <form action="/api/auth/logout" method="post">
          <button type="submit">خروج</button>
        </form>
      </nav>
    </main>
  );
}
