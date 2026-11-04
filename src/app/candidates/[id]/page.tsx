import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { buildCard } from "@/pipeline/card";
import { latestCheck } from "@/compliance/service";
import { DecisionButtons } from "./decision-buttons";
import { ReviewCheck, RunCompliance } from "./compliance-panel";

export const dynamic = "force-dynamic";

const VERDICT_AR: Record<string, string> = { pass: "مقبول", pass_with_edits: "مقبول بتعديلات", needs_specialist: "يوقف لقرار مختص", fail: "مرفوض" };
const CLASS_AR: Record<string, string> = { cosmetic: "تجميلي", therapeutic: "علاجي", needs_review: "بين وبين" };
const CHECK_AR: Record<string, string> = { ok: "سليم", edit: "تعديل", specialist: "يوقف لمختص", fail: "مرفوض", na: "—" };

export default async function CardPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser("dashboard.view");
  const { id } = await params;
  if (!dbConfigured()) notFound();
  const db = getDb();
  const card = await buildCard(db, id);
  if (!card) notFound();
  const reasons = await db.rejectReason.findMany({ orderBy: { code: "asc" } });
  const comp = await latestCheck(db, id);
  const h = card.header;
  const v = card.numbers.velocity;
  const rule = card.decision.rule;
  const inv = card.decision.investigator;
  return (
    <main className="shell wide">
      <p><Link href="/candidates">← كل المرشحين</Link></p>
      <h1>{h.titleAr} {card.header.conflict && <strong className="error">تعارض</strong>}</h1>
      <p className="muted">{h.titleSrc !== h.titleAr ? `${h.titleSrc} — ` : ""}المشكلة: {h.problem ?? "غير مطابق"} · الحالة: <strong data-testid="status">{h.statusLabel}</strong> · المسار: {h.laneLabel} · المصادر: {h.sourcesCount}</p>

      <section>
        <h2>الأرقام (من الكود)</h2>
        <div data-testid="velocity"><strong>{v.insufficient ? "مؤشر السرعة: بيانات غير كافية" : `مؤشر السرعة: ${v.score}`}</strong> <details><summary>التفكيك والقاعدة</summary><span dir="auto">{v.rule}</span></details></div>
        <table>
          <thead><tr><th>الإشارة</th><th>القيمة</th><th>الدرجة</th><th>الوزن</th></tr></thead>
          <tbody>{v.signals.map((s) => <tr key={s.key}><td>{s.label}</td><td>{s.raw}</td><td>{s.score ?? "—"}</td><td>{s.measured ? s.weight : "—"}</td></tr>)}</tbody>
        </table>
        {v.warnings.map((w) => <p key={w} className="error">{w}</p>)}
        {card.numbers.rejectHits.map((r) => <p key={r.rule} className="error">قاعدة رفض: {r.message}</p>)}
        <p data-testid="dna">{card.numbers.dna ? <>درجة الحمض: <strong>{card.numbers.dna.score ?? "—"}</strong>{card.numbers.dna.closest ? ` — أقرب مرجع: ${card.numbers.dna.closest.name}` : ""}</> : "درجة الحمض: ما انعبّى ملف الحمض لسا (المحقق بيعبّيه)"}</p>
        <p data-testid="economics">{card.numbers.economics ? <>الاقتصاد (تقدير): سقف تكلفة الطلب {card.numbers.economics.cpaCeiling}$ · سقف التكبير {card.numbers.economics.scalingCeiling}$ — {card.numbers.economics.note}</> : "الاقتصاد: بيانات ناقصة (التكلفة المرجعية أو إعدادات السوق). استعمل الحاسبة."}</p>
      </section>

      <section>
        <h2>الامتثال والسوق</h2>
        <p data-testid="compliance">الامتثال: <strong data-testid="compliance-verdict">{VERDICT_AR[card.compliance.status] ?? "ما انفحص لسا"}</strong>{card.compliance.classification ? ` · ${CLASS_AR[card.compliance.classification] ?? card.compliance.classification}` : ""}{card.compliance.stage ? ` · فحص ${card.compliance.stage === "full" ? "كامل" : "مبدئي"}` : ""} — {card.compliance.note}</p>
        {comp && (
          <details>
            <summary>الفحوصات الثمانية</summary>
            <table data-testid="compliance-checks">
              <thead><tr><th>#</th><th>الفحص</th><th>النتيجة</th><th>التفاصيل</th></tr></thead>
              <tbody>{comp.result.checks.map((c) => <tr key={c.n} data-status={c.status}><td>{c.n}</td><td>{c.label}</td><td>{CHECK_AR[c.status]}</td><td>{c.detail}</td></tr>)}</tbody>
            </table>
            {comp.result.claims.some((c) => c.status !== "allowed") && (
              <ul data-testid="compliance-claims">{comp.result.claims.filter((c) => c.status !== "allowed").map((c) => <li key={c.text}>«{c.text}» — {c.status === "banned" ? "ممنوع" : "يحتاج تعديل"}{c.alternative ? ` — البديل المقترح: ${c.alternative}` : ""}</li>)}</ul>
            )}
            {!comp.result.agent.used && <p className="muted">{comp.result.agent.error ? `رأي الوكيل ما وصل: ${comp.result.agent.error}` : "بلا رأي الوكيل"}</p>}
          </details>
        )}
        {comp && !comp.humanVerdict && (comp.verdict === "needs_specialist" || comp.verdict === "pass_with_edits") && can(user.role, "claims.approve") && <ReviewCheck checkId={comp.id} />}
        {can(user.role, "claims.approve") && <RunCompliance id={h.id} />}
        <p>جاهزية السوق: {card.market.readiness.verdict === "ready" ? "جاهز" : card.market.readiness.verdict === "conditional" ? `جاهز بشروط — ${card.market.readiness.conditions.join(" · ")}` : `مش جاهز — ${card.market.readiness.reasons.join(" · ")}`}</p>
      </section>

      <section>
        <h2>المصادر (خط زمني)</h2>
        <table>
          <thead><tr><th>التاريخ</th><th>المصدر</th><th>الوصول</th><th>الثقة</th><th>الرابط</th></tr></thead>
          <tbody>{card.sources.map((s) => <tr key={s.id} data-source={s.source}><td dir="ltr">{s.capturedAt}</td><td>{s.source}</td><td>{s.access}</td><td>{s.trust}</td><td dir="ltr">{s.url ?? "—"}</td></tr>)}</tbody>
        </table>
      </section>

      <section>
        <h2>آراء الوكلاء <small className="muted">(تقدير، مش حقيقة)</small></h2>
        {Object.keys(card.opinions).length === 0 ? <p className="muted">ما في آراء لسا.</p> : Object.entries(card.opinions).map(([code, o]) => (
          <details key={code}><summary>{code} — تقدير</summary><pre dir="ltr">{JSON.stringify((o as { output: unknown }).output, null, 2)}</pre></details>
        ))}
      </section>

      <section>
        <h2>القرار</h2>
        <p data-testid="rule">القواعد: <strong>{rule.label}</strong> — {rule.reasons.join(" · ")}{rule.outsideBudgetShare ? ` (من حصة ${rule.outsideBudgetShare * 100}% خارج الحمض)` : ""}{rule.watchDays ? ` (${rule.watchDays} يوم)` : ""}</p>
        <p data-testid="investigator">رأي المحقق (تقدير): {inv ? `${inv.opinion} — ${inv.reason}` : "ما انحكم لسا"}</p>
        {rule.conflict && <p className="error" role="alert">تعارض بين القواعد ورأي المحقق: راجع البطاقة قبل ما تقرّر.</p>}
        {card.decision.ready ? (
          <DecisionButtons id={h.id} canDeep={can(user.role, "research.start")} canWatchReject={can(user.role, "candidate.watch_reject")} reasons={reasons.map((r) => ({ code: r.code, label: r.labelAr }))} />
        ) : <p className="muted">البطاقة مش جاهزة لقرارك بعد (لسا ما انتحقق منها).</p>}
        {card.decision.history.length > 0 && <ul>{card.decision.history.map((d) => <li key={d.at}>{d.action}{d.reasonCode ? ` (${d.reasonCode}${d.reasonText ? `: ${d.reasonText}` : ""})` : ""} — {d.actor} — <span dir="ltr">{d.at.slice(0, 16).replace("T", " ")}</span></li>)}</ul>}
      </section>

      <section>
        <h2>السجل</h2>
        {card.audit.length === 0 ? <p className="muted">ما في تغييرات مسجّلة.</p> : <ul>{card.audit.map((a, i) => <li key={i}>{a.action} — {a.actor} — <span dir="ltr">{a.at.slice(0, 16).replace("T", " ")}</span></li>)}</ul>}
      </section>
    </main>
  );
}
