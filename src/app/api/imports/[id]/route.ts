import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = guard<{ id: string }>("dashboard.view", async ({ params }) => {
  const j = await getDb().importJob.findUnique({ where: { id: params.id } });
  if (!j) return apiError(404, "not_found", "الاستيراد مش موجود");
  return Response.json({ id: j.id, source: j.source, fileKey: j.fileKey, rows: j.rows, ok: j.ok, failed: j.failed, status: j.status, at: j.createdAt.toISOString(), detail: j.mappingJson });
});
