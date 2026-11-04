import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { PromptWorkbench } from "./workbench";

export const dynamic = "force-dynamic";

export default async function PromptPage({ params }: { params: Promise<{ code: string }> }) {
  await requireUser("prompts.manage");
  const { code } = await params;
  if (!dbConfigured()) notFound();
  const p = await getDb().prompt.findFirst({ where: { code, deletedAt: null }, include: { versions: { orderBy: { version: "desc" } } } });
  if (!p) notFound();
  const active = p.versions.find((v) => v.id === p.activeVersionId) ?? p.versions[0];
  const meta = (active?.outputSchemaJson ?? {}) as { variables?: string[]; example?: unknown; shape?: unknown };
  return (
    <main className="shell wide">
      <h1>{p.nameAr} <small dir="ltr" className="muted">{p.code}</small></h1>
      <p><Link href="/prompts">← كل البرومبتات</Link></p>
      <PromptWorkbench
        code={p.code}
        isAgent={p.code !== "COMMON"}
        activeVersion={active?.version ?? 0}
        body={active?.body ?? ""}
        variables={meta.variables ?? []}
        example={meta.example ?? null}
        versions={p.versions.map((v) => ({ version: v.version, authorId: v.authorId, note: v.note, at: v.createdAt.toISOString() }))}
      />
    </main>
  );
}
