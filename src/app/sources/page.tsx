import Link from "next/link";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { sourceStatuses } from "@/sources/run";
import { KeywordActions, RunNow } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_AR: Record<string, string> = { done: "تمّ", partial: "تمّ جزئياً", failed: "فشل", empty: "فاضي" };

export default async function SourcesPage() {
  const user = await requireUser("dashboard.view");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>المصادر</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const db = getDb();
  const sources = await sourceStatuses(db);
  const proposed = await db.keyword.findMany({ where: { status: "proposed" }, orderBy: { createdAt: "desc" }, take: 50 });
  const canRun = can(user.role, "capture.create");
  return (
    <main className="shell wide">
      <h1>المصادر</h1>
      <p className="muted">الواجهات الرسمية بشروطها، ولا سحب لصفحات بالخادم. الباقي بالاستيراد من ملف أو بالإضافة بسرعة إنسان. <Link href="/imports">الاستيراد من ملف</Link></p>
      <table>
        <thead><tr><th>المصدر</th><th>الطريقة</th><th>آخر تشغيل</th><th>الصفوف (تمّ · فشل)</th><th>التشغيلات</th><th></th></tr></thead>
        <tbody>
          {sources.map((s) => (
            <tr key={s.id} data-source={s.id} data-status={s.lastRun?.status ?? "none"}>
              <td>{s.label}</td>
              <td>{s.kind === "api" ? `واجهة رسمية (${s.mode === "real" ? "حقيقي" : "وهمي"})` : "ملف"}</td>
              <td>{s.lastRun ? <>{STATUS_AR[s.lastRun.status] ?? s.lastRun.status} — <span dir="ltr">{s.lastRun.at.slice(0, 16).replace("T", " ")}</span></> : "ما اشتغل لسا"}</td>
              <td>{s.lastRun ? `${s.lastRun.ok} · ${s.lastRun.failed}` : "—"}</td>
              <td>{s.runs}{s.failedRuns ? ` (${s.failedRuns} فاشل)` : ""}</td>
              <td>{s.kind === "api" && canRun && <RunNow id={s.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>كلمات مقترحة بانتظار اعتمادك</h2>
      {proposed.length === 0 ? <p className="muted">ما في كلمات مقترحة.</p> : (
        <table>
          <thead><tr><th>الكلمة</th><th>اللغة</th><th>المصدر</th><th></th></tr></thead>
          <tbody>
            {proposed.map((k) => (
              <tr key={k.id} data-keyword={k.text}>
                <td>{k.text}</td><td>{k.lang}</td><td dir="ltr">{k.source}</td>
                <td>{can(user.role, "settings.manage") && <KeywordActions id={k.id} />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
