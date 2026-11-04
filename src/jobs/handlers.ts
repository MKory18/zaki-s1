// معالجات المهام. المهام اللي وحدتها لسا ما انبنت بتتسجّل «متخطّاة» بلا فشل، وبتنبدّل بمعالج حقيقي مع وحدتها.
import { getDb } from "@/lib/db";
import { raiseAlert } from "@/lib/alerts";
import { runAgent } from "@/agents/service";
import { JOBS } from "./registry";
import type { Handler } from "./queue";

const pending: Handler = async () => ({ skipped: true, reason: "الوحدة لسا ما انبنت" });

export const HANDLERS: Record<string, Handler> = {
  ...Object.fromEntries(JOBS.map((j) => [j.name, pending])),
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
