import { newRequestId } from "@/adapters/client";
import { INBOUND_EVENT_TYPES, type InboundSystem } from "@/adapters/contracts";
import { receiveEvent } from "@/adapters/inbound";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// عام عن قصد (محمي بتوقيع الحدث مش بجلسة): X-Zaki-Timestamp و X-Zaki-Signature. المرفوض: توقيع غلط · وقت قديم · مكرر بيرجع نجاح بلا معالجة.
export async function POST(req: Request, ctx: { params: Promise<{ system: string }> }) {
  const requestId = newRequestId();
  const { system } = await ctx.params;
  if (!(system in INBOUND_EVENT_TYPES)) {
    return Response.json({ error: { code: "NOT_FOUND", message: "نظام مجهول" }, request_id: requestId }, { status: 404 });
  }
  const rawBody = await req.text(); // الجسم الخام: التوقيع على نصه بالضبط
  const r = await receiveEvent(getDb(), system as InboundSystem, {
    rawBody,
    timestamp: req.headers.get("x-zaki-timestamp"),
    signature: req.headers.get("x-zaki-signature"),
  });
  return Response.json({ ...r.body, request_id: requestId }, { status: r.status, headers: { "x-request-id": requestId, ...(r.headers ?? {}) } });
}
