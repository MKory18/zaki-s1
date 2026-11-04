import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { buildCard } from "@/pipeline/card";

export const dynamic = "force-dynamic";

// بطاقة المرشح بكل أقسامها
export const GET = guard<{ id: string }>("dashboard.view", async ({ params }) => {
  const card = await buildCard(getDb(), params.id);
  return card ? Response.json(card) : apiError(404, "not_found", "المرشح مش موجود");
});
