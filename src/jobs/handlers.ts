// معالجات المهام. المهام اللي وحدتها لسا ما انبنت بتتسجّل «متخطّاة» بلا فشل، وبتنبدّل بمعالج حقيقي مع وحدتها.
import { getDb } from "@/lib/db";
import { raiseAlert } from "@/lib/alerts";
import { runAgent } from "@/agents/service";
import { retryDue } from "@/adapters/outbox";
import { makeExplainer } from "@/lib/dna-explain";
import { runLearning } from "@/lib/dna";
import { googleTrendsReminder, runSource } from "@/sources/run";
import { assembleCards, runCompute, runDedupe, runNormalize, runScanner, runScreen, runVerifier } from "@/pipeline/stages";
import type { ReportKind } from "@/reports/data";
import { generateReport } from "@/reports/service";
import { sweepBatches, sweepLicenses, sweepPolicies } from "@/compliance/quality";
import { drain } from "@/lib/persist";
import { JOBS } from "./registry";
import type { Handler } from "./queue";

const pending: Handler = async () => ({ skipped: true, reason: "الوحدة لسا ما انبنت" });

async function reportJob(kind: ReportKind) {
  const r = await generateReport(getDb(), kind);
  if (r.sendError) throw new Error(`التقرير انحفظ بس الإرسال لتيليجرام فشل: ${r.sendError}`); // BullMQ بيعيد بعد 15 دقيقة، والتقرير ما بينكتب مرتين
  return { id: r.id, period: r.period, source: r.source, reused: r.reused, sent: r.sent, telegramMock: r.telegramMock };
}

export const HANDLERS: Record<string, Handler> = {
  ...Object.fromEntries(JOBS.map((j) => [j.name, pending])),
  // خط التقييم اليومي (الجدول بملف المنطق): الموحّد ← الدمج ← الحساب ← الماسح ← المحقق ← الفحص المبدئي ← البطاقات
  normalize: async () => runNormalize(getDb()),
  dedupe: async () => runDedupe(getDb()),
  "compute.scores": async () => runCompute(getDb()),
  "agent.scanner": async () => runScanner(getDb()),
  "agent.verifier": async () => runVerifier(getDb()),
  "screen.batch": async () => runScreen(getDb()),
  "cards.assemble": async () => assembleCards(getDb()),
  // السحب الليلي من الواجهات الرسمية، بكلمات خريطة المشاكل
  "pull.aliexpress": async () => {
    const r = await runSource(getDb(), "aliexpress");
    if (r.status === "failed") throw new Error(`فشل سحب علي إكسبرس: ${r.errors[0]?.reason ?? ""}`); // BullMQ بيعيد بعد ساعة
    return { keywords: r.keywords, ok: r.ok, failed: r.failed, observations: r.observationsCreated };
  },
  "pull.meta_eu": async () => {
    const r = await runSource(getDb(), "meta_eu");
    if (r.status === "failed") throw new Error(`فشل سحب مكتبة إعلانات ميتا: ${r.errors[0]?.reason ?? ""}`);
    return { keywords: r.keywords, ok: r.ok, failed: r.failed, observations: r.observationsCreated };
  },
  "pull.google_trends": async () => {
    googleTrendsReminder(); // الواجهة الرسمية بطلب وصول: بنذكّر بالاستيراد اليدوي
    return { reminder: true };
  },
  // تعلّم الحمض (السبت 23:00): أداء الـ OMS ← أوزان جديدة، والشرح بـ A05
  "dna.learn": async () => {
    const r = await runLearning(getDb(), { explain: makeExplainer(getDb()) });
    return { version: r.version, products: r.products, successes: r.successes, proposed: r.proposedReferences };
  },
  // إعادة الطلبات الصادرة المعلّقة اللي حان موعدها (كل 5 دقايق)
  "outbound.retry": async () => {
    const rows = await retryDue(getDb());
    return { retried: rows.length, ok: rows.filter((r) => r.status === "ok").length, dead: rows.filter((r) => r.status === "dead").length };
  },
  // التقارير (9 الصبح · الأحد · أول الشهر): الأرقام من الكود، وإعادة المهمة ما بتكرّر الإرسال (مفتاح فريد: النوع + الفترة)
  "report.morning": async () => reportJob("morning"),
  "report.weekly": async () => reportJob("weekly"),
  "report.monthly": async () => reportJob("monthly"),
  // الجودة: تراخيص قريبة من الانتهاء ودفعات بلا شهادة (08:00)، وقواعد إعلانات ما انراجعت من 90 يوم (الأحد). التنبيهات بلا تكرار.
  "license.alerts": async () => {
    const l = await sweepLicenses(getDb());
    const b = await sweepBatches(getDb());
    await drain();
    return { licenses: l, batches: b };
  },
  "policy.staleness": async () => {
    const r = await sweepPolicies(getDb());
    await drain();
    return r;
  },
  // تشغيل وكيل بطلب: { code, vars }
  "agent.run": async (data) => {
    const code = String(data.code ?? "");
    const vars = (data.vars ?? {}) as Record<string, unknown>;
    const r = await runAgent(getDb(), code, vars, { inputRef: "queue" });
    return { model: r.model, costMicro: r.costMicro, attempts: r.attempts };
  },
};

export function alertJobFailure(name: string | undefined, err: Error) {
  raiseAlert({ type: "job_failed", severity: "warning", message: `فشلت المهمة ${name ?? "؟"}: ${err.message}` });
}
