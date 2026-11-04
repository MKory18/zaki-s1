import { newRequestId } from "@/adapters/client";
import { authenticateReader } from "@/adapters/inbound";
import { listCandidatesFor } from "@/adapters/product-compliance";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// عام عن قصد (محمي بتوكن كل نظام، قراءة بس): المرشحين لمساحة العمل والاستشارات. ?status=deep_research&since=2026-10-01
export async function GET(req: Request) {
  const requestId = newRequestId();
  const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message }, request_id: requestId }, { status, headers: { "x-request-id": requestId } });
  if (!authenticateReader(req.headers.get("authorization"))) return fail(401, "UNAUTHORIZED", "توكن غلط أو ناقص");
  const q = new URL(req.url).searchParams;
  try {
    return Response.json({ items: await listCandidatesFor(getDb(), { status: q.get("status"), since: q.get("since") }) }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    return fail(400, "BAD_REQUEST", e instanceof Error ? e.message : "طلب غلط");
  }
}
