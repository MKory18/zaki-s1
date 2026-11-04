import { baseUrlEnv, getModes, tokenEnv, validBaseUrl } from "@/adapters/config";
import { INBOUND_EVENT_TYPES, SYSTEMS, SYSTEM_LABELS_AR, type InboundSystem } from "@/adapters/contracts";
import { secretEnv } from "@/adapters/inbound";
import { outboxCounts } from "@/adapters/outbox";
import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// حالة كل نظام: الوضع، هل العنوان والتوكن مضبوطين (بلا قيمهم أبداً)، وعدّاد الطلبات الصادرة
export const GET = guard("settings.manage", async () => {
  const db = getDb();
  const modes = await getModes(db);
  const counts = await outboxCounts(db);
  return Response.json({
    systems: SYSTEMS.map((s) => ({
      id: s,
      label: SYSTEM_LABELS_AR[s],
      mode: modes[s],
      baseUrlOk: validBaseUrl(process.env[baseUrlEnv(s)]) !== null,
      tokenSet: Boolean(process.env[tokenEnv(s)]),
      webhookSecretSet: s in INBOUND_EVENT_TYPES ? Boolean(process.env[secretEnv(s as InboundSystem)]) : null,
      outbox: counts[s] ?? { pending: 0, ok: 0, failed: 0, dead: 0 },
    })),
  });
});
