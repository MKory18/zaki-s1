import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listReports, generateReport } from "@/reports/service";
import type { ReportKind } from "@/reports/data";

export const dynamic = "force-dynamic";

const KINDS = ["morning", "weekly", "monthly"];

export const GET = guard("dashboard.view", async ({ req }) => {
  const kind = new URL(req.url).searchParams.get("kind");
  if (kind && !KINDS.includes(kind)) return apiError(400, "bad_request", "نوع التقرير غلط");
  return Response.json({ reports: await listReports(getDb(), (kind as ReportKind | null) ?? undefined) });
});

// توليد يدوي. الإرسال لتيليجرام اختياري ({ send: true }) والافتراضي لا.
export const POST = guard("settings.manage", async ({ req, audit }) => {
  const body = (await req.json().catch(() => null)) as { kind?: string; force?: boolean; send?: boolean } | null;
  if (!body?.kind || !KINDS.includes(body.kind)) return apiError(400, "bad_request", "نوع التقرير غلط");
  const r = await generateReport(getDb(), body.kind as ReportKind, { force: Boolean(body.force), send: Boolean(body.send) });
  audit("Report", r.id, null, { kind: r.kind, period: r.period, source: r.source, reused: r.reused });
  return Response.json(r);
});
