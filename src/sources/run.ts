// تشغيل المصادر: اختيار الكلمات من خريطة المشاكل (والمعتمدة)، تشغيل الآن، وحالة كل مصدر من سجل السحوب.
import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlert } from "@/lib/alerts";
import { pullAliexpress, type PullDeps, type PullReport } from "./aliexpress";
import { pullMetaEu } from "./metaadlib";
import { API_SOURCES, SOURCE_LABELS_AR, getSourceMode, type ApiSource, type SourceMode } from "./modes";

export const MAX_KEYWORDS_PER_RUN = 40;

// كلمات البحث: الإنجليزي من خريطة المشاكل + المعتمدة. بتتدوّر يومياً عشان الكلمات الكتيرة تتغطّى على أيام.
export function pickKeywords(all: string[], cap = MAX_KEYWORDS_PER_RUN, dayIndex = Math.floor(Date.now() / 86_400_000)): string[] {
  const uniq = [...new Set(all.map((k) => k.trim()).filter(Boolean))].sort();
  if (uniq.length <= cap) return uniq;
  const start = (dayIndex * cap) % uniq.length;
  return Array.from({ length: cap }, (_, i) => uniq[(start + i) % uniq.length]);
}

export async function searchKeywords(db: PrismaClient, lang: "en" | "ar"): Promise<string[]> {
  const problems = await db.problem.findMany({ select: { keywordsEn: true, keywordsAr: true } });
  const approved = await db.keyword.findMany({ where: { lang, status: "approved" }, select: { text: true } });
  return [...problems.flatMap((p) => (lang === "en" ? p.keywordsEn : p.keywordsAr)), ...approved.map((k) => k.text)];
}

export async function runSource(db: PrismaClient, source: ApiSource, opts: { keyword?: string; deps?: PullDeps } = {}): Promise<PullReport> {
  const keywords = opts.keyword ? [opts.keyword] : pickKeywords(await searchKeywords(db, "en"));
  return source === "aliexpress" ? pullAliexpress(db, keywords, opts.deps) : pullMetaEu(db, keywords, opts.deps);
}

// جوجل ترند: الواجهة الرسمية بطلب وصول لسا (تجريبية)، فبالاستيراد من ملف. المهمة الليلية بتذكّر بالاستيراد اليدوي.
export function googleTrendsReminder() {
  raiseAlert({ type: "google_trends_manual", severity: "info", message: "جوجل ترند: الواجهة الرسمية مش مفعّلة، استورد ملف جوجل ترند من شاشة الاستيراد." });
}

export interface SourceStatus {
  id: string;
  label: string;
  kind: "api" | "file";
  mode: SourceMode | null;
  lastRun: { at: string; status: string; rows: number; ok: number; failed: number } | null;
  runs: number;
  failedRuns: number;
}

export async function sourceStatuses(db: PrismaClient): Promise<SourceStatus[]> {
  const ids = [...API_SOURCES, "google_trends", "douyin", "ads_tool", "keyword_planner", "kimi", "generic"];
  const out: SourceStatus[] = [];
  for (const id of ids) {
    const last = await db.importJob.findFirst({ where: { source: id }, orderBy: { createdAt: "desc" } });
    const runs = await db.importJob.count({ where: { source: id } });
    const failedRuns = await db.importJob.count({ where: { source: id, status: "failed" } });
    const isApi = (API_SOURCES as readonly string[]).includes(id);
    out.push({
      id,
      label: SOURCE_LABELS_AR[id] ?? id,
      kind: isApi ? "api" : "file",
      mode: isApi ? await getSourceMode(db, id as ApiSource) : null,
      lastRun: last ? { at: last.createdAt.toISOString(), status: last.status, rows: last.rows, ok: last.ok, failed: last.failed } : null,
      runs,
      failedRuns,
    });
  }
  return out;
}
