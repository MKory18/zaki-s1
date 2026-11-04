import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { MergeError, splitCandidate } from "@/pipeline/merge";

export const dynamic = "force-dynamic";

// فك يدوي: ملاحظات مختارة بتطلع لمرشح جديد (الجسم: { observationIds })
export const POST = guard<{ id: string }>("capture.create", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { observationIds?: string[] } | null;
  if (!Array.isArray(body?.observationIds)) return apiError(400, "bad_request", "اختار الملاحظات");
  try {
    const r = await splitCandidate(getDb(), params.id, body!.observationIds, user.sub);
    audit("Candidate", params.id, null, { splitInto: r.newCandidateId, moved: r.moved });
    return Response.json(r);
  } catch (e) {
    if (e instanceof MergeError) return apiError(400, "split_error", e.message);
    throw e;
  }
});
