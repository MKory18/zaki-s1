import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { inbox } from "@/compliance/service";

export const dynamic = "force-dynamic";

// صندوق مراجع الامتثال: فحوصات (ادعاءات وتصنيف) حكمها «يوقف لقرار مختص» أو «مقبول بتعديلات» وما انقرّرت.
export const GET = guard("claims.approve", async () => Response.json({ box: "claims", items: await inbox(getDb(), "claims") }));
