// بناء إعدادات الحسابات من الإعدادات المحفوظة (مفاتيحها المكتوبة بملف البذور). أي مفتاح ناقص بياخد القيمة الافتراضية.
// كل الحدود من الإعدادات، وكل نتيجة بتنحفظ مع نسخة القواعد.
import type { PrismaClient } from "@/generated/prisma/client";
import { listSettings } from "@/lib/settings";
import { DEFAULT_DECISION_CONFIG, type DecisionConfig } from "./decision";
import { DEFAULT_REJECT_CONFIG, type RejectConfig } from "./reject";
import { parseNumber, parsePercent, parseRange, rawOf } from "./settings-parse";
import { DEFAULT_BANDS, DEFAULT_VELOCITY_CONFIG, SIGNAL_KEYS, type BandsConfig, type VelocityConfig } from "./velocity";

// بتتغيّر لما تتغيّر المعادلات أو طريقة قراءة الإعدادات. بتنحفظ مع كل نتيجة.
export const RULES_VERSION = "2026-10-v1";

export interface MarketDefaults {
  code: string;
  fxJodUsd: number;
  deliveryFee: number | null;
  returnFee: number | null;
  defaultReturn: number | null;
  safetyMargin: number;
  minCpaCeiling: number | null;
}

export interface CoreConfig {
  rulesVersion: string;
  velocity: VelocityConfig;
  reject: RejectConfig;
  decision: DecisionConfig;
  market: MarketDefaults;
}

// الشرائح بتنحفظ بالإعدادات بصيغة JSON: الحد اللانهائي (Infinity) بيتخزّن null
export function serializeBands(b: BandsConfig): unknown {
  return JSON.parse(JSON.stringify(b, (_k, v) => (v === Infinity ? null : v)));
}
export function deserializeBands(raw: unknown): BandsConfig {
  const j = (raw ?? {}) as Record<string, { max?: number | null; min?: number; score: number }[]>;
  const fix = (arr: { max?: number | null; min?: number; score: number }[] | undefined, fallback: unknown) =>
    Array.isArray(arr) ? arr.map((x) => (x.max === null ? { ...x, max: Infinity } : x)) : fallback;
  return {
    age: fix(j.age, DEFAULT_BANDS.age),
    creator_ramp: fix(j.creator_ramp, DEFAULT_BANDS.creator_ramp),
    intent: fix(j.intent, DEFAULT_BANDS.intent),
    engagement: fix(j.engagement, DEFAULT_BANDS.engagement),
    multi_seller: fix(j.multi_seller, DEFAULT_BANDS.multi_seller),
    yellow_cart: fix(j.yellow_cart, DEFAULT_BANDS.yellow_cart),
    whitespace: fix(j.whitespace, DEFAULT_BANDS.whitespace),
  } as BandsConfig;
}

// يبني الإعدادات من خريطة (مفتاح ← قيمة الإعداد). منفصلة عن القاعدة عشان تنفحص بسهولة.
export function buildCoreConfig(values: Map<string, unknown>, marketCode = "SY"): CoreConfig {
  const raw = (k: string) => rawOf(values.get(k));
  const num = (k: string, d: number) => parseNumber(raw(k)) ?? d;
  const v = DEFAULT_VELOCITY_CONFIG;
  const weights = { ...v.weights };
  for (const k of SIGNAL_KEYS) weights[k] = num(`velocity.w.${k}`, weights[k]);

  const marketValues = ((values.get(`market.${marketCode}`) as { values?: Record<string, { raw?: string }> } | undefined)?.values ?? {}) as Record<string, { raw?: string }>;
  const mv = (k: string) => marketValues[k]?.raw;

  const d = DEFAULT_DECISION_CONFIG;
  const watchDays = parseNumber(raw("decision.watch.days"));
  const share = parsePercent(raw("decision.outside.budget_share"));
  const bands = values.get("velocity.bands") as { items?: unknown } | undefined;

  return {
    rulesVersion: RULES_VERSION,
    velocity: {
      weights,
      bands: bands?.items ? deserializeBands(bands.items) : DEFAULT_BANDS,
      minMeasuredWeight: num("velocity.min_measured_weight", v.minMeasuredWeight),
      minCommentSample: num("velocity.min_comment_sample", v.minCommentSample),
      penalty50k100k: num("velocity.penalty.50k_100k", v.penalty50k100k),
      penalty20k50k: num("velocity.penalty.20k_50k", v.penalty20k50k),
    },
    reject: {
      maxCreators: num("reject.max_creators", DEFAULT_REJECT_CONFIG.maxCreators),
      maxTrendAgeDays: num("reject.max_trend_age_days", DEFAULT_REJECT_CONFIG.maxTrendAgeDays),
      maxCumulativeSales: num("reject.max_cumulative_sales", DEFAULT_REJECT_CONFIG.maxCumulativeSales),
    },
    decision: {
      deepMinVelocity: num("decision.deep.min_velocity", d.deepMinVelocity),
      deepMinDna: num("decision.deep.min_dna", d.deepMinDna),
      outsideMinVelocity: num("decision.outside.min_velocity", d.outsideMinVelocity),
      watchVelocity: parseRange(raw("decision.watch.velocity")) ?? d.watchVelocity,
      watchDna: parseRange(raw("decision.watch.dna")) ?? d.watchDna,
      watchDays: watchDays ?? d.watchDays,
      outsideBudgetShare: share ?? d.outsideBudgetShare,
      minCpaCeiling: parseNumber(mv("market.min_cpa_ceiling")) ?? d.minCpaCeiling,
    },
    market: {
      code: marketCode,
      fxJodUsd: parseNumber(mv("fx.jod_usd")) ?? 1.41,
      deliveryFee: parseNumber(mv("market.delivery_fee")),
      returnFee: parseNumber(mv("market.return_fee")),
      defaultReturn: parsePercent(mv("market.default_return")),
      safetyMargin: parsePercent(mv("market.safety_margin")) ?? 0.3,
      minCpaCeiling: parseNumber(mv("market.min_cpa_ceiling")),
    },
  };
}

export async function loadCoreConfig(db: PrismaClient, marketCode = "SY"): Promise<CoreConfig> {
  const all = await listSettings(db);
  return buildCoreConfig(new Map(all.map((s) => [s.key, s.value])), marketCode);
}
