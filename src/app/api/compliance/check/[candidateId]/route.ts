import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { listChecks, runCompliance, type RunOptions } from "@/compliance/service";
import { badRequest, errorResponse } from "@/compliance/errors";

export const dynamic = "force-dynamic";

export const GET = guard<{ candidateId: string }>("dashboard.view", async ({ params }) => Response.json({ items: await listChecks(getDb(), params.candidateId) }));

// تشغيل بوابة الامتثال على مرشح. الجسم: { stage: "screen"|"full", claims?, ingredients?, references?: [{code, usage}], markets?, declaredClass?, organicCertificate? }
// البوابة بترفض وما بتصحح بصمت: البديل بيطلع بالنتيجة، والمراجع بيعتمد.
export const POST = guard<{ candidateId: string }>("claims.approve", async ({ req, params, audit }) => {
  try {
    const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!b) throw badRequest("الطلب ناقص");
    const list = (v: unknown, f: string) => {
      if (v === undefined) return undefined;
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) throw badRequest(`${f}: قائمة نصوص`);
      return (v as string[]).slice(0, 100);
    };
    const refs = b.references;
    if (refs !== undefined && (!Array.isArray(refs) || refs.some((r) => !r || typeof (r as { code?: unknown }).code !== "string"))) throw badRequest("references: قائمة {code, usage}");
    const declared = b.declaredClass;
    if (declared !== undefined && declared !== null && declared !== "cosmetic" && declared !== "therapeutic") throw badRequest("declaredClass: cosmetic أو therapeutic");
    const opts: RunOptions = {
      stage: b.stage === "screen" ? "screen" : "full",
      claims: list(b.claims, "claims"),
      ingredients: list(b.ingredients, "ingredients"),
      markets: list(b.markets, "markets"),
      references: refs as RunOptions["references"],
      declaredClass: (declared ?? null) as RunOptions["declaredClass"],
      organicCertificate: b.organicCertificate === true,
    };
    const r = await runCompliance(getDb(), params.candidateId, opts);
    audit("ComplianceCheck", r.id, null, { candidateId: params.candidateId, stage: r.stage, verdict: r.verdict });
    return Response.json({ id: r.id, stage: r.stage, verdict: r.verdict, classification: r.classification, changed: r.changed, result: r.result }, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
});
