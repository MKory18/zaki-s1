import { guard } from "@/lib/api-guard";
import { listAlerts } from "@/lib/alerts";
import { listUsage, summary } from "@/gateway/usage";

export const dynamic = "force-dynamic";

export const GET = guard("prompts.manage", () =>
  Response.json({ summary: summary(), entries: listUsage(100), alerts: listAlerts(20) }),
);
