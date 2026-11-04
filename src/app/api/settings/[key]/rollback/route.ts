import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { SettingError, rollbackSetting } from "@/lib/settings";

export const dynamic = "force-dynamic";

// «رجوع»: بيعمل نسخة جديدة بقيمة النسخة القديمة. الجسم: { version }
export const POST = guard<{ key: string }>("settings.manage", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { version?: number } | null;
  if (!body || !Number.isInteger(body.version)) return apiError(400, "bad_request", "رقم النسخة ناقص");
  const key = decodeURIComponent(params.key);
  try {
    const { before, after } = await rollbackSetting(getDb(), key, body.version as number, user.sub);
    audit("Setting", key, { version: before?.version }, { version: after.version, rolledBackTo: body.version });
    return Response.json({ setting: after });
  } catch (e) {
    if (e instanceof SettingError) return apiError(e.code === "not_found" ? 404 : 400, e.code, e.message);
    throw e;
  }
});
