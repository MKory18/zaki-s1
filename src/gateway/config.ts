// إعدادات البوابة. الأسماء والتسعيرات والتوجيه بتجي من الإعدادات (B04 بتخزّنها)، والمفاتيح من .env بالاسم بس.
// لحد B04: إعدادات بالذاكرة بمزوّدين جاهزين (من أسماء متغيّرات .env) وبلا موديلات ولا وكلاء حتى ينضبطوا.
import type { GatewayConfig, Provider } from "./types";

export const DEFAULT_PROVIDERS: Provider[] = [
  { id: "glm", name: "GLM", baseUrl: "", keyEnv: "GLM_API_KEY", enabled: true, internal: false },
  { id: "kimi", name: "Kimi", baseUrl: "", keyEnv: "KIMI_API_KEY", enabled: true, internal: false },
  { id: "claude", name: "Claude", baseUrl: "", keyEnv: "CLAUDE_API_KEY", enabled: true, internal: false },
  { id: "gemini", name: "Gemini", baseUrl: "", keyEnv: "GEMINI_API_KEY", enabled: true, internal: false },
  { id: "internal", name: "الموديلات الداخلية", baseUrl: "", keyEnv: "INTERNAL_MODEL_KEY", enabled: true, internal: true },
];

// عنوان كل مزوّد بيجي من .env (الاسم بس بالكود)
const BASE_URL_ENV: Record<string, string> = {
  glm: "GLM_BASE_URL",
  kimi: "KIMI_BASE_URL",
  internal: "INTERNAL_MODEL_BASE_URL",
};

const g = globalThis as unknown as { __s1GatewayConfig?: GatewayConfig };

export function defaultConfig(env = process.env): GatewayConfig {
  return {
    providers: DEFAULT_PROVIDERS.map((p) => ({ ...p, baseUrl: env[BASE_URL_ENV[p.id] ?? ""] ?? p.baseUrl })),
    models: [],
    agents: [],
    monthlyBudgetMicro: 0,
  };
}

export function getGatewayConfig(): GatewayConfig {
  return (g.__s1GatewayConfig ??= defaultConfig());
}

export function setGatewayConfig(cfg: GatewayConfig) {
  g.__s1GatewayConfig = cfg;
}

export class ConfigError extends Error {}

// تحقق من إعدادات جاية من الشاشة: لازم المراجع تكون موجودة، والمفاتيح بالاسم بس (ما بنقبل قيمة سر).
export function validateConfig(cfg: unknown): GatewayConfig {
  const c = cfg as Partial<GatewayConfig> | null;
  if (!c || !Array.isArray(c.providers) || !Array.isArray(c.models) || !Array.isArray(c.agents)) {
    throw new ConfigError("الإعدادات ناقصة");
  }
  const monthly = Number(c.monthlyBudgetMicro ?? 0);
  if (!Number.isInteger(monthly) || monthly < 0) throw new ConfigError("السقف الشهري لازم يكون رقم صحيح");
  const pIds = new Set<string>();
  for (const p of c.providers) {
    if (!p || typeof p.id !== "string" || !p.id) throw new ConfigError("مزوّد بلا معرّف");
    if (!/^[A-Z][A-Z0-9_]*$/.test(p.keyEnv ?? "")) throw new ConfigError(`اسم متغيّر المفتاح غلط للمزوّد ${p.id}`);
    if (p.baseUrl && !/^https?:\/\//.test(p.baseUrl)) throw new ConfigError(`عنوان المزوّد ${p.id} لازم يبدأ بـ http أو https`);
    pIds.add(p.id);
  }
  const mIds = new Set<string>();
  for (const m of c.models) {
    if (!pIds.has(m.providerId)) throw new ConfigError(`الموديل ${m.id} مربوط بمزوّد مش موجود`);
    for (const k of ["priceInPerMTok", "priceOutPerMTok"] as const) {
      if (!Number.isInteger(m[k]) || m[k] < 0) throw new ConfigError(`تسعيرة ${m.id} لازم تكون رقم صحيح موجب`);
    }
    mIds.add(m.id);
  }
  for (const a of c.agents) {
    if (!mIds.has(a.primary)) throw new ConfigError(`الوكيل ${a.agent}: الموديل الأساسي مش موجود`);
    if (a.fallback && !mIds.has(a.fallback)) throw new ConfigError(`الوكيل ${a.agent}: الموديل البديل مش موجود`);
    if (!Number.isInteger(a.dailyBudgetMicro) || a.dailyBudgetMicro < 0) throw new ConfigError(`الوكيل ${a.agent}: الميزانية لازم تكون رقم صحيح`);
    if (!(a.temperature >= 0 && a.temperature <= 2) || !(a.maxTokens > 0)) throw new ConfigError(`الوكيل ${a.agent}: الحرارة أو الطول غلط`);
  }
  return c as GatewayConfig;
}
