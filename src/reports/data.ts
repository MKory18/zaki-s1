// بيانات التقارير: كل رقم محسوب بالكود من القاعدة. كاتب التقارير (A17) بيصيغ بس، وما بيحسب.
// الناقص بيدخل «ملاحظات» بدل ما يطلع رقم ناقص مخفي.
import type { PrismaClient } from "@/generated/prisma/client";
import type { CandidateStatus } from "@/core/candidate-status";
import { DECISION_LABELS_AR, type RuleDecision } from "@/core/decision";
import { parseNumber, rawOf } from "@/core/settings-parse";
import { s1PublicUrl } from "@/adapters/config";
import { listSettings } from "@/lib/settings";
import { SOURCE_LABELS_AR } from "@/sources/modes";

export type ReportKind = "morning" | "weekly" | "monthly";

const DAY = 86_400_000;

export interface MorningItem {
  id: string;
  title: string;
  problem: string | null;
  velocity: number | null;
  dna: number | null;
  cpaCeiling: string | null;
  decision: string; // نص «بحث معمّق» ...
  reason: string;
  conflict: boolean;
  link: string;
}

export interface MorningData {
  kind: "morning";
  period: string;
  dateLabel: string;
  items: MorningItem[];
  newTotal: number;
  newBySource: { source: string; label: string; count: number }[];
  alerts: string[];
  marketChange: string | null;
  notes: string[];
}

export interface WeeklyData {
  kind: "weekly";
  period: string;
  funnel: { label: string; count: number }[];
  conversions: { from: string; to: string; pct: string }[];
  agentCosts: { agent: string; usd: string }[];
  agentCostTotal: string;
  rejectReasons: { code: string; label: string; count: number }[];
  recommendations: string[];
  notes: string[];
}

export interface MonthlyData {
  kind: "monthly";
  period: string;
  successRate: string | null;
  launched: number;
  failed: number;
  fromIdeas: number;
  dnaChange: string | null;
  bestSources: { source: string; label: string; count: number }[];
  recommendations: string[];
  notes: string[];
}

export type ReportData = MorningData | WeeklyData | MonthlyData;

const WEEKDAYS = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
const MONTHS = ["كانون الثاني", "شباط", "آذار", "نيسان", "أيار", "حزيران", "تموز", "آب", "أيلول", "تشرين الأول", "تشرين الثاني", "كانون الأول"];

// التاريخ بتوقيت عمّان (UTC+3 بالصيف الدايم بسوريا والأردن)
const amman = (d: Date) => new Date(d.getTime() + 3 * 3_600_000);
export function dateLabel(d: Date): string {
  const a = amman(d);
  return `${WEEKDAYS[a.getUTCDay()]} ${a.getUTCDate()} ${MONTHS[a.getUTCMonth()]}`;
}
export const dayPeriod = (d: Date) => amman(d).toISOString().slice(0, 10);
export const monthPeriod = (d: Date) => amman(d).toISOString().slice(0, 7);
export function weekPeriod(d: Date): string {
  const a = amman(d);
  const t = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const dayNum = (t.getUTCDay() + 6) % 7; // الاثنين = 0
  t.setUTCDate(t.getUTCDate() - dayNum + 3);
  const week1 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - week1.getTime()) / DAY - 3 + ((week1.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const usd = (n: { toString(): string }) => parseFloat(n.toString()).toFixed(2);

export async function buildMorning(db: PrismaClient, now = new Date()): Promise<MorningData> {
  const settings = new Map((await listSettings(db)).map((s) => [s.key, s.value]));
  const topN = parseNumber(rawOf(settings.get("report.morning_top_n"))) ?? 10;
  const notes: string[] = [];

  const cands = await db.candidate.findMany({
    where: { deletedAt: null, status: { in: ["verified", "shortlisted"] } },
    include: { problem: { select: { nameAr: true } } },
    orderBy: [{ conflictFlag: "desc" }, { velocityScore: { sort: "desc", nulls: "last" } }],
    take: topN,
  });
  const items: MorningItem[] = [];
  let missingEcon = 0;
  for (const c of cands) {
    const m = /^(\w+): ?([\s\S]*)$/.exec(c.decisionReason ?? "");
    const decision = m && m[1] in DECISION_LABELS_AR ? DECISION_LABELS_AR[m[1] as RuleDecision] : c.decisionSuggested ? c.decisionSuggested : "لسا ما انقرّر";
    // سقف تكلفة الطلب من آخر حساب اقتصاد محفوظ (إذا في)
    const econ = await db.economicsCalc.findFirst({ where: { candidateId: c.id, kind: "projection" }, orderBy: { computedAt: "desc" } });
    if (!econ) missingEcon += 1;
    items.push({
      id: c.id, title: c.titleAr, problem: c.problem?.nameAr ?? null, velocity: c.velocityScore, dna: c.dnaScore,
      cpaCeiling: econ ? usd(econ.cpaCeiling) : null, decision, reason: m?.[2] ?? "", conflict: c.conflictFlag, link: s1PublicUrl(`/candidates/${c.id}`),
    });
  }
  if (items.length === 0) notes.push("ما في مرشحين جاهزين لقرارك اليوم");
  if (missingEcon > 0) notes.push(`الاقتصاد ناقص لـ ${missingEcon} مرشح (التكلفة أو إعدادات السوق ناقصة)`);

  const since = new Date(now.getTime() - DAY);
  const groups = await db.observation.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { source: "desc" } } });
  const newBySource = groups.map((g) => ({ source: g.source, label: SOURCE_LABELS_AR[g.source] ?? g.source, count: g._count._all }));
  const newTotal = newBySource.reduce((a, g) => a + g.count, 0);

  const alertRows = await db.alert.findMany({ where: { ackAt: null, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 5 });
  const alerts = alertRows.map((a) => a.message);

  // أهم تغيير بالسوق: أكبر صعود بمؤشر السرعة بين آخر لقطتين آخر 48 ساعة (5 نقاط فأكتر)
  const snaps = await db.scoreSnapshot.findMany({ where: { computedAt: { gte: new Date(now.getTime() - 2 * DAY) } }, orderBy: { computedAt: "asc" }, include: { candidate: { select: { titleAr: true, deletedAt: true } } } });
  const byC = new Map<string, { title: string; scores: number[] }>();
  for (const s of snaps) {
    const sc = (s.velocityJson as { score?: number | null } | null)?.score;
    if (typeof sc !== "number" || s.candidate.deletedAt) continue;
    const e = byC.get(s.candidateId) ?? { title: s.candidate.titleAr, scores: [] };
    e.scores.push(sc);
    byC.set(s.candidateId, e);
  }
  let best: { title: string; from: number; to: number } | null = null;
  for (const e of byC.values()) {
    if (e.scores.length < 2) continue;
    const from = e.scores[e.scores.length - 2];
    const to = e.scores[e.scores.length - 1];
    if (to - from >= 5 && (!best || to - from > best.to - best.from)) best = { title: e.title, from, to };
  }
  const marketChange = best ? `صعود ${best.title}: المؤشر من ${best.from} إلى ${best.to}` : null;
  return { kind: "morning", period: dayPeriod(now), dateLabel: dateLabel(now), items, newTotal, newBySource, alerts, marketChange, notes };
}

