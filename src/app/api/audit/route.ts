import { guard } from "@/lib/api-guard";
import { listAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

export const GET = guard("audit.view", ({ req }) => {
  const n = Number(new URL(req.url).searchParams.get("limit") ?? 100);
  return Response.json({ entries: listAudit(Number.isFinite(n) ? Math.min(Math.max(n, 1), 500) : 100) });
});
