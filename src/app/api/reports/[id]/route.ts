import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { getReport } from "@/reports/service";

export const dynamic = "force-dynamic";

export const GET = guard<{ id: string }>("dashboard.view", async ({ params }) => {
  const r = await getReport(getDb(), params.id);
  return r ? Response.json(r) : apiError(404, "not_found", "التقرير مش موجود");
});
