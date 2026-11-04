import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { releaseBatch } from "@/compliance/quality";
import { errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// إفراج عن دفعة: بس لما كل شروط البوابة تنحقق (شهادة تحليل · فحص مستقل · تعقيم · معادن ثقيلة). غير هيك 409 بأسبابه.
export const POST = guard<{ id: string }>("quality.manage", async ({ params, user, audit }) => {
  try {
    const row = await releaseBatch(getDb(), params.id, user.sub);
    audit("Batch", params.id, { status: "pending" }, { status: row.status });
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});