const RECOMMENDATION: Record<string, string> = {
  R01: "السوق مشبّع كتير: جرّب منتجات بفراغ أكبر بسوقك",
  R02: "الترند قديم كتير: شغّل السحب أبكر أو ركّز على دويين",
  R03: "الهامش ضعيف: راجع التكلفة المرجعية والعروض بالحاسبة قبل ما تكمّل",
  R04: "مرفوضين بالامتثال: راجع قاموس الادعاءات مع الكشّافات",
  R05: "فئة علاجية بلا مسار ترخيص: ابعد عنها أو ابدأ مسار ترخيص",
  R06: "اللوجستيات صعبة: فلتر الأشكال الهشة أو الحساسة للحرارة",
  R07: "جودة المورّد أو العيّنة ضعيفة: وسّع قائمة المورّدين",
  R08: "ما بيناسب جمهورنا: عدّل كلمات البحث",
  R09: "مكرر: راجع حدود الدمج بالإعدادات",
  R10: "البيانات ضعيفة: أضف مصادر أو استورد ملفات أكتر",
  R11: "مقيّد إعلانياً: راجع قواعد الإعلانات",
};

export async function buildWeekly(db: PrismaClient, now = new Date()): Promise<WeeklyData> {
  const since = new Date(now.getTime() - 7 * DAY);
  const notes: string[] = [];
  const cur = await db.candidate.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
  const count = (s: CandidateStatus) => cur.find((g) => g.status === s)?._count._all ?? 0;
  const newWeek = await db.candidate.count({ where: { createdAt: { gte: since }, deletedAt: null } });
  // المسار: كم وصل لكل مرحلة (الحالي + اللي عدّى عليها)
  const reached = (statuses: CandidateStatus[]) => statuses.reduce((a, s) => a + count(s), 0);
  const funnel = [
    { label: "انكشف هالأسبوع", count: newWeek },
    { label: "انفرز", count: reached(["scanned", "held", "shortlisted", "verified", "watching", "deep_research", "trend_lab", "paid_test", "launched", "failed", "rejected", "archived"]) },
    { label: "تحقق", count: reached(["verified", "watching", "deep_research", "trend_lab", "paid_test", "launched", "failed"]) },
    { label: "بحث معمّق", count: reached(["deep_research", "trend_lab", "paid_test", "launched", "failed"]) },
    { label: "مختبر الترند", count: reached(["trend_lab", "paid_test", "launched", "failed"]) },
    { label: "اختبار مدفوع", count: reached(["paid_test", "launched", "failed"]) },
    { label: "نجح (مُطلق)", count: count("launched") },
  ];
  const conversions = funnel.slice(1).map((f, i) => ({ from: funnel[i].label, to: f.label, pct: funnel[i].count > 0 ? ((f.count / funnel[i].count) * 100).toFixed(1) : "0.0" }));

  const runs = await db.agentRun.groupBy({ by: ["agentCode"], where: { createdAt: { gte: since } }, _sum: { costUsd: true }, orderBy: { agentCode: "asc" } });
  const agentCosts = runs.map((r) => ({ agent: r.agentCode, usd: usd(r._sum.costUsd ?? 0) })).filter((r) => parseFloat(r.usd) > 0);
  const total = agentCosts.reduce((a, r) => a + parseFloat(r.usd), 0).toFixed(2);

  const rej = await db.decision.groupBy({ by: ["reasonCode"], where: { action: "reject", createdAt: { gte: since }, reasonCode: { not: null } }, _count: { _all: true }, orderBy: { _count: { reasonCode: "desc" } }, take: 5 });
  const labels = new Map((await db.rejectReason.findMany()).map((r) => [r.code, r.labelAr]));
  const rejectReasons = rej.map((r) => ({ code: r.reasonCode as string, label: labels.get(r.reasonCode as string) ?? (r.reasonCode as string), count: r._count._all }));
  const recommendations = rejectReasons.slice(0, 3).map((r) => RECOMMENDATION[r.code]).filter(Boolean);
  if (recommendations.length === 0) recommendations.push("ما في قرارات رفض كفاية لتوصية هالأسبوع");

  notes.push("نتائج مختبر الترند: ما في بيانات لسا (المختبر بيجي لاحقاً)");
  notes.push("دقة الحمض: بتنحسب لما يتجمّع منتجات مختبرة كفاية");
  return { kind: "weekly", period: weekPeriod(now), funnel, conversions, agentCosts, agentCostTotal: total, rejectReasons, recommendations, notes };
}

