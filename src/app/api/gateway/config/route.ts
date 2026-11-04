import { apiError, guard } from "@/lib/api-guard";
import { ConfigError, getGatewayConfig, setGatewayConfig, validateConfig } from "@/gateway/config";

export const dynamic = "force-dynamic";

// بيرجع الإعدادات مع علامة «المفتاح مضبوط؟» بس. قيمة المفتاح ما بتطلع من الخادم أبداً.
function view() {
  const cfg = getGatewayConfig();
  return { ...cfg, providers: cfg.providers.map((p) => ({ ...p, keySet: Boolean(process.env[p.keyEnv]) })) };
}

export const GET = guard("prompts.manage", () => Response.json(view()));

export const PUT = guard("prompts.manage", async ({ req, audit }) => {
  const body = await req.json().catch(() => null);
  try {
    const before = getGatewayConfig();
    const next = validateConfig(body);
    setGatewayConfig(next);
    audit("GatewayConfig", null, before, next);
    return Response.json(view());
  } catch (e) {
    if (e instanceof ConfigError) return apiError(400, "bad_config", e.message);
    throw e;
  }
});
