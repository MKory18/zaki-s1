// الإعدادات بنسخ: كل تعديل = نسخة جديدة بتاريخ ومين عدّل، والرجوع = نسخة جديدة بقيمة النسخة القديمة (التاريخ ما بيتمسح).
import type { PrismaClient } from "@/generated/prisma/client";

export interface SettingRow {
  key: string;
  value: unknown;
  version: number;
  updatedBy: string | null;
  updatedAt: string;
}

const toRow = (r: { key: string; valueJson: unknown; version: number; updatedBy: string | null; createdAt: Date }): SettingRow => ({
  key: r.key,
  value: r.valueJson,
  version: r.version,
  updatedBy: r.updatedBy,
  updatedAt: r.createdAt.toISOString(),
});

export class SettingError extends Error {
  constructor(public code: "not_found" | "bad_key" | "bad_value", message: string) {
    super(message);
  }
}

export const KEY_RE = /^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$/;

export async function getSetting(db: PrismaClient, key: string): Promise<SettingRow | null> {
  const r = await db.setting.findFirst({ where: { key }, orderBy: { version: "desc" } });
  return r ? toRow(r) : null;
}

export async function listSettings(db: PrismaClient): Promise<SettingRow[]> {
  const all = await db.setting.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  const seen = new Set<string>();
  const out: SettingRow[] = [];
  for (const r of all) {
    if (seen.has(r.key)) continue;
    seen.add(r.key);
    out.push(toRow(r));
  }
  return out;
}

export async function listVersions(db: PrismaClient, key: string): Promise<SettingRow[]> {
  const rows = await db.setting.findMany({ where: { key }, orderBy: { version: "desc" } });
  return rows.map(toRow);
}

// بيكتب نسخة جديدة. للمفتاح الجديد (أول مرة) لازم يطابق صيغة المفاتيح.
export async function setSetting(db: PrismaClient, key: string, value: unknown, actor: string): Promise<{ before: SettingRow | null; after: SettingRow }> {
  if (value === undefined || value === null) throw new SettingError("bad_value", "القيمة فاضية");
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await getSetting(db, key);
    if (!before && !KEY_RE.test(key)) throw new SettingError("bad_key", "اسم الإعداد غلط");
    try {
      const created = await db.setting.create({
        data: { key, valueJson: value as never, version: (before?.version ?? 0) + 1, updatedBy: actor },
      });
      return { before, after: toRow(created) };
    } catch (e) {
      // تعارض نسخة (طلبين بنفس اللحظة): نعيد المحاولة على آخر نسخة
      if (attempt === 2) throw e;
    }
  }
  throw new Error("unreachable");
}

export async function rollbackSetting(db: PrismaClient, key: string, version: number, actor: string) {
  const old = await db.setting.findUnique({ where: { key_version: { key, version } } });
  if (!old) throw new SettingError("not_found", "النسخة مش موجودة");
  return setSetting(db, key, old.valueJson, actor);
}

// تبويبات شاشة الإعدادات: بتتحدد من بداية المفتاح
export const SETTING_TABS = [
  { id: "velocity", label: "المؤشر والرفض", prefixes: ["velocity.", "reject."] },
  { id: "dna", label: "الحمض", prefixes: ["dna."] },
  { id: "decision", label: "الدمج والقرار", prefixes: ["dedupe.", "decision.", "pipeline.", "report.", "signals."] },
  { id: "trend", label: "الترند", prefixes: ["trend."] },
  { id: "markets", label: "الأسواق", prefixes: ["market."] },
  { id: "schedule", label: "الجدولة", prefixes: ["schedule."] },
  { id: "budgets", label: "الميزانيات", prefixes: ["agents."] },
  { id: "integration", label: "الربط", prefixes: ["integration."] },
  { id: "templates", label: "القوالب", prefixes: ["template.", "launch.", "costs.", "compliance."] },
] as const;

export function tabOf(key: string): string | null {
  return SETTING_TABS.find((t) => t.prefixes.some((p) => key.startsWith(p)))?.id ?? null;
}
