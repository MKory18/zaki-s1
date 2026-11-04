import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { reviewCheck } from "@/compliance/service";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// قرار مراجع الامتثال على فحص: { verdict, note }. الرفض بالكود ما بينقلب (لازم تصحيح وإعادة فحص)، والنص غير المعتمد شرعياً بيمنع الاعتماد.
export const POST = guard<{ id: string }>("claims.approve", async ({ req, user, params, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as { verdict?: unknown; note?: unknown } | null;
    if (!body) throw badRequest("الطلب ناقص");
    const r = await reviewCheck(getDb(), params.id, user.sub, body);
    audit("ComplianceCheck", params.id, null, { humanVerdict: r.humanVerdict, note: r.humanNote });
    return Response.json(r);
  } catch (e) {
    return errorResponse(e);
  }
});
