import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { ackAlert } from "@/lib/alerts-board";

export const dynamic = "force-dynamic";

// «شفت» التنبيه: بيختفي من المفتوحة ويضل بالسجل
export const POST = guard<{ id: string }>("candidate.watch_reject", async ({ user, params, audit }) => {
  const r = await ackAlert(getDb(), params.id, user.sub);
  if (!r) return apiError(404, "not_found", "التنبيه مش موجود");
  audit("Alert", params.id, { ackAt: null }, { ackBy: user.sub });
  return Response.json(r);
});
