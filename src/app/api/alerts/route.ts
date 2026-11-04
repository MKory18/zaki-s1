import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listBoard } from "@/lib/alerts-board";

export const dynamic = "force-dynamic";

// لوحة التنبيهات: ?state=open (الافتراضي) أو all
export const GET = guard("dashboard.view", async ({ req }) => {
  const all = new URL(req.url).searchParams.get("state") === "all";
  return Response.json({ alerts: await listBoard(getDb(), all) });
});
