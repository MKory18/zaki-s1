import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { createLibraryRow, listLibrary } from "@/compliance/library";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

// مكتبة النصوص المرجعية. القراءة للمالك والمراجع الشرعي، والإضافة للمالك. النص الجديد بينزل «بانتظار المراجع» (والمختلف فيه «يوقف لقرار مختص»).
export const GET = guard("texts.view", async () => Response.json({ items: await listLibrary(getDb(), "references") }));

export const POST = guard("settings.manage", async ({ req, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await createLibraryRow(getDb(), "references", body);
    audit("ReferenceText", String(row.id), null, row);
    return Response.json(row, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
