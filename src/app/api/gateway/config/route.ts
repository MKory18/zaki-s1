import { apiError, guard } from "@/lib/api-guard";
import { ConfigError, getGatewayConfig, setGatewayConfig, validateConfig } from "@/gateway/config";
import { ensureGatewayConfig, saveGatewayConfig } from "@/gateway/store";
import { dbConfigured, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// بيرجع الإعدادات مع علامة «المفتاح مضبوط؟» بس. قيمة المفتاح ما بتطلع من الخادم أبداً.
function view() {
  const cfg = getGatewayConfig();
  return { ...cfg, providers: cfg.providers.map((p) => ({ ...p, keySet: Boolean(process.env[p.keyEnv]) })) };
}

export const GET = guard("prompts.manage", async () => {
  if (dbConfigured()) await ensureGatewayConfig(getDb());
  return Response.json(view());
});

export const PUT = guard("prompts.manage", async ({ req, user, audit }) => {
  const body = await req.json().catch(() => null);
  try {
    if (dbConfigured()) await ensureGatewayConfig(getDb());
    const before = getGatewayConfig();
    const next = validateConfig(body);
    if (dbConfigured()) await saveGatewayConfig(getDb(), next, user.sub);
    else setGatewayConfig(next);
    audit("GatewayConfig", null, before, next);
    return Response.json(view());
  } catch (e) {
    if (e instanceof ConfigError) return apiError(400, "bad_config", e.message);
    throw e;
  }
});
