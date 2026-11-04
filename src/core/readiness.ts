// جاهزية السوق (docs/01-logic.md الجزء الرابع، قسم 8): ستة عوامل، والحكم جاهز · جاهز بشروط · مش جاهز.
// العوامل بتجي من الكود (الفراغ من المؤشر، التنظيم من الامتثال) ومن تفسير A10 (الباقي). الكود بيحكم والوكيل بيفسّر.
export type FactorStatus = "ok" | "warn" | "bad" | "unknown";

export const FACTOR_KEYS = ["ad_whitespace", "local_demand", "price_acceptance", "logistics", "regulation", "cultural_fit"] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export const FACTOR_LABELS_AR: Record<FactorKey, string> = {
  ad_whitespace: "الفراغ الإعلاني",
  local_demand: "الطلب المحلي",
  price_acceptance: "قبول السعر",
  logistics: "اللوجستيات",
  regulation: "التنظيم",
  cultural_fit: "الملاءمة الثقافية",
};

export interface Factor {
  key: FactorKey;
  status: FactorStatus;
  note?: string; // الشرط أو السبب
}

export type ReadinessVerdict = "ready" | "conditional" | "not_ready";

export interface Readiness {
  verdict: ReadinessVerdict;
  conditions: string[]; // «جاهز بشروط»: الشروط
  reasons: string[]; // «مش جاهز»: الأسباب
}

// وجود عامل «سيّئ» = مش جاهز. «تحذير» أو «مجهول» = جاهز بشروط. غير هيك جاهز.
export function assessReadiness(factors: Factor[]): Readiness {
  const label = (f: Factor) => `${FACTOR_LABELS_AR[f.key]}${f.note ? `: ${f.note}` : ""}`;
  const bad = factors.filter((f) => f.status === "bad");
  if (bad.length) return { verdict: "not_ready", conditions: [], reasons: bad.map(label) };
  const missing = FACTOR_KEYS.filter((k) => !factors.some((f) => f.key === k));
  const soft = [
    ...factors.filter((f) => f.status === "warn").map(label),
    ...factors.filter((f) => f.status === "unknown").map((f) => `${FACTOR_LABELS_AR[f.key]}: غير مقاس`),
    ...missing.map((k) => `${FACTOR_LABELS_AR[k]}: غير مقاس`),
  ];
  return soft.length ? { verdict: "conditional", conditions: soft, reasons: [] } : { verdict: "ready", conditions: [], reasons: [] };
}

// الفراغ الإعلاني من عدد المعلنين بسوقك (نفس شرائح مؤشر السرعة): صفر..2 تمام، 3..5 تحذير، فوق 5 سيّئ
export function whitespaceFactor(advertisers: number | null | undefined): Factor {
  if (typeof advertisers !== "number") return { key: "ad_whitespace", status: "unknown", note: "افحص مكتبة إعلانات سوقك" };
  if (advertisers <= 2) return { key: "ad_whitespace", status: "ok", note: `${advertisers} معلن` };
  if (advertisers <= 5) return { key: "ad_whitespace", status: "warn", note: `${advertisers} معلنين: منافسة متوسطة` };
  return { key: "ad_whitespace", status: "bad", note: `${advertisers} معلن: السوق مشبّع إعلانياً` };
}
