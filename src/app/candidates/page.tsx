import Link from "next/link";
import { STATUS_LABELS_AR, CANDIDATE_STATUSES } from "@/core/candidate-status";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { LANE_LABELS_AR } from "@/pipeline/card";
import { NewCandidate } from "./new-candidate";

export const dynamic = "force-dynamic";

export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ status?: string; lane?: string; q?: string }> }) {
  const user = await requireUser("dashboard.view");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>المرشحين</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const sp = await searchParams;
  const db = getDb();
  const where = {
    deletedAt: null,
    ...(sp.status && sp.status in STATUS_LABELS_AR ? { status: sp.status as never } : {}),
    ...(sp.lane && sp.lane in LANE_LABELS_AR ? { lane: sp.lane as never } : {}),
    ...(sp.q?.trim() ? { OR: [{ titleAr: { contains: sp.q.trim(), mode: "insensitive" as const } }, { titleSrc: { contains: sp.q.trim(), mode: "insensitive" as const } }] } : {}),
  };
  const rows = await db.candidate.findMany({ where, include: { problem: { select: { nameAr: true } } }, orderBy: [{ velocityScore: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }], take: 200 });
  const groups = await db.candidate.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
  const count = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  return (
    <main className="shell wide">
      <h1>المرشحين</h1>
      <form className="row tabs" method="get" aria-label="فلاتر">
        <select name="status" defaultValue={sp.status ?? ""} aria-label="الحالة">
          <option value="">كل الحالات</option>
          {CANDIDATE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS_AR[s]} ({count[s] ?? 0})</option>)}
        </select>
        <select name="lane" defaultValue={sp.lane ?? ""} aria-label="المسار">
          <option value="">كل المسارات</option>
          {Object.entries(LANE_LABELS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input type="search" name="q" defaultValue={sp.q ?? ""} placeholder="بحث بالاسم" aria-label="بحث" autoComplete="off" />
        <button type="submit">فلتر</button>
      </form>
      {can(user.role, "capture.create") && <NewCandidate />}
      <p className="muted">{rows.length} مرشح. القرار المقترح من القواعد، وإنت بتعتمد. «تعارض» = رأي المحقق عكس القواعد.</p>
      <table>
        <thead><tr><th>المرشح</th><th>المشكلة</th><th>المسار</th><th>الحالة</th><th>السرعة</th><th>الحمض</th><th>المقترح</th><th>المصادر</th></tr></thead>
        <tbody>
          {rows.map((c) => (
            <tr key={c.id} data-candidate={c.titleAr}>
              <td><Link href={`/candidates/${c.id}`}>{c.titleAr}</Link>{c.conflictFlag && <strong className="error"> تعارض</strong>}</td>
              <td>{c.problem?.nameAr ?? "—"}</td>
              <td>{LANE_LABELS_AR[c.lane]}</td>
              <td>{STATUS_LABELS_AR[c.status]}</td>
              <td>{c.velocityScore ?? "—"}</td>
              <td>{c.dnaScore ?? "—"}</td>
              <td>{c.decisionSuggested ?? "—"}</td>
              <td>{c.sourcesCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
