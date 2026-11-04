// «الثقة» بحسب طريقة الوصول (docs/01-logic.md الجزء الثالث، قسم 1). رقم بيدخل بحساب الإشارة، وقابل للتعديل من الإعدادات.
export type AccessMethod = "api" | "licensed" | "import" | "extension" | "kimi" | "manual" | "oms";

export const DEFAULT_TRUST: Record<AccessMethod, number> = {
  api: 0.9, // واجهة رسمية
  licensed: 0.8, // مزوّد بيانات مرخّص
  import: 0.8, // استيراد ملف
  extension: 0.7, // الإضافة بسرعة إنسان
  kimi: 0.6, // Kimi بالمتصفح
  manual: 0.5, // ملاحظة يدوية
  oms: 1.0, // أرقام الـ OMS
};

export const ACCESS_LABELS_AR: Record<AccessMethod, string> = {
  api: "واجهة رسمية",
  licensed: "مزوّد مرخّص",
  import: "استيراد ملف",
  extension: "الإضافة",
  kimi: "Kimi",
  manual: "يدوي",
  oms: "الـ OMS",
};

// عمود Observation.trust (high/medium/low) من الرقم
export function trustLevel(v: number): "high" | "medium" | "low" {
  return v >= 0.8 ? "high" : v >= 0.6 ? "medium" : "low";
}

export function trustOf(method: AccessMethod, table: Partial<Record<AccessMethod, number>> = DEFAULT_TRUST): number {
  const v = table[method];
  return typeof v === "number" && v >= 0 && v <= 1 ? v : DEFAULT_TRUST[method];
}
