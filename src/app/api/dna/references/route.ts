import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { DnaError, addManualReference, listReferences } from "@/lib/dna";

export const dynamic = "force-dynamic";

export const GET = guard("dashboard.view", async () => Response.json({ references: await listReferences(getDb()) }));

// مرجع يدوي: منتج رابح بصفاته. بيدخل «بانتظار الاعتماد» وبيصير مرجع بعد ما المالك يعتمده.
export const POST = guard("capture.create", async ({ req, audit }) => {
  const body = (await req.json().catch(() => null)) as { name?: string; traits?: Record<string, unknown>; productRef?: string } | null;
  if (!body) return apiError(400, "bad_request", "الطلب ناقص");
  try {
    const r = await addManualReference(getDb(), { name: body.name ?? "", traits: body.traits ?? {}, productRef: body.productRef });
    audit("DnaReference", r.id, null, { name: r.name, state: "pending" });
    return Response.json({ id: r.id, state: "pending" }, { status: 201 });
  } catch (e) {
    if (e instanceof DnaError) return apiError(400, e.code, e.message);
    throw e;
  }
});
