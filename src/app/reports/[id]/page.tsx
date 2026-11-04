import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { getReport } from "@/reports/service";

export const dynamic = "force-dynamic";

const KIND_AR = { morning: "التقرير الصباحي", weekly: "التقرير الأسبوعي", monthly: "التقرير الشهري" } as const;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser("dashboard.view");
  const { id } = await params;
  if (!dbConfigured()) notFound();
  const r = await getReport(getDb(), id);
  if (!r) notFound();
  const meta = r.data as { _source?: string; _fallbackReason?: string } | null;
  return (
    <main className="shell wide">
      <p><Link href="/reports">← كل التقارير</Link></p>
      <h1>{KIND_AR[r.kind]} — <span dir="ltr">{r.period}</span></h1>
      <p className="muted">
        الصياغة: {meta?._source === "agent" ? "كاتب التقارير" : "القالب الثابت"}
        {meta?._fallbackReason ? ` (${meta._fallbackReason})` : ""} · انبعت لتيليجرام: {r.sentAt ? "إي" : "لا"}
      </p>
      <pre data-testid="report-text" style={{ whiteSpace: "pre-wrap", fontFamily: "inherit" }}>{r.text}</pre>
    </main>
  );
}
