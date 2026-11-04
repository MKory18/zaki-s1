import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { reviewText } from "@/compliance/library";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// اعتماد نص مرجعي: المراجع الشرعي والمالك. { decision: "approve" | "reject" | "needs_specialist", note }
// الرفض والإيقاف بسبب إلزامي، واعتماد نص مختلف فيه بأساس القرار. ولا نص بيدخل محتوى قبل هالاعتماد.
export const POST = guard<{ id: string }>("texts.approve", async ({ req, user, params, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as { decision?: unknown; note?: unknown } | null;
    if (!body) throw badRequest("الطلب ناقص");
    const r = await reviewText(getDb(), params.id, user.sub, body);
    audit("ReferenceText", params.id, null, { decision: r.reviewStatus, note: r.reviewNote });
    return Response.json(r);
  } catch (e) {
    return errorResponse(e);
  }
});
