import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { lineDiff } from "@/agents/service";

export const dynamic = "force-dynamic";

// مقارنة نسختين: ?a=1&b=3
export const GET = guard<{ code: string }>("prompts.manage", async ({ req, params }) => {
  const q = new URL(req.url).searchParams;
  const a = Number(q.get("a"));
  const b = Number(q.get("b"));
  if (!Number.isInteger(a) || !Number.isInteger(b)) return apiError(400, "bad_request", "رقم النسختين ناقص");
  const p = await getDb().prompt.findFirst({ where: { code: params.code, deletedAt: null } });
  if (!p) return apiError(404, "not_found", "البرومبت مش موجود");
  const [va, vb] = await Promise.all([
    getDb().promptVersion.findUnique({ where: { promptId_version: { promptId: p.id, version: a } } }),
    getDb().promptVersion.findUnique({ where: { promptId_version: { promptId: p.id, version: b } } }),
  ]);
  if (!va || !vb) return apiError(404, "not_found", "النسخة مش موجودة");
  return Response.json({ diff: lineDiff(va.body, vb.body) });
});
