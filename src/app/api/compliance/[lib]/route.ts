import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { createLibraryRow, isLib, listLibrary } from "@/compliance/library";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// مكتبات المكونات (ingredients) والادعاءات (claims) وقواعد الإعلانات (ad-rules). النصوص المرجعية بمسارها الخاص.
export const GET = guard<{ lib: string }>("dashboard.view", async ({ params }) => {
  if (!isLib(params.lib) || params.lib === "references") return apiError(404, "not_found", "المكتبة مش موجودة");
  return Response.json({ items: await listLibrary(getDb(), params.lib) });
});

export const POST = guard<{ lib: string }>("claims.approve", async ({ req, params, audit }) => {
  if (!isLib(params.lib) || params.lib === "references") return apiError(404, "not_found", "المكتبة مش موجودة");
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await createLibraryRow(getDb(), params.lib, body);
    audit(`Library:${params.lib}`, String(row.id), null, row);
    return Response.json(row, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
