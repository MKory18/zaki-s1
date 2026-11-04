import { apiError, guard } from "@/lib/api-guard";
import { loadCoreConfig } from "@/core/config";
import { decide, DECISION_LABELS_AR, type DecisionInput } from "@/core/decision";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// القرار المقترح من القواعد (الكود بيقترح وإنت بتعتمد). الجسم: { market?, input: DecisionInput }
export const POST = guard("dashboard.view", async ({ req }) => {
  const body = (await req.json().catch(() => null)) as { market?: string; input?: DecisionInput } | null;
  if (!body?.input) return apiError(400, "bad_request", "الطلب ناقص (input)");
  const cfg = await loadCoreConfig(getDb(), body.market ?? "SY");
  const r = decide({ ...body.input, rejectHits: body.input.rejectHits ?? [] }, cfg.decision);
  return Response.json({ rulesVersion: cfg.rulesVersion, ...r, label: DECISION_LABELS_AR[r.decision] });
});
