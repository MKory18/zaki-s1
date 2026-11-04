import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { DecisionError, decideCandidate } from "@/pipeline/decisions";

export const dynamic = "force-dynamic";

// قرار على البطاقة: ابدأ بحث معمّق · راقب · ارفض بسبب. الصلاحية حسب القرار (بحث معمّق للمالك والنائب بس).
// الجسم: { action: "deep_research" | "watch" | "reject", reasonCode?, reasonText? }
export const POST = guard<{ id: string }>("candidate.watch_reject", async ({ req, user, params }) => {
  const body = (await req.json().catch(() => null)) as { action?: string; reasonCode?: string; reasonText?: string } | null;
  if (!body?.action) return apiError(400, "bad_request", "الطلب ناقص");
  try {
    return Response.json(await decideCandidate(getDb(), params.id, user, { action: body.action, reasonCode: body.reasonCode, reasonText: body.reasonText }));
  } catch (e) {
    if (e instanceof DecisionError) return apiError({ not_found: 404, bad_request: 400, forbidden: 403, not_ready: 409 }[e.code], e.code, e.message);
    throw e;
  }
});
