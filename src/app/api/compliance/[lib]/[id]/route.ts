import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { deleteLibraryRow, isLib, listLibrary, updateLibraryRow } from "@/compliance/library";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// تعديل/حذف سجل مكتبة. قواعد الإعلانات: { reviewed: true } بيسجّل «راجعتها اليوم».
export const PATCH = guard<{ lib: string; id: string }>("claims.approve", async ({ req, params, audit }) => {
  if (!isLib(params.lib) || params.lib === "references") return apiError(404, "not_found", "المكتبة مش موجودة");
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const before = (await listLibrary(getDb(), params.lib)).find((r) => r.id === params.id) ?? null;
    const row = await updateLibraryRow(getDb(), params.lib, params.id, body);
    audit(`Library:${params.lib}`, params.id, before, row);
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});

export const DELETE = guard<{ lib: string; id: string }>("claims.approve", async ({ params, audit }) => {
  if (!isLib(params.lib) || params.lib === "references") return apiError(404, "not_found", "المكتبة مش موجودة");
  try {
    const before = (await listLibrary(getDb(), params.lib)).find((r) => r.id === params.id) ?? null;
    await deleteLibraryRow(getDb(), params.lib, params.id);
    audit(`Library:${params.lib}`, params.id, before, null);
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
