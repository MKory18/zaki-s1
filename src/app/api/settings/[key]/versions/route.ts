import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listVersions } from "@/lib/settings";

export const dynamic = "force-dynamic";

export const GET = guard<{ key: string }>("settings.manage", async ({ params }) =>
  Response.json({ versions: await listVersions(getDb(), decodeURIComponent(params.key)) }),
);
