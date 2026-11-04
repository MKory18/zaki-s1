// قراءة قيم الإعدادات المكتوبة نصاً بملف البذور ("14 يوم" · "20%" · "4$" · "45–65" · "0.5 · 0.3 · 0.2").
// «تعبّيها» و«—» = ما انعبّت لسا (null). القيمة الأصلية بتضل محفوظة نصاً بالإعدادات.
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const m = /-?\d+(?:\.\d+)?/.exec(raw.replace(/[,،]/g, ""));
  return m ? parseFloat(m[0]) : null;
}

// "25%" ← 0.25
export function parsePercent(raw: unknown): number | null {
  const n = parseNumber(raw);
  if (n === null) return null;
  return typeof raw === "string" && raw.includes("%") ? n / 100 : n > 1 ? n / 100 : n;
}

// "45–65" أو "45-65" ← [45, 65]
export function parseRange(raw: unknown): [number, number] | null {
  if (typeof raw !== "string") return null;
  const m = /(\d+(?:\.\d+)?)\s*[–—-]\s*(\d+(?:\.\d+)?)/.exec(raw);
  return m ? [parseFloat(m[1]), parseFloat(m[2])] : null;
}

// "0.5 · 0.3 · 0.2" ← [0.5, 0.3, 0.2]
export function parseNumberList(raw: unknown): number[] | null {
  if (typeof raw !== "string") return null;
  const parts = raw.split("·").map((p) => parseFloat(p.trim()));
  return parts.length > 0 && parts.every((n) => Number.isFinite(n)) ? parts : null;
}

export const rawOf = (setting: unknown): string | undefined => {
  const raw = (setting as { raw?: unknown } | null | undefined)?.raw;
  return typeof raw === "string" ? raw : typeof raw === "number" ? String(raw) : undefined;
};
