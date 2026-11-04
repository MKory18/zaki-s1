// مؤشر سرعة الترند: الإشارات الثمانية وشرائحها وأوزانها (docs/01-logic.md الجزء الرابع، قسم 5).
// المؤشر = مجموع (درجة الإشارة × وزنها) ÷ مجموع أوزان الإشارات المقاسة − خصم المبيعات، ومحصور بين 0 و100.
// الإشارة الناقصة بتنشال وأوزان الباقي بتتوزّع. إذا الإشارات المقاسة أوزانها أقل من الحد: «بيانات غير كافية».
import { D } from "./num";

export const SIGNAL_KEYS = ["age", "creator_ramp", "intent", "engagement", "multi_seller", "yellow_cart", "whitespace"] as const;
export type SignalKey = (typeof SIGNAL_KEYS)[number];

export const SIGNAL_LABELS_AR: Record<SignalKey, string> = {
  age: "عمر الترند",
  creator_ramp: "تسارع الصنّاع",
  intent: "تعليقات نية الشراء",
  engagement: "حرارة التفاعل",
  multi_seller: "تعدد البائعين",
  yellow_cart: "السلة الصفراء",
  whitespace: "الفراغ بسوقك",
};

// شريحة: أول شريحة قيمتها ≥ حدّها (من الأعلى للأدنى) بتاخد درجتها. القيم الافتراضية من ملف المنطق، وبتنحفظ بالإعدادات.
export interface Band {
  min: number;
  score: number;
}
// للإشارات اللي كل ما قلّت أحسن (العمر، عدد المعلنين): أول شريحة قيمتها ≤ حدّها
export interface BandsConfig {
  age: { max: number; score: number }[];
  creator_ramp: Band[];
  intent: Band[]; // نسبة مئوية
  engagement: Band[]; // نسبة مئوية
  multi_seller: { max: number; score: number }[];
  yellow_cart: Band[]; // نسبة مئوية؛ أي قيمة فوق صفر أقل من الشريحة الأخيرة = 40
  whitespace: { max: number; score: number }[];
}

export const DEFAULT_BANDS: BandsConfig = {
  age: [{ max: 7, score: 100 }, { max: 14, score: 85 }, { max: 21, score: 70 }, { max: 30, score: 50 }, { max: 45, score: 25 }, { max: Infinity, score: 0 }],
  creator_ramp: [{ min: 3, score: 100 }, { min: 2, score: 80 }, { min: 1.5, score: 60 }, { min: 1, score: 40 }, { min: 0, score: 10 }],
  intent: [{ min: 15, score: 100 }, { min: 10, score: 80 }, { min: 5, score: 60 }, { min: 2, score: 30 }, { min: 0, score: 10 }],
  engagement: [{ min: 8, score: 100 }, { min: 5, score: 75 }, { min: 3, score: 50 }, { min: 1, score: 25 }, { min: 0, score: 10 }],
  multi_seller: [{ max: 1, score: 20 }, { max: 2, score: 40 }, { max: 5, score: 70 }, { max: 15, score: 100 }, { max: Infinity, score: 60 }],
  yellow_cart: [{ min: 50, score: 100 }, { min: 20, score: 70 }, { min: 0.0001, score: 40 }, { min: 0, score: 0 }],
  whitespace: [{ max: 0, score: 100 }, { max: 2, score: 70 }, { max: 5, score: 40 }, { max: 10, score: 20 }, { max: Infinity, score: 5 }],
};

export interface VelocityConfig {
  weights: Record<SignalKey, number>;
  bands: BandsConfig;
  minMeasuredWeight: number; // 50
  minCommentSample: number; // 50
  penalty50k100k: number; // 20
  penalty20k50k: number; // 10
}

export const DEFAULT_VELOCITY_CONFIG: VelocityConfig = {
  weights: { age: 15, creator_ramp: 15, intent: 20, engagement: 10, multi_seller: 10, yellow_cart: 10, whitespace: 20 },
  bands: DEFAULT_BANDS,
  minMeasuredWeight: 50,
  minCommentSample: 50,
  penalty50k100k: 20,
  penalty20k50k: 10,
};

export interface VelocityInput {
  trendAgeDays?: number | null;
  newCreators7d?: number | null;
  newCreatorsPrev7d?: number | null;
  intentComments?: number | null;
  commentSample?: number | null;
  engagementRate?: number | null; // نسبة (0.06 = 6%): وسيط أعلى 5 فيديوهات
  sellersCount?: number | null;
  yellowCartShare?: number | null; // نسبة (0.35)
  advertisersInMarket?: number | null; // معلنين بسوقك آخر 30 يوم
  cumulativeSales?: number | null;
}

export interface SignalResult {
  key: SignalKey;
  label: string;
  measured: boolean;
  raw: string; // القيمة المقاسة بشكل مقروء
  score: number | null;
  weight: number;
  reason?: string;
}

export interface VelocityResult {
  score: number | null; // null = بيانات غير كافية
  insufficient: boolean;
  signals: SignalResult[];
  penalty: number;
  measuredWeight: number;
  warnings: string[];
  rule: string;
}

