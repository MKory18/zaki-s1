import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { PromptError, createVersion } from "@/agents/service";

export const dynamic = "force-dynamic";

// تعديل برومبت = نسخة جديدة وفعّالة. الجسم: { body, note? }
export const POST = guard<{ code: string }>("prompts.manage", async ({ req, user, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { body?: string; note?: string } | null;
  if (!body || typeof body.body !== "string") return apiError(400, "bad_request", "نص البرومبت ناقص");
  try {
    const v = await createVersion(getDb(), params.code, body.body, user.sub, body.note);
    audit("Prompt", params.code, null, { version: v.version, note: v.note });
    return Response.json({ version: v.version });
  } catch (e) {
    if (e instanceof PromptError) return apiError(e.code === "not_found" ? 404 : 400, e.code, e.message);
    throw e;
  }
});
