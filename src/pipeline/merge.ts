// دمج مرشحين وفكّ الدمج. كل دمج قابل للفك يدوياً: بنسجّل بالتدقيق كل شي انتقل (ملاحظات وصور).
import type { PrismaClient } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";

export class MergeError extends Error {}

async function refreshSources(db: PrismaClient, candidateId: string) {
  const distinct = await db.observation.findMany({ where: { candidateId }, distinct: ["source"], select: { source: true } });
  await db.candidate.update({ where: { id: candidateId }, data: { sourcesCount: distinct.length, lastSeenAt: new Date() } });
}

// بينقل ملاحظات وصور «from» لـ «into» (الأقدم بيضل)، و«from» بيتحذف حذف ناعم
export async function mergeCandidates(db: PrismaClient, fromId: string, intoId: string, actor: string, reason: string) {
  if (fromId === intoId) throw new MergeError("ما بينفع تدمج مرشح بنفسه");
  const [from, into] = await Promise.all([db.candidate.findFirst({ where: { id: fromId, deletedAt: null } }), db.candidate.findFirst({ where: { id: intoId, deletedAt: null } })]);
  if (!from || !into) throw new MergeError("أحد المرشحين مش موجود");
  const obs = await db.observation.findMany({ where: { candidateId: fromId }, select: { id: true } });
  const imgs = await db.imageAsset.findMany({ where: { candidateId: fromId }, select: { id: true } });
  await db.$transaction([
    db.observation.updateMany({ where: { candidateId: fromId }, data: { candidateId: intoId } }),
    db.imageAsset.updateMany({ where: { candidateId: fromId }, data: { candidateId: intoId } }),
    db.candidate.update({ where: { id: fromId }, data: { deletedAt: new Date() } }),
  ]);
  await refreshSources(db, intoId);
  recordAudit({
    actorId: actor,
    action: "candidate.merge",
    entity: "Candidate",
    entityId: intoId,
    before: { fromId, fromTitle: from.titleSrc, fromLane: from.lane, fromStatus: from.status, observationIds: obs.map((o) => o.id), imageIds: imgs.map((i) => i.id) },
    after: { into: intoId, reason },
  });
  return { moved: obs.length, images: imgs.length };
}

// فكّ يدوي: ملاحظات مختارة بتطلع لمرشح جديد (لازم تبقى ملاحظة وحدة على الأقل بالمرشح الأصلي)
export async function splitCandidate(db: PrismaClient, candidateId: string, observationIds: string[], actor: string) {
  const c = await db.candidate.findFirst({ where: { id: candidateId, deletedAt: null } });
  if (!c) throw new MergeError("المرشح مش موجود");
  const all = await db.observation.findMany({ where: { candidateId }, select: { id: true, extractedJson: true } });
  const chosen = all.filter((o) => observationIds.includes(o.id));
  if (chosen.length === 0) throw new MergeError("اختار ملاحظة واحدة على الأقل");
  if (chosen.length === all.length) throw new MergeError("ما بينفع تفك كل الملاحظات: لازم تضل ملاحظة بالمرشح الأصلي");
  const title = (chosen[0].extractedJson as { title?: string } | null)?.title ?? c.titleSrc;
  const created = await db.candidate.create({ data: { titleAr: title, titleSrc: title, lane: c.lane, problemId: c.problemId, category: c.category } });
  const ids = chosen.map((o) => o.id);
  await db.observation.updateMany({ where: { id: { in: ids } }, data: { candidateId: created.id } });
  await db.imageAsset.updateMany({ where: { observationId: { in: ids } }, data: { candidateId: created.id } });
  await Promise.all([refreshSources(db, candidateId), refreshSources(db, created.id)]);
  recordAudit({ actorId: actor, action: "candidate.split", entity: "Candidate", entityId: candidateId, before: { observationIds: ids }, after: { newCandidateId: created.id } });
  return { newCandidateId: created.id, moved: ids.length };
}
