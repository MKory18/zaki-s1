// خدمة الوكلاء على القاعدة: تحميل الوكيل وبرومبته الفعّال، التشغيل، السجل، ومركز البرومبتات (نسخ · مقارنة · رجوع).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { ensureGatewayConfig } from "@/gateway/store";
import { getSetting } from "@/lib/settings";
import { AgentRunError, runAgentPrompt, type AgentDef, type PromptDef, type RunDeps, type RunRecord, type RunResult, type TierMap } from "./runner";
import type { Shape } from "./shape";

export const COMMON_CODE = "COMMON";

export interface PromptMeta {
  shape: Shape | null;
  example: unknown;
  textOutput: boolean;
  untrustedVars: string[];
  variables: string[];
}

const microOf = (usd: Prisma.Decimal | number | string) => Math.round(Number(usd) * 1_000_000);

export async function loadAgent(db: PrismaClient, code: string): Promise<{ agent: AgentDef; prompt: PromptDef; meta: PromptMeta; row: Awaited<ReturnType<typeof db.agent.findFirstOrThrow>> }> {
  const row = await db.agent.findFirst({ where: { code, deletedAt: null }, include: { prompt: true } });
  if (!row) throw new AgentRunError("disabled", `الوكيل ${code} مش موجود`);
  const version = row.prompt.activeVersionId ? await db.promptVersion.findUnique({ where: { id: row.prompt.activeVersionId } }) : null;
  if (!version) throw new AgentRunError("disabled", `ما في نسخة برومبت فعّالة للوكيل ${code}`);
  const common = await db.prompt.findUnique({ where: { code: COMMON_CODE } });
  const commonVersion = common?.activeVersionId ? await db.promptVersion.findUnique({ where: { id: common.activeVersionId } }) : null;
  const meta = version.outputSchemaJson as unknown as PromptMeta;
  return {
    row,
    meta,
    agent: {
      code,
      tier: row.modelRoute,
      fallbackTier: row.fallbackRoute,
      untrustedVars: meta.untrustedVars ?? [],
      textOutput: meta.textOutput,
      dailyBudgetMicro: microOf(row.dailyBudgetUsd),
      maxCallsPerDay: row.maxCallsPerDay,
      internal: row.modelRoute === "internal",
      enabled: row.enabled,
    },
    prompt: { versionId: version.id, body: version.body, shape: meta.shape, commonHeader: commonVersion?.body ?? "" },
  };
}

export async function getTiers(db: PrismaClient): Promise<TierMap> {
  const s = await getSetting(db, "agents.tiers");
  return ((s?.value as { items?: TierMap } | undefined)?.items ?? {}) as TierMap;
}

// السقف الشهري للكل من ميزانيات الوكلاء ("100$") إذا ما انضبط بالبوابة
async function monthlyMicro(db: PrismaClient): Promise<number> {
  const s = await getSetting(db, "agents.budgets");
  const items = ((s?.value as { items?: { agent: string; dailyRaw: string }[] } | undefined)?.items ?? []) as { agent: string; dailyRaw: string }[];
  const row = items.find((i) => i.agent.includes("السقف الشهري"));
  const n = row ? parseFloat(row.dailyRaw) : NaN;
  return Number.isFinite(n) ? Math.round(n * 1_000_000) : 0;
}

export function runRecorder(db: PrismaClient) {
  return async (r: RunRecord) => {
    await db.agentRun.create({
      data: {
        agentCode: r.agentCode,
        promptVersionId: r.promptVersionId,
        inputRef: r.inputRef,
        outputJson: (r.output ?? Prisma.JsonNull) as never,
        model: r.model || "-",
        tokensIn: r.tokensIn,
        tokensOut: r.tokensOut,
        costUsd: new Prisma.Decimal(r.costMicro).div(1_000_000),
        durationMs: r.durationMs,
        status: r.status,
        error: r.error,
      },
    });
  };
}

