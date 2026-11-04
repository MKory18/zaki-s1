import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { MergeError, mergeCandidates } from "@/pipeline/merge";

export const dynamic = "force-dynamic";

// دمج يدوي: هالمرشح بينضم لمرشح تاني (الجسم: { intoId }). قابل للفك من «فك».
export const POST = guard<{ id: string }>("capture.create", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { intoId?: string } | null;
  if (!body?.intoId) return apiError(400, "bad_request", "حدّد المرشح اللي بينضم إله");
  try {
    const r = await mergeCandidates(getDb(), params.id, body.intoId, user.sub, "دمج يدوي");
    audit("Candidate", body.intoId, null, { mergedFrom: params.id, ...r });
    return Response.json(r);
  } catch (e) {
    if (e instanceof MergeError) return apiError(400, "merge_error", e.message);
    throw e;
  }
});
