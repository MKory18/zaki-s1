// مشغّل البرومبت: تعبئة المتغيّرات ← تعليم المحتوى الخارجي ← الاستدعاء عبر البوابة ← فحص المخرج على الشكل ←
// محاولة تصحيح وحدة ← تسجيل التشغيل. الوكيل بيقترح بس. الفشل مكشوف بلا نتيجة مفبركة.
import { callModel } from "@/gateway/gateway";
import { GatewayError, type AgentRoute, type ChatMessage, type GatewayConfig } from "@/gateway/types";
import { MissingVarError, renderPrompt } from "./render";
import { parseJsonOutput, validateShape, type Shape } from "./shape";

export interface AgentDef {
  code: string;
  tier: string;
  fallbackTier: string | null;
  untrustedVars: readonly string[];
  textOutput: boolean;
  dailyBudgetMicro: number;
  maxCallsPerDay: number;
  internal: boolean;
  enabled: boolean;
}

export interface PromptDef {
  versionId: string | null;
  body: string;
  shape: Shape | null;
  commonHeader: string;
}

export type TierMap = Record<string, { primary: string | null; fallback?: string | null } | undefined>;

export type RunStatus = "ok" | "failed" | "invalid_output" | "blocked_budget" | "timeout";

export interface RunRecord {
  agentCode: string;
  promptVersionId: string | null;
  inputRef: string | null;
  output: unknown;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costMicro: number;
  durationMs: number;
  status: RunStatus;
  error: string | null;
}

export class AgentRunError extends Error {
  constructor(
    public code: "disabled" | "missing_var" | "no_tier" | "budget" | "pii" | "gateway" | "invalid_output",
    message: string,
    public run?: RunRecord,
  ) {
    super(message);
  }
}

export interface RunDeps {
  gatewayConfig: GatewayConfig;
  tiers: TierMap;
  recordRun: (r: RunRecord) => Promise<void> | void;
  call?: typeof callModel;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  now?: Date;
  inputRef?: string | null;
}

export interface RunResult {
  output: unknown; // JSON مفحوص، أو نص للوكلاء النصيين
  attempts: number;
  model: string;
  usedFallback: boolean;
  costMicro: number;
  tokensIn: number;
  tokensOut: number;
}

export const TEMPERATURE = 0.2;
export const MAX_TOKENS = 2500;

// بيبني إعداد البوابة لهالوكيل من درجته (الموديلات نفسها بتنحط من الإعدادات)
export function routeFor(agent: AgentDef, tiers: TierMap): AgentRoute {
  const t = tiers[agent.tier];
  if (!t?.primary) throw new AgentRunError("no_tier", `ما في موديل مضبوط لدرجة «${agent.tier}» (من الإعدادات: agents.tiers)`);
  const fallback = t.fallback ?? (agent.fallbackTier ? tiers[agent.fallbackTier]?.primary : null) ?? undefined;
  return {
    agent: agent.code,
    primary: t.primary,
    fallback: fallback || undefined,
    temperature: TEMPERATURE,
    maxTokens: MAX_TOKENS,
    dailyBudgetMicro: agent.dailyBudgetMicro,
    maxCallsPerDay: agent.maxCallsPerDay,
    unlimitedBudget: agent.internal,
  };
}

export async function runAgentPrompt(agent: AgentDef, prompt: PromptDef, vars: Record<string, unknown>, deps: RunDeps): Promise<RunResult> {
  const t0 = Date.now();
  const call = deps.call ?? callModel;
  const base = (over: Partial<RunRecord>): RunRecord => ({
    agentCode: agent.code,
    promptVersionId: prompt.versionId,
    inputRef: deps.inputRef ?? null,
    output: null,
    model: "",
    tokensIn: 0,
    tokensOut: 0,
    costMicro: 0,
    durationMs: Date.now() - t0,
    status: "failed",
    error: null,
    ...over,
  });
  const fail = async (code: AgentRunError["code"], message: string, over: Partial<RunRecord>): Promise<never> => {
    const run = base({ error: message, ...over });
    await deps.recordRun(run);
    throw new AgentRunError(code, message, run);
  };

  if (!agent.enabled) return fail("disabled", `الوكيل ${agent.code} موقوف`, {});

  let content: string;
  try {
    content = renderPrompt(prompt.body, vars, agent.untrustedVars);
  } catch (e) {
    if (e instanceof MissingVarError) return fail("missing_var", e.message, {});
    throw e;
  }

  const route = routeFor(agent, deps.tiers); // بيرمي no_tier قبل أي استدعاء
  const config: GatewayConfig = { ...deps.gatewayConfig, agents: [route] };
  const messages: ChatMessage[] = [
    { role: "system", content: prompt.commonHeader },
    { role: "user", content },
  ];

  let costMicro = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let model = "";
  let usedFallback = false;
  let lastErrors = "";

  for (let attempt = 1; attempt <= 2; attempt++) {
    let r;
    try {
      r = await call({ agent: agent.code, messages, config, fetchImpl: deps.fetchImpl, env: deps.env, now: deps.now });
    } catch (e) {
      if (e instanceof GatewayError) {
        const map = { budget: "budget", pii: "pii" } as const;
        const code = e.code === "budget" ? map.budget : e.code === "pii" ? map.pii : "gateway";
        return fail(code, e.message, {
          status: e.code === "budget" ? "blocked_budget" : e.message.includes("timeout") ? "timeout" : "failed",
          model,
          tokensIn,
          tokensOut,
          costMicro,
        });
      }
      throw e;
    }
    costMicro += r.costMicro;
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    model = r.model;
    usedFallback = usedFallback || r.usedFallback;

    if (agent.textOutput || !prompt.shape) {
      const run = base({ output: r.content, model, tokensIn, tokensOut, costMicro, status: "ok" });
      await deps.recordRun(run);
      return { output: r.content, attempts: attempt, model, usedFallback, costMicro, tokensIn, tokensOut };
    }

    const parsed = parseJsonOutput(r.content);
    const errors = parsed.ok ? validateShape(prompt.shape, parsed.value) : [parsed.error];
    if (errors.length === 0 && parsed.ok) {
      const run = base({ output: parsed.value, model, tokensIn, tokensOut, costMicro, status: "ok" });
      await deps.recordRun(run);
      return { output: parsed.value, attempts: attempt, model, usedFallback, costMicro, tokensIn, tokensOut };
    }
    lastErrors = errors.slice(0, 8).join(" · ");
    if (attempt === 1) {
      // محاولة تصحيح وحدة مع رسالة الخطأ
      messages.push({ role: "assistant", content: r.content });
      messages.push({ role: "user", content: `المخرج غلط: ${lastErrors}. رجّع JSON صحيح بالشكل المطلوب بالضبط، بلا أي نص قبله أو بعده.` });
    }
  }

  return fail("invalid_output", `مخرج غلط مرتين: ${lastErrors}`, { status: "invalid_output", model, tokensIn, tokensOut, costMicro });
}
