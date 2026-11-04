// نص التقرير: قالب ثابت بالعربي (بيشتغل لو كاتب التقارير A17 مش متاح) + حارس الأرقام:
// أي رقم بنص الوكيل مش موجود بالمدخلات = نرفض نصه ونرجع للقالب. الأرقام من الكود بس.
import type { MonthlyData, MorningData, ReportData, WeeklyData } from "./data";

const MAX_TELEGRAM = 3900; // الحد 4096، وبنترك هامش

const dash = (v: number | string | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

function morning(d: MorningData): string {
  const lines: string[] = [`تقرير الصبح — ${d.dateLabel}`, ""];
  d.items.forEach((it, i) => {
    lines.push(`${i + 1}. ${it.title}${it.problem ? ` — ${it.problem}` : ""}`);
    lines.push(`   سرعة ${dash(it.velocity)} · حمض ${dash(it.dna)} · سقف الطلب ${dash(it.cpaCeiling, "$")}`);
    lines.push(`   المقترح: ${it.decision}${it.reason ? ` (${it.reason})` : ""}${it.conflict ? " — فيه تعارض مع رأي المحقق" : ""}`);
    lines.push(`   ${it.link}`);
  });
  if (d.items.length) lines.push("");
  lines.push(d.newTotal > 0 ? `الجديد: ${d.newTotal} ملاحظة (${d.newBySource.map((s) => `${s.label} ${s.count}`).join(" · ")})` : "الجديد: ما إجا شي جديد آخر 24 ساعة");
  lines.push(d.alerts.length ? `التنبيهات:\n${d.alerts.map((a) => `- ${a}`).join("\n")}` : "التنبيهات: ما في");
  if (d.marketChange) lines.push(`أهم تغيير بالسوق: ${d.marketChange}`);
  return lines.join("\n");
}

function weekly(d: WeeklyData): string {
  const lines = [`التقرير الأسبوعي — ${d.period}`, "", "المسار:"];
  d.funnel.forEach((f) => lines.push(`- ${f.label}: ${f.count}`));
  lines.push("", "نسب التحويل:");
  d.conversions.forEach((c) => lines.push(`- ${c.from} ← ${c.to}: ${c.pct}%`));
  lines.push("", `تكلفة الوكلاء: ${d.agentCostTotal}$`);
  d.agentCosts.forEach((a) => lines.push(`- ${a.agent}: ${a.usd}$`));
  lines.push("", "أكتر أسباب الرفض:");
  if (d.rejectReasons.length) d.rejectReasons.forEach((r) => lines.push(`- ${r.label}: ${r.count}`));
  else lines.push("- ما في رفض هالأسبوع");
  lines.push("", "توصيات:");
  d.recommendations.forEach((r) => lines.push(`- ${r}`));
  return lines.join("\n");
}

function monthly(d: MonthlyData): string {
  const lines = [`التقرير الشهري — ${d.period}`, ""];
  lines.push(`نسبة نجاح المنتجات: ${dash(d.successRate, "%")} (نجح ${d.launched} · فشل ${d.failed})`);
  lines.push(`منتجات انطلقت من أفكار يدوية: ${d.fromIdeas}`);
  if (d.dnaChange) lines.push(d.dnaChange);
  if (d.bestSources.length) lines.push("", "أنشط المصادر:", ...d.bestSources.map((s) => `- ${s.label}: ${s.count}`));
  lines.push("", "توصيات:", ...d.recommendations.map((r) => `- ${r}`));
  return lines.join("\n");
}

// التقرير ما بيطلع برقم ناقص بصمت: الناقص بينذكر آخر النص بسطر «ناقص»
export function notesBlock(notes: string[]): string {
  return notes.length ? `\nناقص:\n${notes.map((n) => `- ${n}`).join("\n")}` : "";
}

export function renderTemplate(d: ReportData): string {
  const body = d.kind === "morning" ? morning(d) : d.kind === "weekly" ? weekly(d) : monthly(d);
  return body + notesBlock(d.notes);
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";
const normDigits = (s: string) => s.replace(/[٠-٩]/g, (c) => String(ARABIC_DIGITS.indexOf(c)));
const numbersIn = (s: string): number[] =>
  (normDigits(s).match(/\d+(?:\.\d+)?/g) ?? []).map(parseFloat).filter((n) => Number.isFinite(n));

// الأرقام المسموحة: كل رقم بالمدخلات (بدون الروابط والمعرّفات) + ترقيم القوائم 1..عدد المرشحين
export function allowedNumbers(d: ReportData): Set<number> {
  const json = JSON.stringify(d, (k, v) => (k === "link" || k === "id" ? undefined : v));
  const set = new Set(numbersIn(json));
  const listLen = d.kind === "morning" ? d.items.length : 0;
  for (let i = 1; i <= Math.max(listLen, 10); i++) set.add(i);
  return set;
}

// بيرجع الأرقام الغريبة بنص الوكيل (فاضية = النص نظيف)
export function foreignNumbers(text: string, d: ReportData): number[] {
  const allowed = allowedNumbers(d);
  const stripped = text.replace(/https?:\/\/\S+/g, " ");
  return [...new Set(numbersIn(stripped).filter((n) => !allowed.has(n)))];
}

export function clampForTelegram(text: string): string {
  if (text.length <= MAX_TELEGRAM) return text;
  return `${text.slice(0, MAX_TELEGRAM)}\n… (كمّل على الموقع)`;
}
