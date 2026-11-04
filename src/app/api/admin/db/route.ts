import { guard } from "@/lib/api-guard";
import { inspectDb } from "@/lib/db-inspect";

export const dynamic = "force-dynamic";

export const GET = guard("settings.manage", async () => Response.json(await inspectDb()));
