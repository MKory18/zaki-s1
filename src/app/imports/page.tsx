import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { SOURCE_PRESETS } from "@/sources/ingest";
import { TARGETS } from "@/sources/mapping";
import { ImportWizard } from "./wizard";

export const dynamic = "force-dynamic";

const STATUS_AR: Record<string, string> = { done: "تمّ", partial: "تمّ جزئياً", failed: "فشل", empty: "فاضي" };

export default async function ImportsPage() {
  await requireUser("capture.create");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>الاستيراد</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const jobs = await getDb().importJob.findMany({ orderBy: { createdAt: "desc" }, take: 15 });
  return (
    <main className="shell wide">
      <h1>الاستيراد</h1>
      <p className="muted">ارفع ملف (CSV أو Excel) ← اربط الأعمدة (بيتحفظ لكل مصدر) ← معاينة ← استيراد. ولا بيانات شخصية: الإيميلات والأرقام بتنشال من النصوص، والتعليقات بتنعدّ بس.</p>
      <ImportWizard
        presets={Object.entries(SOURCE_PRESETS).map(([id, p]) => ({ id, label: p.label }))}
        targets={TARGETS.map((t) => ({ id: t.id, label: t.label, required: "required" in t ? Boolean(t.required) : false }))}
      />
      <h2>آخر الاستيرادات</h2>
      <table>
        <thead><tr><th>الوقت</th><th>المصدر</th><th>الملف</th><th>الصفوف</th><th>تمّ</th><th>فشل</th><th>الحالة</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td dir="ltr">{j.createdAt.toISOString().slice(0, 16).replace("T", " ")}</td><td>{j.source}</td><td dir="ltr">{j.fileKey}</td>
              <td>{j.rows}</td><td>{j.ok}</td><td>{j.failed}</td><td>{STATUS_AR[j.status] ?? j.status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
