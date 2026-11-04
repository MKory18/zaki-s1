import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { DnaError, setProfile } from "@/lib/dna";

export const dynamic = "force-dynamic";

// ملف حمض لمنتج مختبر (بيتعلّم منه الحمض) أو مرشح. الجسم: { ownerType, ownerId, traits }
export const POST = guard("capture.create", async ({ req, user, audit }) => {
  const body = (await req.json().catch(() => null)) as { ownerType?: string; ownerId?: string; traits?: Record<string, unknown> } | null;
  if (!body?.ownerId || !["product", "candidate", "reference"].includes(body.ownerType ?? "")) return apiError(400, "bad_request", "ownerType وownerId مطلوبين");
  try {
    const p = await setProfile(getDb(), body.ownerType as "product", body.ownerId, body.traits ?? {}, user.sub);
    audit("DnaProfile", p.id, null, { ownerType: body.ownerType, ownerId: body.ownerId });
    return Response.json({ id: p.id });
  } catch (e) {
    if (e instanceof DnaError) return apiError(400, e.code, e.message);
    throw e;
  }
});
