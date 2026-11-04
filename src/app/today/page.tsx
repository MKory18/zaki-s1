import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { buildMorning } from "@/reports/data";

export const dynamic = "force-dynamic";

// S01 «اليوم»: نفس أرقام التقرير الصباحي بس حيّة. القرارات بتتاخد من بطاقة المرشح.
export default async function TodayPage() {
  await requireUser("dashboard.view");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>اليوم</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const d = await buildMorning(getDb());
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>اليوم — {d.dateLabel}</h1>
      <section>
        <h2>جاهز لقرارك</h2>
        {d.items.length === 0 && <p className="muted">ما في مرشحين جاهزين لقرارك اليوم.</p>}
        <ol>
          {d.items.map((it) => (
            <li key={it.id} data-testid="today-item">
              <Link href={`/candidates/${it.id}`}>{it.title}</Link>{it.problem ? ` — ${it.problem}` : ""}{it.conflict && <strong className="error"> تعارض</strong>}
              <br />
              <span className="muted">سرعة {it.velocity ?? "—"} · حمض {it.dna ?? "—"} · سقف الطلب {it.cpaCeiling ? `${it.cpaCeiling}$` : "—"} · المقترح: {it.decision}</span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <h2>الجديد آخر 24 ساعة</h2>
        <p>{d.newTotal > 0 ? `${d.newTotal} ملاحظة (${d.newBySource.map((s) => `${s.label} ${s.count}`).join(" · ")})` : "ما إجا شي جديد."}</p>
      </section>
      <section>
        <h2>التنبيهات المفتوحة</h2>
        {d.alerts.length === 0 ? <p className="muted">ما في.</p> : <ul>{d.alerts.map((a, i) => <li key={i}>{a}</li>)}</ul>}
        <p><Link href="/alerts">كل التنبيهات</Link></p>
      </section>
      {d.marketChange && <p>أهم تغيير بالسوق: {d.marketChange}</p>}
      {d.notes.length > 0 && <p className="muted">ناقص: {d.notes.join(" · ")}</p>}
      <p><Link href="/reports">التقارير</Link></p>
    </main>
  );
}
