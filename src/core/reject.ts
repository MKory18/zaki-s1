// قواعد الرفض الصارمة (docs/01-logic.md الجزء الرابع، قسم 6). الحدود من الإعدادات.
// قاعدة العمر لمسار الترند الصيني المبكر بس. المثبت إقليمياً ما بينرفض على العمر.
export type Lane = "china_early" | "regional_proven" | "manual";

export interface RejectConfig {
  maxCreators: number; // 400
  maxTrendAgeDays: number; // 45
  maxCumulativeSales: number; // 100000
}

export const DEFAULT_REJECT_CONFIG: RejectConfig = { maxCreators: 400, maxTrendAgeDays: 45, maxCumulativeSales: 100_000 };

export interface RejectInput {
  lane: Lane;
  creators?: number | null;
  trendAgeDays?: number | null;
  cumulativeSales?: number | null;
  /** من بوابة الامتثال */
  bannedIngredient?: boolean;
  forbiddenCategory?: boolean; // دواء بوصفة · مادة مراقبة
  /** المتوقع لكل شحنة قبل الإعلان (من الحاسبة) */
  expectedPerShipment?: number | null;
}

export interface RejectReasonHit {
  rule: "creators" | "trend_age" | "cumulative_sales" | "banned_ingredient" | "forbidden_category" | "economics";
  message: string;
}

const gt = (v: number | null | undefined, limit: number) => typeof v === "number" && Number.isFinite(v) && v > limit;

export function evaluateReject(i: RejectInput, cfg: RejectConfig = DEFAULT_REJECT_CONFIG): RejectReasonHit[] {
  const hits: RejectReasonHit[] = [];
  if (gt(i.creators, cfg.maxCreators)) hits.push({ rule: "creators", message: `الصنّاع ${i.creators} أكثر من ${cfg.maxCreators}: السوق تشبّع` });
  if (i.lane === "china_early" && gt(i.trendAgeDays, cfg.maxTrendAgeDays)) hits.push({ rule: "trend_age", message: `عمر الترند ${i.trendAgeDays} يوم فوق ${cfg.maxTrendAgeDays} (مسار الترند الصيني المبكر)` });
  if (gt(i.cumulativeSales, cfg.maxCumulativeSales)) hits.push({ rule: "cumulative_sales", message: `المبيعات التراكمية ${i.cumulativeSales} فوق ${cfg.maxCumulativeSales}` });
  if (i.bannedIngredient) hits.push({ rule: "banned_ingredient", message: "فيه مكوّن من قائمة المحظورات" });
  if (i.forbiddenCategory) hits.push({ rule: "forbidden_category", message: "فئة ممنوعة (دواء بوصفة أو مادة مراقبة)" });
  if (typeof i.expectedPerShipment === "number" && i.expectedPerShipment <= 0) hits.push({ rule: "economics", message: "المتوقع لكل شحنة قبل الإعلان صفر أو أقل: ما في مجال للربح" });
  return hits;
}
