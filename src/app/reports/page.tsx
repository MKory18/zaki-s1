import Link from "next/link";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { listReports } from "@/reports/service";
import { GenerateButtons } from "./actions";

export const dynamic = "force-dynamic";

const KIND_AR = { morning: "صباحي", weekly: "أسبوعي", monthly: "شهري" } as const;

export default async function ReportsPage() {
  const user = await requireUser("dashboard.view");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>التقارير</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const reports = await listReports(getDb());
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>التقارير</h1>
      <p className="muted">التقرير الصباحي الساعة 9، الأسبوعي الأحد، الشهري أول الشهر. الأرقام من الكود، والكاتب بس بيصيغها. كل تقرير إله رابط ثابت بالأرشيف.</p>
      {can(user.role, "settings.manage") && <GenerateButtons />}
      <table>
        <thead><tr><th>النوع</th><th>الفترة</th><th>انكتب</th><th>انبعت لتيليجرام</th><th></th></tr></thead>
        <tbody>
          {reports.map((r) => (
            <tr key={r.id} data-kind={r.kind}>
              <td>{KIND_AR[r.kind]}</td>
              <td dir="ltr">{r.period}</td>
              <td dir="ltr">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
              <td>{r.sentAt ? "إي" : "لا"}</td>
              <td><Link href={`/reports/${r.id}`}>افتح</Link></td>
            </tr>
          ))}
          {reports.length === 0 && <tr><td colSpan={5} className="muted">ما في تقارير لسا.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
