import { newRequestId } from "@/adapters/client";
import { authenticateReader } from "@/adapters/inbound";
import { getDb } from "@/lib/db";
import { listEvents } from "@/compliance/events";

export const dynamic = "force-dynamic";

// عام عن قصد (محمي بتوكن كل نظام، قراءة بس): الأحداث الصادرة compliance.updated · batch.blocked · license.expiring.
// ?since=2026-11-01T00:00:00Z&type=compliance.updated. النظام المستقبِل بيسحبها وبيعيد قراءة قواعد المنتج قبل أي نشر.
export async function GET(req: Request) {
  const requestId = newRequestId();
  const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message }, request_id: requestId }, { status, headers: { "x-request-id": requestId } });
  if (!authenticateReader(req.headers.get("authorization"))) return fail(401, "UNAUTHORIZED", "توكن غلط أو ناقص");
  const q = new URL(req.url).searchParams;
  try {
    return Response.json({ events: await listEvents(getDb(), { since: q.get("since"), type: q.get("type") }) }, { headers: { "x-request-id": requestId } });
  } catch (e) {
    return fail(400, "BAD_REQUEST", e instanceof Error ? e.message : "طلب غلط");
  }
}
