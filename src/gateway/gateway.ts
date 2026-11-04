// بوابة الموديلات: كل استدعاء موديل بالنظام بيمرّ من هون (قاعدة CONVENTIONS).
// واجهة OpenAI المتوافقة، موديل أساسي وبديل، سقوف تكلفة، حجب بيانات الأشخاص عن الموديلات الخارجية، وسجل لكل استدعاء.
import { raiseAlert } from "@/lib/alerts";
import { getGatewayConfig } from "./config";
import { recordUsage, spentThisMonth, spentToday } from "./usage";
import { GatewayError, type CallResult, type ChatMessage, type GatewayConfig, type ModelRoute, type Provider } from "./types";

type Fetch = typeof fetch;

export interface CallOptions {
  agent: string;
  messages: ChatMessage[];
  config?: GatewayConfig;
  fetchImpl?: Fetch;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  now?: Date;
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE = /(?:\+|00)?\d(?:[\s-]?\d){8,}/;

// ولا بيانات أشخاص لأي موديل خارجي: إيميل أو رقم هاتف بالمحتوى = رفض
export function containsPersonalData(messages: ChatMessage[]): boolean {
  return messages.some((m) => EMAIL.test(m.content) || PHONE.test(m.content));
}

export function costMicro(model: ModelRoute, tokensIn: number, tokensOut: number): number {
  // وحدات لكل مليون توكن، مقرّبة لفوق لأقرب وحدة صحيحة: ما بنقلّل الكلفة أبداً
  return Math.ceil((tokensIn * model.priceInPerMTok + tokensOut * model.priceOutPerMTok) / 1_000_000);
}

async function callOne(
  provider: Provider,
  model: ModelRoute,
  opts: { temperature: number; maxTokens: number; messages: ChatMessage[] },
  f: Fetch,
  timeoutMs: number,
  env: Record<string, string | undefined>,
) {
  const key = env[provider.keyEnv];
  if (!provider.baseUrl || !key) throw new GatewayError("no_provider", `المزوّد ${provider.name} مش مضبوط (العنوان أو المفتاح)`);
  const res = await f(`${provider.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: model.model,
      messages: opts.messages,
      temperature: opts.temperature,
      max_tokens: opts.maxTokens,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content !== "string") throw new Error("رد بلا محتوى");
  return { content, tokensIn: data.usage?.prompt_tokens ?? 0, tokensOut: data.usage?.completion_tokens ?? 0 };
}

export async function callModel(o: CallOptions): Promise<CallResult> {
  const cfg = o.config ?? getGatewayConfig();
  const f = o.fetchImpl ?? fetch;
  const env = o.env ?? process.env;
  const now = o.now ?? new Date();
  const agent = cfg.agents.find((a) => a.agent === o.agent);
  if (!agent) throw new GatewayError("unknown_agent", `الوكيل ${o.agent} مش مسجّل بالبوابة`);

  const chain = [agent.primary, agent.fallback]
    .filter((id): id is string => Boolean(id))
    .map((id) => cfg.models.find((m) => m.id === id))
    .filter((m): m is ModelRoute => Boolean(m));
  if (chain.length === 0) throw new GatewayError("no_provider", "ما في موديل مضبوط للوكيل");

  const blocked = (result: "blocked_budget" | "blocked_pii", model: ModelRoute, error: string) =>
    recordUsage({ agent: o.agent, model: model.model, providerId: model.providerId, tokensIn: 0, tokensOut: 0, costMicro: 0, durationMs: 0, result, error, isFallback: false }, now);

  // السقوف: ميزانية الوكيل اليومية وعدد الاستدعاءات والسقف الشهري للكل. صفر = موقوف.
  const today = spentToday(o.agent, now);
  const overDaily = agent.dailyBudgetMicro <= 0 || today.costMicro >= agent.dailyBudgetMicro;
  const overCalls = agent.maxCallsPerDay !== undefined && today.calls >= agent.maxCallsPerDay;
  const overMonthly = cfg.monthlyBudgetMicro > 0 && spentThisMonth(now) >= cfg.monthlyBudgetMicro;
  if (overDaily || overCalls || overMonthly) {
    const why = overMonthly ? "السقف الشهري" : overCalls ? "سقف الاستدعاءات" : "الميزانية اليومية";
    blocked("blocked_budget", chain[0], why);
    raiseAlert({ type: "budget", severity: "warning", message: `توقف الوكيل ${o.agent}: وصل ${why}` }, now);
    throw new GatewayError("budget", `توقف الوكيل ${o.agent}: وصل ${why}`);
  }

  let lastError = "";
  let piiBlocked = 0;
  let attempted = 0;
  for (let i = 0; i < chain.length; i++) {
    const model = chain[i];
    const provider = cfg.providers.find((p) => p.id === model.providerId);
    const isFallback = i > 0;
    if (!provider || !provider.enabled) {
      lastError = `المزوّد ${model.providerId} موقوف`;
      recordUsage({ agent: o.agent, model: model.model, providerId: model.providerId, tokensIn: 0, tokensOut: 0, costMicro: 0, durationMs: 0, result: "error", error: lastError, isFallback }, now);
      continue;
    }
    if (!provider.internal && containsPersonalData(o.messages)) {
      // الخارجي ممنوع، بس البديل الداخلي (إن وجد) بيكمّل
      blocked("blocked_pii", model, "بيانات أشخاص (إيميل أو هاتف) بالمحتوى");
      piiBlocked += 1;
      continue;
    }
    attempted += 1;
    const t0 = Date.now();
    try {
      const r = await callOne(provider, model, { temperature: agent.temperature, maxTokens: agent.maxTokens, messages: o.messages }, f, o.timeoutMs ?? 60_000, env);
      const cost = costMicro(model, r.tokensIn, r.tokensOut);
      const durationMs = Date.now() - t0;
      recordUsage({ agent: o.agent, model: model.model, providerId: provider.id, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costMicro: cost, durationMs, result: "ok", isFallback }, now);
      if (isFallback) raiseAlert({ type: "model_fallback", severity: "info", message: `الوكيل ${o.agent}: رد البديل ${model.model} بعد فشل الأساسي` }, now);
      return { content: r.content, model: model.model, providerId: provider.id, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costMicro: cost, durationMs, usedFallback: isFallback };
    } catch (e) {
      const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
      lastError = e instanceof Error ? e.message : String(e);
      recordUsage({ agent: o.agent, model: model.model, providerId: provider.id, tokensIn: 0, tokensOut: 0, costMicro: 0, durationMs: Date.now() - t0, result: timedOut ? "timeout" : "error", error: lastError, isFallback }, now);
    }
  }
  if (piiBlocked > 0 && attempted === 0) {
    throw new GatewayError("pii", "المحتوى فيه بيانات أشخاص، ما بينبعت لموديل خارجي");
  }
  throw new GatewayError("failed", `فشل كل المزوّدين للوكيل ${o.agent}: ${lastError}`);
}
