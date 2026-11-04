import { retryDue } from "@/adapters/outbox";
import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// تشغيل إعادة المحاولة هلأ (نفس مهمة outbound.retry اللي بتشتغل كل 5 دقايق)
export const POST = guard("settings.manage", async ({ audit }) => {
  const rows = await retryDue(getDb());
  audit("OutboundRequest", null, null, { retried: rows.length });
  return Response.json({ retried: rows.length, requests: rows });
});
