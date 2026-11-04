import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { inbox } from "@/compliance/service";

export const dynamic = "force-dynamic";

// صندوق المراجع الشرعي: النصوص «بانتظار المراجع» و«يوقف لقرار مختص». هو (والمالك) بيشوفوه بس.
export const GET = guard("texts.view", async () => Response.json({ box: "texts", items: await inbox(getDb(), "texts") }));
