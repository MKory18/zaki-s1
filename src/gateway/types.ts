// بوابة الموديلات: الأنواع. المبالغ بالدولار الصغير (micro-USD، رقم صحيح) عشان ما نستعمل أرقام عائمة للمال.
// 1 دولار = 1,000,000 وحدة. التسعيرة: وحدات لكل مليون توكن (يعني 0.15 دولار للمليون = 150,000).
export interface Provider {
  id: string;
  name: string;
  baseUrl: string; // واجهة متوافقة مع OpenAI، بدون /chat/completions
  keyEnv: string; // اسم متغيّر البيئة اللي فيه المفتاح (الاسم بس، مش القيمة)
  enabled: boolean;
  internal: boolean; // موديل داخلي على سيرفرك: مسموح له بيانات أكثر
}

export interface ModelRoute {
  id: string;
  providerId: string;
  model: string;
  priceInPerMTok: number;
  priceOutPerMTok: number;
}

export interface AgentRoute {
  agent: string;
  primary: string; // ModelRoute.id
  fallback?: string;
  temperature: number;
  maxTokens: number;
  dailyBudgetMicro: number; // صفر = موقوف
  maxCallsPerDay?: number;
}

export interface GatewayConfig {
  providers: Provider[];
  models: ModelRoute[];
  agents: AgentRoute[];
  monthlyBudgetMicro: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type UsageResult = "ok" | "error" | "timeout" | "blocked_budget" | "blocked_pii";

export interface UsageEntry {
  id: number;
  at: string;
  agent: string;
  model: string;
  providerId: string;
  tokensIn: number;
  tokensOut: number;
  costMicro: number;
  durationMs: number;
  result: UsageResult;
  error?: string;
  isFallback: boolean;
}

export interface CallResult {
  content: string;
  model: string;
  providerId: string;
  tokensIn: number;
  tokensOut: number;
  costMicro: number;
  durationMs: number;
  usedFallback: boolean;
}

export class GatewayError extends Error {
  constructor(public code: "unknown_agent" | "budget" | "pii" | "no_provider" | "failed", message: string) {
    super(message);
  }
}
