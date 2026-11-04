import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { blockBatch } from "@/compliance/quality";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// إيقاف دفعة بسبب: بيطلق حدث batch.blocked (الـ OMS بيوقف بيعها) وتنبيه حرج.
export const POST = guard<{ id: string }>("quality.manage", async ({ req, params, user, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as { reason?: unknown } | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await blockBatch(getDb(), params.id, user.sub, body);
    audit("Batch", params.id, null, { status: row.status, reason: row.blockReason });
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});
