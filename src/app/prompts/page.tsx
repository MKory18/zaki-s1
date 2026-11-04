import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function PromptsPage() {
  await requireUser("prompts.manage");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>مركز البرومبتات</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const prompts = await getDb().prompt.findMany({ where: { deletedAt: null }, include: { versions: { select: { id: true, version: true } } }, orderBy: { code: "asc" } });
  return (
    <main className="shell">
      <h1>مركز البرومبتات</h1>
      <p className="muted">كل برومبت بنسخ: تعديل = نسخة جديدة، وبتقدر تقارن وتجرّب وترجع.</p>
      <table>
        <thead><tr><th>الرمز</th><th>الاسم</th><th>النسخة الفعّالة</th><th>عدد النسخ</th></tr></thead>
        <tbody>
          {prompts.map((p) => (
            <tr key={p.id}>
              <td dir="ltr"><Link href={`/prompts/${p.code}`}>{p.code}</Link></td>
              <td>{p.nameAr}</td>
              <td>{p.versions.find((v) => v.id === p.activeVersionId)?.version ?? "—"}</td>
              <td>{p.versions.length}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
