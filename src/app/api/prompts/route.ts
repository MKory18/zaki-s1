import { guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = guard("prompts.manage", async () => {
  const prompts = await getDb().prompt.findMany({ where: { deletedAt: null }, include: { versions: { select: { version: true, id: true } } }, orderBy: { code: "asc" } });
  return Response.json({
    prompts: prompts.map((p) => ({
      code: p.code,
      nameAr: p.nameAr,
      versions: p.versions.length,
      activeVersion: p.versions.find((v) => v.id === p.activeVersionId)?.version ?? null,
    })),
  });
});
