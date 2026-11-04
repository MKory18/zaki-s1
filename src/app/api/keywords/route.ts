import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// الكلمات المقترحة (من الكشّافات والمخطط) بانتظار اعتمادك
export const GET = guard("dashboard.view", async ({ req }) => {
  const status = new URL(req.url).searchParams.get("status") === "approved" ? "approved" : "proposed";
  const rows = await getDb().keyword.findMany({ where: { status }, orderBy: { createdAt: "desc" }, take: 200 });
  return Response.json({ keywords: rows.map((k) => ({ id: k.id, text: k.text, lang: k.lang, source: k.source, status: k.status })) });
});