export async function buildMonthly(db: PrismaClient, now = new Date()): Promise<MonthlyData> {
  const notes: string[] = [];
  const launched = await db.candidate.count({ where: { deletedAt: null, status: "launched" } });
  const failed = await db.candidate.count({ where: { deletedAt: null, status: "failed" } });
  const tested = launched + failed;
  const successRate = tested > 0 ? ((launched / tested) * 100).toFixed(1) : null;
  if (successRate === null) notes.push("نسبة نجاح المنتجات: ما في منتجات مختبرة لسا");
  const fromIdeas = await db.candidate.count({ where: { deletedAt: null, status: "launched", lane: "manual" } });

  const sets = await db.dnaWeightSet.findMany({ orderBy: { version: "desc" }, take: 2 });
  let dnaChange: string | null = null;
  if (sets.length === 2) {
    const [n, o] = sets.map((s) => s.weightsJson as Record<string, number>);
    const diffs = Object.keys(n).map((k) => ({ k, d: n[k] - (o[k] ?? 0) })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
    if (diffs[0] && Math.abs(diffs[0].d) >= 0.005) dnaChange = `أكبر تغيّر بأوزان الحمض: ${diffs[0].k} (${diffs[0].d > 0 ? "+" : ""}${diffs[0].d.toFixed(3)})`;
  }
  if (!dnaChange) notes.push("تغيّر أوزان الحمض: ما في نسختين للمقارنة أو التغيّر صغير");
  notes.push("زمن الفكرة للاختبار: بيحتاج تواريخ مراحل المرشح (بتتجمّع مع المختبر والربط)");

  const monthStart = new Date(Date.UTC(amman(now).getUTCFullYear(), amman(now).getUTCMonth(), 1));
  const src = await db.observation.groupBy({ by: ["source"], where: { createdAt: { gte: monthStart } }, _count: { _all: true }, orderBy: { _count: { source: "desc" } }, take: 3 });
  const bestSources = src.map((g) => ({ source: g.source, label: SOURCE_LABELS_AR[g.source] ?? g.source, count: g._count._all }));
  const recommendations = bestSources.length ? [`أكتر مصدر ملاحظات هالشهر: ${bestSources[0].label}. ركّز عليه وشوف الباقي`] : ["ما في ملاحظات هالشهر: شغّل المصادر"];
  return { kind: "monthly", period: monthPeriod(now), successRate, launched, failed, fromIdeas, dnaChange, bestSources, recommendations, notes };
}

export async function buildReport(db: PrismaClient, kind: ReportKind, now = new Date()): Promise<ReportData> {
  return kind === "morning" ? buildMorning(db, now) : kind === "weekly" ? buildWeekly(db, now) : buildMonthly(db, now);
}
