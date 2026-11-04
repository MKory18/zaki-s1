import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { deleteLibraryRow, listLibrary, updateLibraryRow } from "@/compliance/library";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// تعديل نص مرجعي (المالك). تعديل المحتوى بيلغي الاعتماد: لازم المراجع الشرعي يشوفه من جديد.
export const PATCH = guard<{ id: string }>("settings.manage", async ({ req, params, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const before = (await listLibrary(getDb(), "references")).find((r) => r.id === params.id) ?? null;
    const row = await updateLibraryRow(getDb(), "references", params.id, body);
    audit("ReferenceText", params.id, before, row);
    return Response.json(row);
  } catch (e) {
    return errorResponse(e);
  }
});

export const DELETE = guard<{ id: string }>("settings.manage", async ({ params, audit }) => {
  try {
    await deleteLibraryRow(getDb(), "references", params.id);
    audit("ReferenceText", params.id, { deleted: false }, { deleted: true });
    return Response.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
});
