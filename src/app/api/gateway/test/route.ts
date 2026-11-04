import { apiError, guard } from "@/lib/api-guard";
import { callModel } from "@/gateway/gateway";
import { GatewayError } from "@/gateway/types";

export const dynamic = "force-dynamic";

// «تجربة سؤال»: بتمرّ من البوابة نفسها (سقوف وسجل)
export const POST = guard("prompts.manage", async ({ req, audit }) => {
  const body = (await req.json().catch(() => null)) as { agent?: string; prompt?: string } | null;
  if (!body?.agent || !body.prompt?.trim()) return apiError(400, "bad_request", "اختار وكيل واكتب سؤال");
  try {
    const r = await callModel({ agent: body.agent, messages: [{ role: "user", content: body.prompt }] });
    audit("GatewayTest", body.agent, null, { model: r.model, tokensIn: r.tokensIn, tokensOut: r.tokensOut, costMicro: r.costMicro });
    return Response.json(r);
  } catch (e) {
    if (e instanceof GatewayError) {
      const status = e.code === "budget" ? 429 : e.code === "unknown_agent" ? 404 : e.code === "pii" ? 422 : 502;
      return apiError(status, e.code, e.message);
    }
    throw e;
  }
});
