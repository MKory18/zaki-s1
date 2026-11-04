import { listOutbox } from "@/adapters/outbox";
import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = guard("settings.manage", async ({ req }) => {
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  return Response.json({ requests: await listOutbox(getDb(), Number.isFinite(n) ? Math.min(Math.max(n, 1), 300) : 100) });
});
