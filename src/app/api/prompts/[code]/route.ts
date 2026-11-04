import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = guard<{ code: string }>("prompts.manage", async ({ params }) => {
  const p = await getDb().prompt.findFirst({ where: { code: params.code, deletedAt: null }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!p) return apiError(404, "not_found", "البرومبت مش موجود");
  return Response.json({
    code: p.code,
    nameAr: p.nameAr,
    activeVersionId: p.activeVersionId,
    versions: p.versions.map((v) => ({
      id: v.id, version: v.version, body: v.body, meta: v.outputSchemaJson, authorId: v.authorId, note: v.note, at: v.createdAt.toISOString(), active: v.id === p.activeVersionId,
    })),
  });
});
