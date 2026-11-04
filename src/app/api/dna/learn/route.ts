import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { runLearning } from "@/lib/dna";
import { makeExplainer } from "@/lib/dna-explain";
import { IntegrationError } from "@/adapters/systems";

export const dynamic = "force-dynamic";

// «تعلّم الآن» (نفس مهمة السبت 23:00): بتسحب أداء الـ OMS. الـ OMS واقف = بتضل آخر نسخة أوزان فعّالة.
export const POST = guard("settings.manage", async ({ audit }) => {
  try {
    const db = getDb();
    const r = await runLearning(db, { explain: makeExplainer(db) });
    audit("DnaWeightSet", String(r.version), null, { products: r.products, successes: r.successes });
    return Response.json(r);
  } catch (e) {
    if (e instanceof IntegrationError) return apiError(502, "oms_unavailable", `${e.message}. بتضل آخر نسخة أوزان فعّالة.`);
    throw e;
  }
});
