import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { PromptError, rollbackVersion } from "@/agents/service";

export const dynamic = "force-dynamic";

// «رجوع»: نسخة جديدة بنص نسخة قديمة. الجسم: { version }
export const POST = guard<{ code: string }>("prompts.manage", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { version?: number } | null;
  if (!body || !Number.isInteger(body.version)) return apiError(400, "bad_request", "رقم النسخة ناقص");
  try {
    const v = await rollbackVersion(getDb(), params.code, body.version as number, user.sub);
    audit("Prompt", params.code, null, { version: v.version, rolledBackTo: body.version });
    return Response.json({ version: v.version });
  } catch (e) {
    if (e instanceof PromptError) return apiError(e.code === "not_found" ? 404 : 400, e.code, e.message);
    throw e;
  }
});