const pick = (bands: Band[], v: number) => bands.find((b) => v >= b.min)?.score ?? 0;
const pickMax = (bands: { max: number; score: number }[], v: number) => bands.find((b) => v <= b.max)?.score ?? 0;
const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

export function computeVelocity(input: VelocityInput, cfg: VelocityConfig = DEFAULT_VELOCITY_CONFIG): VelocityResult {
  const sig: SignalResult[] = [];
  const add = (key: SignalKey, measured: boolean, raw: string, score: number | null, reason?: string) =>
    sig.push({ key, label: SIGNAL_LABELS_AR[key], measured, raw, score: measured ? score : null, weight: cfg.weights[key], reason });

  // عمر الترند
  if (num(input.trendAgeDays) && input.trendAgeDays >= 0) add("age", true, `${input.trendAgeDays} يوم`, pickMax(cfg.bands.age, input.trendAgeDays));
  else add("age", false, "غير مقاس", null);

  // تسارع الصنّاع: الجدد آخر 7 أيام ÷ الجدد بالـ 7 اللي قبلها
  if (num(input.newCreators7d) && num(input.newCreatorsPrev7d) && (input.newCreators7d > 0 || input.newCreatorsPrev7d > 0)) {
    const ratio = input.newCreatorsPrev7d === 0 ? Infinity : input.newCreators7d / input.newCreatorsPrev7d;
    add("creator_ramp", true, ratio === Infinity ? "∞ (ما في صنّاع قبلها)" : `${ratio.toFixed(2)} ضعف`, pick(cfg.bands.creator_ramp, ratio));
  } else add("creator_ramp", false, "غير مقاس", null);

  // نية الشراء: بشرط عيّنة 50 تعليق كحد أدنى
  if (num(input.intentComments) && num(input.commentSample)) {
    if (input.commentSample >= cfg.minCommentSample) {
      const p = (input.intentComments / input.commentSample) * 100;
      add("intent", true, `${p.toFixed(1)}% من ${input.commentSample} تعليق`, pick(cfg.bands.intent, p));
    } else add("intent", false, `عيّنة ${input.commentSample} أقل من ${cfg.minCommentSample}`, null, "العيّنة صغيرة");
  } else add("intent", false, "غير مقاس", null);

  // حرارة التفاعل
  if (num(input.engagementRate)) add("engagement", true, `${(input.engagementRate * 100).toFixed(1)}%`, pick(cfg.bands.engagement, input.engagementRate * 100));
  else add("engagement", false, "غير مقاس", null);

  // تعدد البائعين
  if (num(input.sellersCount) && input.sellersCount >= 1) add("multi_seller", true, `${input.sellersCount} بائع`, pickMax(cfg.bands.multi_seller, input.sellersCount));
  else add("multi_seller", false, "غير مقاس", null);

  // السلة الصفراء
  if (num(input.yellowCartShare)) add("yellow_cart", true, `${(input.yellowCartShare * 100).toFixed(0)}%`, pick(cfg.bands.yellow_cart, input.yellowCartShare * 100));
  else add("yellow_cart", false, "غير مقاس", null);

  // الفراغ بسوقك
  if (num(input.advertisersInMarket) && input.advertisersInMarket >= 0) add("whitespace", true, `${input.advertisersInMarket} معلن`, pickMax(cfg.bands.whitespace, input.advertisersInMarket));
  else add("whitespace", false, "غير مقاس", null);

  // خصم المبيعات التراكمية
  let penalty = 0;
  if (num(input.cumulativeSales)) {
    if (input.cumulativeSales >= 50_000) penalty = cfg.penalty50k100k;
    else if (input.cumulativeSales >= 20_000) penalty = cfg.penalty20k50k;
  }

  const measured = sig.filter((s) => s.measured);
  const measuredWeight = measured.reduce((a, s) => a + s.weight, 0);
  const warnings: string[] = [];
  if (!sig.find((s) => s.key === "whitespace")!.measured) warnings.push("الفراغ بسوقك مش مقاس: افحص مكتبة إعلانات سوقك");
  const small = sig.find((s) => s.key === "intent" && s.reason);
  if (small) warnings.push("عيّنة التعليقات أقل من الحد الأدنى: إشارة النية انشالت من الحساب");

  if (measuredWeight < cfg.minMeasuredWeight) {
    return { score: null, insufficient: true, signals: sig, penalty, measuredWeight, warnings: [...warnings, "بيانات غير كافية"], rule: `أوزان الإشارات المقاسة ${measuredWeight} أقل من ${cfg.minMeasuredWeight}: بيانات غير كافية` };
  }

  const weighted = measured.reduce((a, s) => a.plus(D(s.score!).times(s.weight)), D(0));
  const raw = weighted.div(measuredWeight).minus(penalty);
  const clamped = raw.lt(0) ? D(0) : raw.gt(100) ? D(100) : raw;
  const score = clamped.toDecimalPlaces(0).toNumber();
  return {
    score,
    insufficient: false,
    signals: sig,
    penalty,
    measuredWeight,
    warnings,
    rule: `${weighted.toString()} ÷ ${measuredWeight}${penalty ? ` − خصم المبيعات ${penalty}` : ""} = ${raw.toDecimalPlaces(2).toString()} ← ${score}`,
  };
}
