import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { API_SOURCES, type ApiSource } from "@/sources/modes";
import { runSource } from "@/sources/run";

export const dynamic = "force-dynamic";

// «شغّل الآن» لمصدر بواجهة رسمية. الجسم اختياري: { keyword } لكلمة وحدة، وإلا كلمات خريطة المشاكل.
export const POST = guard<{ id: string }>("capture.create", async ({ req, params, audit }) => {
  if (!(API_SOURCES as readonly string[]).includes(params.id)) return apiError(404, "not_found", "مصدر مجهول (الباقي بالاستيراد من ملف)");
  const body = (await req.json().catch(() => null)) as { keyword?: string } | null;
  const keyword = typeof body?.keyword === "string" && body.keyword.trim() ? body.keyword.trim().slice(0, 100) : undefined;
  const r = await runSource(getDb(), params.id as ApiSource, { keyword });
  audit("ImportJob", r.jobId, null, { source: params.id, keywords: r.keywords, ok: r.ok, failed: r.failed });
  return Response.json(r);
});
