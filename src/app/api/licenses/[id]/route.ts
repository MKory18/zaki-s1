import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { deleteLicense, updateLicense } from "@/compliance/quality";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

export const PATCH = guard<{ id: string }>("quality.manage", async ({ req, params, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await updateLicense(getDb(), params.id, body);
    audit("License", params.id, null, body);
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});

export const DELETE = guard<{ id: string }>("quality.manage", async ({ params, audit }) => {
  try {
    await deleteLicense(getDb(), params.id);
    audit("License", params.id, { deleted: false }, { deleted: true });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
