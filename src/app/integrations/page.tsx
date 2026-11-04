import { baseUrlEnv, getModes, tokenEnv, validBaseUrl } from "@/adapters/config";
import { INBOUND_EVENT_TYPES, SYSTEMS, SYSTEM_LABELS_AR, type InboundSystem } from "@/adapters/contracts";
import { secretEnv } from "@/adapters/inbound";
import { listOutbox, outboxCounts } from "@/adapters/outbox";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { Actions, SystemTest } from "./actions";

export const dynamic = "force-dynamic";

const STATUS_AR: Record<string, string> = { pending: "بالانتظار", ok: "تمّ", failed: "موقوف", dead: "ميت" };

export default async function IntegrationsPage() {
  await requireUser("settings.manage");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>الربط بالأنظمة</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const db = getDb();
  const modes = await getModes(db);
  const counts = await outboxCounts(db);
  const outbox = await listOutbox(db, 50);
  return (
    <main className="shell wide">
      <h1>الربط بالأنظمة</h1>
      <p className="muted">كل نظام وهمي (نفس العقد) لحد ما يجهز، وبتبدّله لحقيقي من الإعدادات (تبويب «الربط»). العناوين والتوكنات بملف .env على الخادم.</p>
      <table>
        <thead><tr><th>النظام</th><th>الوضع</th><th>العنوان</th><th>التوكن</th><th>سر الأحداث</th><th>الطلبات (بالانتظار · تمّ · موقوف · ميت)</th><th></th></tr></thead>
        <tbody>
          {SYSTEMS.map((s) => {
            const c = counts[s] ?? { pending: 0, ok: 0, failed: 0, dead: 0 };
            return (
              <tr key={s} data-system={s}>
                <td>{SYSTEM_LABELS_AR[s]}</td>
                <td>{modes[s] === "real" ? "حقيقي" : "وهمي"}</td>
                <td>{validBaseUrl(process.env[baseUrlEnv(s)]) ? "مضبوط" : "ناقص"}</td>
                <td>{process.env[tokenEnv(s)] ? "مضبوط" : "ناقص"}</td>
                <td>{s in INBOUND_EVENT_TYPES ? (process.env[secretEnv(s as InboundSystem)] ? "مضبوط" : "ناقص") : "—"}</td>
                <td>{c.pending} · {c.ok} · {c.failed} · {c.dead}</td>
                <td><SystemTest system={s} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>الطلبات الصادرة</h2>
      <Actions />
      <table>
        <thead><tr><th>الوقت</th><th>النظام</th><th>المسار</th><th>المفتاح الفريد</th><th>المحاولات</th><th>الحالة</th><th>التفاصيل</th><th></th></tr></thead>
        <tbody>
          {outbox.map((r) => (
            <tr key={r.id} data-status={r.status}>
              <td dir="ltr">{r.createdAt.slice(0, 16).replace("T", " ")}</td>
              <td>{SYSTEM_LABELS_AR[r.system as keyof typeof SYSTEM_LABELS_AR] ?? r.system}</td>
              <td dir="ltr">{r.endpoint}</td>
              <td dir="ltr">{r.idempotencyKey}</td>
              <td>{r.attempts}</td>
              <td>{STATUS_AR[r.status]}{r.nextRetryAt ? ` (الجاي ${r.nextRetryAt.slice(11, 16)})` : ""}</td>
              <td>{(r.responseJson as { error?: string } | null)?.error ?? ""}</td>
              <td>{(r.status === "dead" || r.status === "failed") && <Actions resendId={r.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
