import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { updateBatch } from "@/compliance/quality";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// تعديل دفعة معلّقة (شهادة التحليل · الفحص المستقل · التعقيم · الفئة). المفروجة والموقوفة سجلها ثابت.
export const PATCH = guard<{ id: string }>("quality.manage", async ({ req, params, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await updateBatch(getDb(), params.id, body);
    audit("Batch", params.id, null, body);
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});
