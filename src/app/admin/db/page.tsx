import { requireUser } from "@/lib/current-user";
import { inspectDb } from "@/lib/db-inspect";

export const dynamic = "force-dynamic";

export default async function DbPage() {
  await requireUser("settings.manage");
  const r = await inspectDb();
  return (
    <main className="shell">
      <h1>فحص قاعدة البيانات</h1>
      {!r.connected ? (
        <p className="error" role="alert">القاعدة مش متصلة: {r.error}</p>
      ) : (
        <>
          <p>الاتصال: سليم. امتداد المتجهات (pgvector): {r.vectorExtension ? "شغّال" : "مش مفعّل"}. عدد الجداول: {r.tables.length}.</p>
          <table>
            <thead><tr><th>الجدول</th><th>عدد السجلات</th></tr></thead>
            <tbody>
              {r.tables.map((t) => (
                <tr key={t.name}><td dir="ltr">{t.name}</td><td>{t.rows}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  );
}
