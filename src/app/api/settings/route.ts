import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { SettingError, listSettings, setSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = guard("settings.manage", async () => Response.json({ settings: await listSettings(getDb()) }));

// تعديل إعداد = نسخة جديدة. الجسم: { key, value }
export const PUT = guard("settings.manage", async ({ req, user, audit }) => {
  const body = (await req.json().catch(() => null)) as { key?: string; value?: unknown } | null;
  if (!body || typeof body.key !== "string") return apiError(400, "bad_request", "الطلب ناقص");
  try {
    const { before, after } = await setSetting(getDb(), body.key, body.value, user.sub);
    audit("Setting", body.key, before ? { version: before.version, value: before.value } : null, { version: after.version, value: after.value });
    return Response.json({ setting: after });
  } catch (e) {
    if (e instanceof SettingError) return apiError(400, e.code, e.message);
    throw e;
  }
});
