import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { createBatch, listBatches } from "@/compliance/quality";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

export const GET = guard("quality.view", async ({ req }) => {
  const q = new URL(req.url).searchParams;
  return Response.json({ items: await listBatches(getDb(), { status: q.get("status"), productRef: q.get("productRef") }) });
});

// سجل دفعة جديدة (بتنزل «معلّقة» وما بتنفرج إلا بالبوابة)
export const POST = guard("quality.manage", async ({ req, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await createBatch(getDb(), body);
    audit("Batch", row.id, null, { productRef: row.productRef, batchNo: row.batchNo, qty: row.qty });
    return Response.json(row, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
