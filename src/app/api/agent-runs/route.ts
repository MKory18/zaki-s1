import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listRuns } from "@/agents/service";

export const dynamic = "force-dynamic";

export const GET = guard("prompts.manage", async ({ req }) => {
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 50);
  return Response.json({ runs: await listRuns(getDb(), Number.isFinite(n) ? Math.min(Math.max(n, 1), 200) : 50) });
});
