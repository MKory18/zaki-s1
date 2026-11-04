import { apiError, guard } from "@/lib/api-guard";
import { can } from "@/core/permissions";
import { loadCoreConfig } from "@/core/config";
import { evaluateReject, type RejectInput } from "@/core/reject";
import { saveVelocity } from "@/core/save";
import { computeVelocity, type VelocityInput } from "@/core/velocity";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// مؤشر السرعة + قواعد الرفض. الجسم: { input, lane?, candidateId?, market?, reject?: {...} }
export const POST = guard("dashboard.view", async ({ req, user, audit }) => {
  const body = (await req.json().catch(() => null)) as { input?: VelocityInput; lane?: RejectInput["lane"]; market?: string; candidateId?: string; reject?: Partial<RejectInput> } | null;
  if (!body?.input) return apiError(400, "bad_request", "الطلب ناقص (input)");
  if (body.candidateId && !can(user.role, "capture.create")) return apiError(403, "forbidden", "حفظ النتيجة على مرشح بيحتاج صلاحية الباحث");
  const db = getDb();
  const cfg = await loadCoreConfig(db, body.market ?? "SY");
  const velocity = computeVelocity(body.input, cfg.velocity);
  const rejectHits = evaluateReject(
    { lane: body.lane ?? "manual", creators: body.reject?.creators, trendAgeDays: body.input.trendAgeDays, cumulativeSales: body.input.cumulativeSales, ...body.reject },
    cfg.reject,
  );
  if (body.candidateId) {
    const snap = await saveVelocity(db, body.candidateId, velocity);
    audit("ScoreSnapshot", snap.id, null, { score: velocity.score, rulesVersion: cfg.rulesVersion });
  }
  return Response.json({ rulesVersion: cfg.rulesVersion, velocity, rejectHits });
});
