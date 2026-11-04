// بوابة الإفراج عن الدفعة (docs/01-logic.md الجزء الخامس): دفعة بلا شهادة ما بتنفرج · كحل بلا تحليل معادن ثقيلة ما بينفرج ·
// الفحص المستقل إلزامي لأول دفعة من أي مورّد ولفئات خطر الغش · منتجات العين لازم معقّمة ومفحوصة. دوال صافية.

export const BATCH_CATEGORIES = ["general", "eye", "kohl", "fraud_risk"] as const;
export type BatchCategory = (typeof BATCH_CATEGORIES)[number];
export const BATCH_CATEGORY_LABELS: Record<BatchCategory, string> = {
  general: "عادي",
  eye: "منتج عين",
  kohl: "كحل وإثمد وحناء",
  fraud_risk: "خطر غش (تفتيح · جلد · رجال)",
};
export const isBatchCategory = (v: unknown): v is BatchCategory => typeof v === "string" && (BATCH_CATEGORIES as readonly string[]).includes(v);

export const LICENSE_STATUSES = ["active", "requested", "expired", "revoked"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];
export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = { active: "فعّال", requested: "قيد الطلب", expired: "منتهي", revoked: "ملغي" };
export const isLicenseStatus = (v: unknown): v is LicenseStatus => typeof v === "string" && (LICENSE_STATUSES as readonly string[]).includes(v);

export interface BatchFacts {
  coaKey: string | null;
  independentTestKey: string | null;
  sterile: boolean | null;
  category: string | null;
  heavyMetalsTested: boolean | null;
  expiresAt: Date | null;
}
export interface ReleaseContext {
  /** أول دفعة من هالمورّد لهالمنتج (ما في دفعة مفروجة قبلها) */
  firstFromSupplier: boolean;
  /** فحص الامتثال الأخير بيقول منتج عين / فئة خطر غش */
  eyeFromCheck?: boolean;
  fraudFromCheck?: boolean;
  now?: Date;
}

/** أسباب المنع من الإفراج. قائمة فاضية = بتنفرج. */
export function releaseBlockers(b: BatchFacts, ctx: ReleaseContext): string[] {
  const now = ctx.now ?? new Date();
  const out: string[] = [];
  const cat = isBatchCategory(b.category) ? b.category : "general";
  const eye = cat === "eye" || Boolean(ctx.eyeFromCheck);
  const kohl = cat === "kohl";
  const fraud = cat === "fraud_risk" || kohl || eye || Boolean(ctx.fraudFromCheck);

  if (!b.coaKey) out.push("ما في شهادة تحليل (COA) للدفعة");
  if (b.expiresAt && b.expiresAt.getTime() <= now.getTime()) out.push("الدفعة منتهية الصلاحية");
  if (eye && b.sterile !== true) out.push("منتج عين: التصنيع المعقّم ما اتأكد");
  if (kohl && b.heavyMetalsTested !== true) out.push("كحل: ما في تحليل معادن ثقيلة (رصاص · زرنيخ · كادميوم)");
  if (!b.independentTestKey) {
    if (ctx.firstFromSupplier) out.push("أول دفعة من هالمورّد: الفحص المخبري المستقل إلزامي");
    if (fraud) out.push("فئة خطر غش: الفحص المخبري المستقل إلزامي لكل دفعة");
  }
  return [...new Set(out)];
}

export const DAY_MS = 86_400_000;

/** كم يوم باقي (سالب = انتهى). التاريخ بتوقيت UTC لأن الاختلاف بالساعات ما بيهم هون. */
export function daysUntil(date: Date, now: Date = new Date()): number {
  return Math.ceil((date.getTime() - now.getTime()) / DAY_MS);
}

/** الترخيص ضمن نافذة التنبيه (alertDays، الافتراضي 60) أو منتهي؟ */
export function licenseAlert(l: { expiresAt: Date | null; alertDays: number; status: string }, now: Date = new Date()): "expired" | "expiring" | null {
  if (!l.expiresAt || l.status === "revoked" || l.status === "requested") return null;
  const d = daysUntil(l.expiresAt, now);
  if (d < 0) return "expired";
  return d <= l.alertDays ? "expiring" : null;
}
