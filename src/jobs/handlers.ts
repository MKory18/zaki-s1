// معالجات المهام. المهام اللي وحدتها لسا ما انبنت بتتسجّل «متخطّاة» بلا فشل، وبتنبدّل بمعالج حقيقي مع وحدتها.
import { getDb } from "@/lib/db";
import { raiseAlert } from "@/lib/alerts";
import { runAgent } from "@/agents/service";
import { retryDue } from "@/adapters/outbox";
import { makeExplainer } from "@/lib/dna-explain";
import { runLearning } from "@/lib/dna";
import { googleTrendsReminder, runSource } from "@/sources/run";
import { JOBS } from "./registry";
import type { Handler } from "./queue";

const pending: Handler = async () => ({ skipped: true, reason: "الوحدة لسا ما انبنت" });

export const HANDLERS: Record<string, Handler> = {
  ...Object.fromEntries(JOBS.map((j) => [j.name, pending])),
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
