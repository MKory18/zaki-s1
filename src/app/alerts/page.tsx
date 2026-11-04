import Link from "next/link";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { listBoard } from "@/lib/alerts-board";
import { AckButton } from "./ack-button";

export const dynamic = "force-dynamic";

const SEVERITY_AR = { info: "معلومة", warning: "تحذير", critical: "حرج" } as const;

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  const user = await requireUser("dashboard.view");
  const { state } = await searchParams;
  const all = state === "all";
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>التنبيهات</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const alerts = await listBoard(getDb(), all);
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>التنبيهات</h1>
      <p>
        <Link href="/alerts">المفتوحة</Link> · <Link href="/alerts?state=all">الكل</Link>
      </p>
      <table>
        <thead><tr><th>الوقت</th><th>الدرجة</th><th>التنبيه</th><th>وصل لـ</th><th></th></tr></thead>
        <tbody>
          {alerts.map((a) => (
            <tr key={a.id} data-severity={a.severity} data-acked={a.ackAt ? "1" : "0"}>
              <td dir="ltr">{a.at.slice(0, 16).replace("T", " ")}</td>
              <td>{SEVERITY_AR[a.severity]}</td>
              <td>{a.link ? <Link href={a.link}>{a.message}</Link> : a.message}</td>
              <td>{a.channels.includes("telegram") ? "اللوحة وتيليجرام" : "اللوحة"}</td>
              <td>{a.ackAt ? <span className="muted">شفتو</span> : can(user.role, "candidate.watch_reject") && <AckButton id={a.id} />}</td>
            </tr>
          ))}
          {alerts.length === 0 && <tr><td colSpan={5} className="muted">ما في تنبيهات.</td></tr>}
        </tbody>
      </table>
    </main>
  );
}
