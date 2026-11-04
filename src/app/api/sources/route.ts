import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { sourceStatuses } from "@/sources/run";

export const dynamic = "force-dynamic";

// حالة كل مصدر: آخر تشغيل، العدد، الفشل
export const GET = guard("dashboard.view", async () => Response.json({ sources: await sourceStatuses(getDb()) }));
