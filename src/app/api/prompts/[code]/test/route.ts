import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { AgentRunError } from "@/agents/runner";
import { runAgent } from "@/agents/service";

export const dynamic = "force-dynamic";

// تجربة برومبت على مدخل نموذجي بدون ما يتحفظ: الجسم { vars, body? }. بتمرّ من البوابة كاملة (سقوف وسجل).
export const POST = guard<{ code: string }>("prompts.manage", async ({ req, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { vars?: Record<string, unknown>; body?: string } | null;
  if (!body) return apiError(400, "bad_request", "الطلب ناقص");
  try {
    const r = await runAgent(getDb(), params.code, body.vars ?? {}, { inputRef: "prompt-test", promptBody: body.body });
    audit("PromptTest", params.code, null, { model: r.model, costMicro: r.costMicro, attempts: r.attempts });
    return Response.json(r);
  } catch (e) {
    if (e instanceof AgentRunError) {
      const status = { disabled: 409, missing_var: 400, no_tier: 409, budget: 429, pii: 422, gateway: 502, invalid_output: 502 }[e.code];
      return apiError(status, e.code, e.message);
    }
    throw e;
  }
});
