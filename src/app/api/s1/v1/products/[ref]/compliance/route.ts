import { newRequestId } from "@/adapters/client";
import { authenticateReader } from "@/adapters/inbound";
import { buildCompliance } from "@/adapters/product-compliance";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

// عام عن قصد (محمي بتوكن كل نظام، قراءة بس): قواعد الادعاءات لمنتج. الإنتاج والميديا باير والكليبر والردود بتقراها قبل أي محتوى.
export async function GET(req: Request, ctx: { params: Promise<{ ref: string }> }) {
  const requestId = newRequestId();
  const fail = (status: number, code: string, message: string) => Response.json({ error: { code, message }, request_id: requestId }, { status, headers: { "x-request-id": requestId } });
  if (!authenticateReader(req.headers.get("authorization"))) return fail(401, "UNAUTHORIZED", "توكن غلط أو ناقص");
  const { ref } = await ctx.params;
  const view = await buildCompliance(getDb(), decodeURIComponent(ref));
  if (!view) return fail(404, "NOT_FOUND", "المنتج مش موجود");
  return Response.json(view, { headers: { "x-request-id": requestId } });
}
