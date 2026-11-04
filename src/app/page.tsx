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
        {can(user.role, "settings.manage") && <Link href="/settings">الإعدادات</Link>}
        {can(user.role, "settings.manage") && <Link href="/libraries">المكتبات</Link>}
        {can(user.role, "prompts.manage") && <Link href="/agents">الوكلاء</Link>}
        {can(user.role, "prompts.manage") && <Link href="/prompts">مركز البرومبتات</Link>}
        {can(user.role, "prompts.manage") && <Link href="/gateway">بوابة الموديلات</Link>}
        {can(user.role, "users.manage") && <Link href="/users">المستخدمين والأدوار</Link>}
        {can(user.role, "settings.manage") && <Link href="/integrations">الربط بالأنظمة</Link>}
        {can(user.role, "settings.manage") && <Link href="/admin/db">فحص القاعدة</Link>}
        <form action="/api/auth/logout" method="post">
          <button type="submit">خروج</button>
        </form>
      </nav>
    </main>
  );
}
