// حفظ نتائج الحساب مع نسخة القواعد (كل نتيجة بتنحفظ بالنسخة اللي انحسبت فيها).
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { RULES_VERSION } from "./config";
import type { Actual, Projection } from "./economics";
import type { VelocityResult } from "./velocity";

export async function saveProjection(db: PrismaClient, candidateId: string, market: string, inputs: unknown, p: Projection) {
  return db.economicsCalc.create({
    data: {
      candidateId,
      market,
      inputsJson: { ...(inputs as object), rulesVersion: RULES_VERSION } as never,
      lossLimit: new Prisma.Decimal(p.lossLimit),
      cpaCeiling: new Prisma.Decimal(p.cpaCeiling),
      scalingCeiling: new Prisma.Decimal(p.scalingCeiling),
      scenariosJson: { rulesVersion: RULES_VERSION, scenarios: p.scenarios, lines: p.lines.map(({ key, value, rule }) => ({ key, value, rule })) } as never,
      kind: "projection",
    },
  });
}

// بعد الاختبار (من الـ OMS): حد الخسارة الفعلي، وتكلفة الطلب المؤكد مكان «سقف التكلفة»، وسقف التكبير الفعلي
export async function saveActual(db: PrismaClient, candidateId: string, market: string, inputs: unknown, a: Actual) {
  return db.economicsCalc.create({
    data: {
      candidateId,
      market,
      inputsJson: { ...(inputs as object), rulesVersion: RULES_VERSION } as never,
      lossLimit: new Prisma.Decimal(a.lossLimit ?? "0"),
      cpaCeiling: new Prisma.Decimal(a.costPerConfirmed ?? "0"),
      scalingCeiling: new Prisma.Decimal(a.scalingCeiling ?? "0"),
      scenariosJson: { rulesVersion: RULES_VERSION, success: a.success, lines: a.lines.map(({ key, value, rule }) => ({ key, value, rule })) } as never,
      kind: "actual",
    },
  });
}

export async function saveVelocity(db: PrismaClient, candidateId: string, v: VelocityResult, extra: { dna?: unknown; similarity?: unknown } = {}) {
  const snap = await db.scoreSnapshot.create({
    data: { candidateId, velocityJson: v as never, dnaJson: (extra.dna ?? {}) as never, similarityJson: (extra.similarity ?? {}) as never, rulesVersion: RULES_VERSION },
  });
  if (v.score !== null) await db.candidate.update({ where: { id: candidateId }, data: { velocityScore: v.score } });
  return snap;
}