export async function runAgent(
  db: PrismaClient,
  code: string,
  vars: Record<string, unknown>,
  opts: { inputRef?: string; override?: Partial<RunDeps>; promptBody?: string } = {},
): Promise<RunResult> {
  const { agent, prompt } = await loadAgent(db, code);
  const gatewayConfig = await ensureGatewayConfig(db);
  const deps: RunDeps = {
    gatewayConfig: { ...gatewayConfig, monthlyBudgetMicro: gatewayConfig.monthlyBudgetMicro || (await monthlyMicro(db)) },
    tiers: await getTiers(db),
    recordRun: runRecorder(db),
    inputRef: opts.inputRef ?? null,
    ...opts.override,
  };
  return runAgentPrompt(agent, opts.promptBody ? { ...prompt, body: opts.promptBody, versionId: null } : prompt, vars, deps);
}

export async function listRuns(db: PrismaClient, limit = 50) {
  const rows = await db.agentRun.findMany({ orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id,
    at: r.createdAt.toISOString(),
    agentCode: r.agentCode,
    model: r.model,
    tokensIn: r.tokensIn,
    tokensOut: r.tokensOut,
    costUsd: r.costUsd.toString(),
    durationMs: r.durationMs,
    status: r.status,
    error: r.error,
    inputRef: r.inputRef,
  }));
}

// ───── مركز البرومبتات ─────

export class PromptError extends Error {
  constructor(public code: "not_found" | "bad_request", message: string) {
    super(message);
  }
}

export async function createVersion(db: PrismaClient, code: string, body: string, authorId: string, note?: string, metaOverride?: Partial<PromptMeta>) {
  if (!body.trim()) throw new PromptError("bad_request", "نص البرومبت فاضي");
  const prompt = await db.prompt.findFirst({ where: { code, deletedAt: null } });
  if (!prompt) throw new PromptError("not_found", "البرومبت مش موجود");
  const variables = [...new Set([...body.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]))].sort();
  // طلبين بنفس اللحظة بياخدوا نفس رقم النسخة: القيد الفريد بيمنع التكرار، والخاسر بيعيد على آخر رقم
  for (let attempt = 0; attempt < 4; attempt++) {
    const last = await db.promptVersion.findFirst({ where: { promptId: prompt.id }, orderBy: { version: "desc" } });
    const prevMeta = (last?.outputSchemaJson ?? {}) as unknown as PromptMeta;
    const meta: PromptMeta = { ...prevMeta, ...metaOverride, variables };
    try {
      const v = await db.promptVersion.create({
        data: { promptId: prompt.id, version: (last?.version ?? 0) + 1, body, outputSchemaJson: meta as never, authorId, note: note ?? null },
      });
      await db.prompt.update({ where: { id: prompt.id }, data: { activeVersionId: v.id } });
      return v;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") || attempt === 3) throw e;
    }
  }
  throw new Error("unreachable");
}

// «رجوع»: نسخة جديدة بنص النسخة القديمة (التاريخ ما بيتمسح)
export async function rollbackVersion(db: PrismaClient, code: string, version: number, authorId: string) {
  const prompt = await db.prompt.findFirst({ where: { code, deletedAt: null } });
  if (!prompt) throw new PromptError("not_found", "البرومبت مش موجود");
  const old = await db.promptVersion.findUnique({ where: { promptId_version: { promptId: prompt.id, version } } });
  if (!old) throw new PromptError("not_found", "النسخة مش موجودة");
  return createVersion(db, code, old.body, authorId, `رجوع لنسخة ${version}`, old.outputSchemaJson as unknown as PromptMeta);
}

export function lineDiff(a: string, b: string): { type: "same" | "del" | "add"; text: string }[] {
  const x = a.split("\n");
  const y = b.split("\n");
  const m = x.length;
  const n = y.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) lcs[i][j] = x[i] === y[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: { type: "same" | "del" | "add"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (x[i] === y[j]) out.push({ type: "same", text: x[i++] }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ type: "del", text: x[i++] });
    else out.push({ type: "add", text: y[j++] });
  }
  while (i < m) out.push({ type: "del", text: x[i++] });
  while (j < n) out.push({ type: "add", text: y[j++] });
  return out;
}
