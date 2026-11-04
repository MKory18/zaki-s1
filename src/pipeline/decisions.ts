// أزرار القرار على البطاقة: ابدأ بحث معمّق · راقب · ارفض بسبب (من قائمة ثابتة). بتشتغل بس على البطاقة الجاهزة لقرارك (متحقَّق منها).
import type { PrismaClient } from "@/generated/prisma/client";
import { assertTransition, TransitionError, type CandidateStatus } from "@/core/candidate-status";
import { can } from "@/core/permissions";
import { recordAudit } from "@/lib/audit";

export class DecisionError extends Error {
  constructor(public code: "not_found" | "bad_request" | "forbidden" | "not_ready", message: string) {
    super(message);
  }
}

export type CardAction = "deep_research" | "watch" | "reject";

const TARGET: Record<CardAction, CandidateStatus> = { deep_research: "deep_research", watch: "watching", reject: "rejected" };
// الصلاحيات (جدول الأدوار): بحث معمّق للمالك والنائب، والمراقبة والرفض للباحث كمان
const PERMISSION: Record<CardAction, string> = { deep_research: "research.start", watch: "candidate.watch_reject", reject: "candidate.watch_reject" };

export async function decideCandidate(
  db: PrismaClient,
  id: string,
  actor: { sub: string; role: string },
  input: { action: string; reasonCode?: string; reasonText?: string },
  opts: { fromTelegram?: boolean } = {},
) {
  const action = input.action as CardAction;
  if (!(action in TARGET)) throw new DecisionError("bad_request", "الإجراء لازم deep_research أو watch أو reject");
  if (!can(actor.role, PERMISSION[action])) throw new DecisionError("forbidden", "ما عندك صلاحية لهالقرار");
  const c = await db.candidate.findFirst({ where: { id, deletedAt: null } });
  if (!c) throw new DecisionError("not_found", "المرشح مش موجود");
  if (c.status !== "verified") throw new DecisionError("not_ready", "البطاقة مش جاهزة لقرارك: لسا ما انتحقق منها");

  let reasonCode: string | null = null;
  let reasonText: string | null = null;
  if (action === "reject") {
    // سبب الرفض من القائمة الثابتة. «سبب تاني» (R12) لازم نص.
    const reason = input.reasonCode ? await db.rejectReason.findUnique({ where: { code: input.reasonCode } }) : null;
    if (!reason) throw new DecisionError("bad_request", "اختار سبب رفض من القائمة");
    reasonText = input.reasonText?.trim() || null;
    if (reason.code === "R12" && !reasonText) throw new DecisionError("bad_request", "السبب التاني لازم نص يشرحه");
    reasonCode = reason.code;
  }

  try {
    assertTransition(c.status, TARGET[action]);
  } catch (e) {
    if (e instanceof TransitionError) throw new DecisionError("bad_request", e.message);
    throw e;
  }
  const [, decision] = await db.$transaction([
    db.candidate.update({ where: { id }, data: { status: TARGET[action] } }),
    db.decision.create({ data: { candidateId: id, actorId: actor.sub, action, reasonCode, reasonText, fromTelegram: Boolean(opts.fromTelegram) } }),
  ]);
  recordAudit({ actorId: actor.sub, action: `candidate.${action}`, entity: "Candidate", entityId: id, before: { status: c.status }, after: { status: TARGET[action], reasonCode, reasonText, fromTelegram: Boolean(opts.fromTelegram) } });
  return { id, status: TARGET[action], decisionId: decision.id };
}
