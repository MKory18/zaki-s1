import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { createLicense, listLicenses } from "@/compliance/quality";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

export const GET = guard("quality.view", async ({ req }) => Response.json({ items: await listLicenses(getDb(), { productRef: new URL(req.url).searchParams.get("productRef") }) }));

// ترخيص جديد لمنتج وبلد. التنبيه قبل الانتهاء حسب alertDays (الافتراضي 60 يوم).
export const POST = guard("quality.manage", async ({ req, audit }) => {
  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw badRequest("الطلب ناقص");
    const row = await createLicense(getDb(), body);
    audit("License", row.id, null, { productRef: row.productRef, country: row.country, status: row.status });
    return Response.json(row, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
