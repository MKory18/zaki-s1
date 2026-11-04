import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { formatUsd } from "@/gateway/format";
import { spentToday } from "@/gateway/usage";
import { listRuns } from "@/agents/service";
import { AgentToggle } from "./agent-toggle";

export const dynamic = "force-dynamic";

const STATUS_AR: Record<string, string> = { ok: "تمّ", failed: "فشل", invalid_output: "مخرج غلط", blocked_budget: "موقوف بالسقف", timeout: "انتهت المهلة" };

export default async function AgentsPage() {
  await requireUser("prompts.manage");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>الوكلاء</h1>
        <p className="error" role="alert">القاعدة مش متصلة، فالوكلاء مش متاحين.</p>
      </main>
    );
  }
  const db = getDb();
  const agents = await db.agent.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });
  const runs = await listRuns(db, 30);
  return (
    <main className="shell wide">
      <h1>الوكلاء</h1>
      <p className="muted">الوكيل بيقترح بس، وإنت بتقرّر. تجاوز السقف بيوقف الوكيل وبيطلّع تنبيه. <Link href="/prompts">مركز البرومبتات</Link></p>
      <table>
        <thead><tr><th>الرمز</th><th>الوكيل</th><th>الفريق</th><th>الدرجة</th><th>السقف اليومي</th><th>صُرف اليوم</th><th>الاستدعاءات</th><th>الجدول</th><th>الحالة</th></tr></thead>
        <tbody>
          {agents.map((a) => (
            <tr key={a.id} data-agent={a.code}>
              <td dir="ltr">{a.code}</td>
              <td>{a.nameAr}</td>
              <td>{a.team}</td>
              <td>{a.modelRoute}</td>
              <td>{a.modelRoute === "internal" ? "داخلي" : `$${a.dailyBudgetUsd.toString()}`}</td>
              <td>{formatUsd(spentToday(a.code).costMicro)}</td>
              <td>{a.maxCallsPerDay >= 100000 ? "—" : a.maxCallsPerDay}</td>
              <td>{a.schedule}</td>
              <td><AgentToggle code={a.code} enabled={a.enabled} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>سجل التشغيل</h2>
      <table>
        <thead><tr><th>الوقت</th><th>الوكيل</th><th>الموديل</th><th>توكنز</th><th>التكلفة</th><th>الزمن</th><th>النتيجة</th></tr></thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id}>
              <td dir="ltr">{r.at.slice(0, 16).replace("T", " ")}</td>
              <td dir="ltr">{r.agentCode}</td>
              <td dir="ltr">{r.model}</td>
              <td>{r.tokensIn + r.tokensOut}</td>
              <td>${r.costUsd}</td>
              <td>{r.durationMs} ms</td>
              <td>{STATUS_AR[r.status] ?? r.status}{r.error ? ` — ${r.error}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
