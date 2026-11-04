import { ContractError, resend } from "@/adapters/outbox";
import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// زر «أعد الإرسال» لطلب ميت أو موقوف (بنفس المفتاح الفريد، فما في تكرار)
export const POST = guard<{ id: string }>("settings.manage", async ({ params, audit }) => {
  try {
    const row = await resend(getDb(), params.id);
    audit("OutboundRequest", params.id, null, { status: row.status, attempts: row.attempts });
    return Response.json({ request: row });
  } catch (e) {
    if (e instanceof ContractError) return apiError(400, "bad_request", e.message);
    throw e;
  }
});
