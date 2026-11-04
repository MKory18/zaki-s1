import { apiError, guard } from "@/lib/api-guard";
import { can } from "@/core/permissions";
import { loadCoreConfig } from "@/core/config";
import { actualEconomics, EconomicsError, projectEconomics, type ActualInput, type EconomicsInput } from "@/core/economics";
import { saveActual, saveProjection } from "@/core/save";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// حاسبة الاقتصاد. الجسم: { mode: "projection"|"actual", market?, candidateId?, input }.
// الناقص من الإعدادات (سعر الصرف · هامش الأمان · المرتجع) بيتعبّى من افتراضيات السوق، وأجرة التوصيل لازم تتدخل إذا ما انعبّت.
export const POST = guard("dashboard.view", async ({ req, user, audit }) => {
  const body = (await req.json().catch(() => null)) as { mode?: string; market?: string; candidateId?: string; input?: Record<string, unknown> } | null;
  if (!body?.input || (body.mode !== "projection" && body.mode !== "actual")) return apiError(400, "bad_request", "الطلب ناقص (mode وinput)");
  if (body.candidateId && !can(user.role, "capture.create")) return apiError(403, "forbidden", "حفظ النتيجة على مرشح بيحتاج صلاحية الباحث");

  const db = getDb();
  const market = body.market ?? "SY";
  try {
    if (body.mode === "actual") {
      const a = actualEconomics(body.input as unknown as ActualInput);
      if (body.candidateId) {
        const row = await saveActual(db, body.candidateId, market, body.input, a);
        audit("EconomicsCalc", row.id, null, { kind: "actual", success: a.success });
      }
      return Response.json({ mode: "actual", result: a });
    }
    const cfg = await loadCoreConfig(db, market);
    const i = body.input as Partial<EconomicsInput>;
    const input: EconomicsInput = {
      ...(i as EconomicsInput),
      fxJodUsd: i.fxJodUsd ?? cfg.market.fxJodUsd,
      safetyMargin: i.safetyMargin ?? cfg.market.safetyMargin,
      returnRate: i.returnRate ?? cfg.market.defaultReturn ?? ("" as never),
      deliveryFee: i.deliveryFee ?? cfg.market.deliveryFee ?? ("" as never),
      returnFee: i.returnFee ?? cfg.market.returnFee ?? 0,
    };
    if (input.deliveryFee === "" || input.returnRate === "") return apiError(422, "missing_market_value", "لازم تدخل أجرة التوصيل ونسبة المرتجع (ما انعبّوا بإعدادات السوق)");
    const p = projectEconomics(input);
    if (body.candidateId) {
      const row = await saveProjection(db, body.candidateId, market, input, p);
      audit("EconomicsCalc", row.id, null, { kind: "projection", cpaCeiling: p.cpaCeiling });
    }
    return Response.json({ mode: "projection", rulesVersion: cfg.rulesVersion, usedInput: input, result: { ...p, rawLossLimit: undefined } });
  } catch (e) {
    if (e instanceof EconomicsError) return apiError(422, "bad_input", e.message);
    throw e;
  }
});
