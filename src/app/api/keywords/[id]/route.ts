import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// اعتماد كلمة مقترحة أو رفضها (من شاشة المصادر). الجسم: { action: "approve" | "reject" }
export const PATCH = guard<{ id: string }>("settings.manage", async ({ req, params, audit }) => {
  const body = (await req.json().catch(() => null)) as { action?: string } | null;
  if (body?.action !== "approve" && body?.action !== "reject") return apiError(400, "bad_request", "الإجراء لازم approve أو reject");
  const db = getDb();
  const k = await db.keyword.findUnique({ where: { id: params.id } });
  if (!k) return apiError(404, "not_found", "الكلمة مش موجودة");
  if (body.action === "approve") await db.keyword.update({ where: { id: k.id }, data: { status: "approved" } });
  else await db.keyword.delete({ where: { id: k.id } });
  audit("Keyword", k.id, { status: k.status, text: k.text }, { action: body.action });
  return Response.json({ ok: true });
});
