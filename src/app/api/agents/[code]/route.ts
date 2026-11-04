import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TIERS = ["internal", "cheapest", "cheap", "medium", "strong", "kimi"];

// تعديل وكيل: تفعيل/إيقاف، الميزانية، سقف الاستدعاءات، الدرجة. التعديل بالتدقيق.
export const PATCH = guard<{ code: string }>("prompts.manage", async ({ req, params, audit }) => {
  const body = (await req.json().catch(() => null)) as {
    enabled?: boolean; dailyBudgetUsd?: number; maxCallsPerDay?: number; modelRoute?: string; fallbackRoute?: string | null;
  } | null;
  if (!body) return apiError(400, "bad_request", "الطلب ناقص");
  const db = getDb();
  const cur = await db.agent.findFirst({ where: { code: params.code, deletedAt: null } });
  if (!cur) return apiError(404, "not_found", "الوكيل مش موجود");
  const data: Record<string, unknown> = {};
  if (typeof body.enabled === "boolean") data.enabled = body.enabled;
  if (body.dailyBudgetUsd !== undefined) {
    if (typeof body.dailyBudgetUsd !== "number" || !(body.dailyBudgetUsd >= 0) || body.dailyBudgetUsd > 1000) return apiError(400, "bad_budget", "الميزانية لازم تكون رقم بين 0 و1000");
    data.dailyBudgetUsd = body.dailyBudgetUsd;
  }
  if (body.maxCallsPerDay !== undefined) {
    if (!Number.isInteger(body.maxCallsPerDay) || body.maxCallsPerDay < 0) return apiError(400, "bad_calls", "سقف الاستدعاءات لازم يكون رقم صحيح");
    data.maxCallsPerDay = body.maxCallsPerDay;
  }
  if (body.modelRoute !== undefined) {
    if (!TIERS.includes(body.modelRoute)) return apiError(400, "bad_tier", "الدرجة مش صحيحة");
    data.modelRoute = body.modelRoute;
  }
  if (body.fallbackRoute !== undefined) {
    if (body.fallbackRoute !== null && !TIERS.includes(body.fallbackRoute)) return apiError(400, "bad_tier", "الدرجة البديلة مش صحيحة");
    data.fallbackRoute = body.fallbackRoute;
  }
  const updated = await db.agent.update({ where: { id: cur.id }, data });
  audit(
    "Agent", params.code,
    { enabled: cur.enabled, dailyBudgetUsd: cur.dailyBudgetUsd.toString(), maxCallsPerDay: cur.maxCallsPerDay, modelRoute: cur.modelRoute, fallbackRoute: cur.fallbackRoute },
    { enabled: updated.enabled, dailyBudgetUsd: updated.dailyBudgetUsd.toString(), maxCallsPerDay: updated.maxCallsPerDay, modelRoute: updated.modelRoute, fallbackRoute: updated.fallbackRoute },
  );
  return Response.json({ ok: true });
});
