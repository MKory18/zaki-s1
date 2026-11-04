import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { assembleCards, runCompute, runDedupe, runNormalize, runScanner, runScreen, runVerifier } from "@/pipeline/stages";

export const dynamic = "force-dynamic";

const STAGES = { normalize: runNormalize, dedupe: runDedupe, compute: runCompute, scanner: runScanner, verifier: runVerifier, screen: runScreen, cards: assembleCards } as const;

// تشغيل مرحلة من خط التقييم هلأ (نفس مهام الجدول اليومي). الجسم: { stage }
export const POST = guard("settings.manage", async ({ req, audit }) => {
  const body = (await req.json().catch(() => null)) as { stage?: string } | null;
  const stage = body?.stage as keyof typeof STAGES | undefined;
  if (!stage || !(stage in STAGES)) return apiError(400, "bad_request", `المرحلة لازم وحدة من: ${Object.keys(STAGES).join(" · ")}`);
  const r = await STAGES[stage](getDb());
  audit("Pipeline", stage, null, { processed: r.processed, skipped: r.skipped });
  return Response.json(r);
});
