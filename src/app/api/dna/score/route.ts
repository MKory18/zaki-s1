import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { DnaError, scoreTraits } from "@/lib/dna";

export const dynamic = "force-dynamic";

// درجة الحمض وأقرب مرجع لصفات مرشح. الجسم: { traits, sims? } (تشابه النص والصورة من التضمين إذا متوفر)
export const POST = guard("dashboard.view", async ({ req }) => {
  const body = (await req.json().catch(() => null)) as { traits?: Record<string, unknown>; sims?: Record<string, { textSim?: number | null; imageSim?: number | null }> } | null;
  if (!body?.traits) return apiError(400, "bad_request", "الصفات ناقصة");
  try {
    return Response.json(await scoreTraits(getDb(), body.traits, body.sims));
  } catch (e) {
    if (e instanceof DnaError) return apiError(400, e.code, e.message);
    throw e;
  }
});
