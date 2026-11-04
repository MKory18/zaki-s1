import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { currentModel, listWeightSets } from "@/lib/dna";

export const dynamic = "force-dynamic";

// الأوزان الحالية (بحجم عيّنة كل قيمة وعلامة «عيّنة صغيرة») ونسخها بتاريخها
export const GET = guard("dashboard.view", async () => {
  const db = getDb();
  const { model, version } = await currentModel(db);
  return Response.json({ version, model, versions: await listWeightSets(db) });
});
