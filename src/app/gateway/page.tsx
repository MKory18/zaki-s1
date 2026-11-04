import { requireUser } from "@/lib/current-user";
import { getGatewayConfig } from "@/gateway/config";
import { formatUsd } from "@/gateway/format";
import { listUsage, summary } from "@/gateway/usage";
import { TestForm } from "./test-form";

export const dynamic = "force-dynamic";

export default async function GatewayPage() {
  await requireUser("prompts.manage");
  const cfg = getGatewayConfig();
  const s = summary();
  const usage = listUsage(20);
  return (
    <main className="shell">
      <h1>بوابة الموديلات</h1>

      <h2>المزوّدين</h2>
      <table>
        <thead><tr><th>الاسم</th><th>العنوان</th><th>المفتاح</th><th>الحالة</th></tr></thead>
        <tbody>
          {cfg.providers.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td dir="ltr">{p.baseUrl || "—"}</td>
              <td>{process.env[p.keyEnv] ? "مضبوط" : "ناقص"}</td>
              <td>{p.enabled ? "شغّال" : "موقوف"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>تجربة سؤال</h2>
      <TestForm agents={cfg.agents.map((a) => a.agent)} />

      <h2>الاستهلاك هالشهر</h2>
      <p>المجموع: {formatUsd(s.monthCostMicro)}{cfg.monthlyBudgetMicro > 0 && ` من ${formatUsd(cfg.monthlyBudgetMicro)}`}</p>
      <table>
        <thead><tr><th>الوكيل</th><th>استدعاءات</th><th>توكنز</th><th>التكلفة</th><th>أخطاء</th></tr></thead>
        <tbody>
          {s.byAgent.map((r) => (
            <tr key={r.agent}><td>{r.agent}</td><td>{r.calls}</td><td>{r.tokens}</td><td>{formatUsd(r.costMicro)}</td><td>{r.errors}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>آخر الاستدعاءات</h2>
      <table>
        <thead><tr><th>الوقت</th><th>الوكيل</th><th>الموديل</th><th>التكلفة</th><th>الزمن</th><th>النتيجة</th></tr></thead>
        <tbody>
          {usage.map((u) => (
            <tr key={u.id}>
              <td dir="ltr">{u.at.slice(11, 19)}</td><td>{u.agent}</td><td dir="ltr">{u.model}</td>
              <td>{formatUsd(u.costMicro)}</td><td>{u.durationMs} ms</td><td>{u.result}{u.error ? ` (${u.error})` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
