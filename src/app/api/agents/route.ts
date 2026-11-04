import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { spentToday } from "@/gateway/usage";

export const dynamic = "force-dynamic";

export const GET = guard("prompts.manage", async () => {
  const db = getDb();
  const agents = await db.agent.findMany({ where: { deletedAt: null }, include: { prompt: true }, orderBy: { code: "asc" } });
  const out = [];
  for (const a of agents) {
    const last = await db.agentRun.findFirst({ where: { agentCode: a.code }, orderBy: { createdAt: "desc" } });
    const v = a.prompt.activeVersionId ? await db.promptVersion.findUnique({ where: { id: a.prompt.activeVersionId }, select: { version: true } }) : null;
    out.push({
      code: a.code,
      nameAr: a.nameAr,
      team: a.team,
      tier: a.modelRoute,
      fallbackTier: a.fallbackRoute,
      tools: a.tools,
      dailyBudgetUsd: a.dailyBudgetUsd.toString(),
      maxCallsPerDay: a.maxCallsPerDay,
      schedule: a.schedule,
      enabled: a.enabled,
      promptVersion: v?.version ?? null,
      spentTodayMicro: spentToday(a.code).costMicro,
      lastRun: last ? { at: last.createdAt.toISOString(), status: last.status } : null,
    });
  }
  return Response.json({ agents: out });
});
