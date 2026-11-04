// وضع المصدر (وهمي أو حقيقي) من الإعدادات source.<المصدر>. الحقيقي بيحتاج مفاتيح بـ .env. أي قيمة غريبة = وهمي.
import type { PrismaClient } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";

export type SourceMode = "mock" | "real";
export const API_SOURCES = ["aliexpress", "meta_eu"] as const;
export type ApiSource = (typeof API_SOURCES)[number];

export const SOURCE_LABELS_AR: Record<string, string> = {
  aliexpress: "علي إكسبرس (واجهة الشركاء)",
  meta_eu: "مكتبة إعلانات ميتا (أوروبا)",
  google_trends: "جوجل ترند (ملف)",
  douyin: "منصة بيانات دويين",
  ads_tool: "أداة إعلانات مرخّصة",
  keyword_planner: "مخطط الكلمات",
  kimi: "نتيجة Kimi",
  generic: "ملف عام",
};

export async function getSourceMode(db: PrismaClient, source: ApiSource): Promise<SourceMode> {
  const s = await getSetting(db, `source.${source}`);
  return String((s?.value as { raw?: unknown } | undefined)?.raw ?? "mock").trim().toLowerCase() === "real" ? "real" : "mock";
}
