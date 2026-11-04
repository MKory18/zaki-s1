import { apiError, guard } from "@/lib/api-guard";
import { getMode, baseUrlEnv, tokenEnv, validBaseUrl } from "@/adapters/config";
import { SYSTEMS, type SystemId } from "@/adapters/contracts";
import { getFinanceBudget, getMediaBuyerResults, getOmsPerformance, getProductionMetrics, IntegrationError } from "@/adapters/systems";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// اختبار اتصال: قراءة بس (ما بيكتب ولا بيرسل شي للنظام الحقيقي). الأنظمة اللي بنرسل لها بس: بنفحص الإعداد.
export const POST = guard<{ system: string }>("settings.manage", async ({ params, audit }) => {
  if (!SYSTEMS.includes(params.system as SystemId)) return apiError(404, "not_found", "نظام مجهول");
  const system = params.system as SystemId;
  const db = getDb();
  const mode = await getMode(db, system);
  try {
    if (mode === "real" && (!validBaseUrl(process.env[baseUrlEnv(system)]) || !process.env[tokenEnv(system)])) {
      throw new IntegrationError("العنوان أو التوكن مش مضبوط بـ .env (العنوان لازم https)", system, 0);
    }
    const day = new Date().toISOString().slice(0, 10);
    const month = day.slice(0, 7);
    if (system === "oms") await getOmsPerformance(db, { from: "2026-01-01", to: day }, {});
    else if (system === "production") await getProductionMetrics(db, "test", {});
    else if (system === "mediabuyer") await getMediaBuyerResults(db, "test", {});
    else if (system === "finance") await getFinanceBudget(db, month, {});
    audit("Integration", system, null, { mode, test: "ok" });
    const sendOnly = ["workspace", "tasks", "clipper", "crisis"].includes(system);
    return Response.json({ ok: true, mode, message: sendOnly ? "الإعداد سليم (هالنظام بنرسله بس، فما في قراءة نجرّبها)" : "الاتصال سليم والرد مطابق للعقد" });
  } catch (e) {
    if (e instanceof IntegrationError) return Response.json({ ok: false, mode, message: e.message, status: e.status });
    throw e;
  }
});
