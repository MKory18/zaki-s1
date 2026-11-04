import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { DnaError, setReferenceState } from "@/lib/dna";

export const dynamic = "force-dynamic";

// اعتماد أو رفض مرجع (للمالك والنائب). الجسم: { action: "approve" | "reject" }
export const PATCH = guard<{ id: string }>("settings.manage", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "approve" && body?.action !== "reject") return apiError(400, "bad_request", "الإجراء لازم approve أو reject");
  try {
    const r = await setReferenceState(getDb(), params.id, body.action, user.sub);
    audit("DnaReference", params.id, null, { action: body.action, approvedBy: r.approvedBy });
    return Response.json({ ok: true, state: body.action === "approve" ? "approved" : "rejected" });
  } catch (e) {
    if (e instanceof DnaError) return apiError(e.code === "not_found" ? 404 : 400, e.code, e.message);
    throw e;
  }
});
