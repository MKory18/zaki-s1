import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { AgentRunError } from "@/agents/runner";
import { runAgent } from "@/agents/service";

export const dynamic = "force-dynamic";

const STATUS: Record<AgentRunError["code"], number> = { disabled: 409, missing_var: 400, no_tier: 409, budget: 429, pii: 422, gateway: 502, invalid_output: 502 };

// تشغيل وكيل بطلب. الجسم: { vars }. الفشل بيرجع بالعربي، وما في نتيجة بديلة مفبركة.
export const POST = guard<{ code: string }>("prompts.manage", async ({ req, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { vars?: Record<string, unknown> } | null;
  try {
    const r = await runAgent(getDb(), params.code, body?.vars ?? {}, { inputRef: "manual" });
    audit("AgentRun", params.code, null, { model: r.model, costMicro: r.costMicro, attempts: r.attempts });
    return Response.json(r);
  } catch (e) {
    if (e instanceof AgentRunError) return apiError(STATUS[e.code], e.code, e.message);
    throw e;
  }
});
