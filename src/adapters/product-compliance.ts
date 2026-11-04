// قواعد الادعاءات لكل منتج (للإنتاج والميديا باير والكليبر والردود) وقراءة المرشحين للأنظمة التانية.
// الأمان أولاً: منتج ما انفحص امتثاله = «يحتاج مراجعة»، مش «ناجح».
import type { PrismaClient } from "@/generated/prisma/client";
import { s1PublicUrl } from "./config";

export interface ComplianceView {
  product_ref: string;
  classification: "cosmetic" | "therapeutic" | "needs_review";
  verdict: "pass" | "pass_with_edits" | "needs_specialist" | "fail";
  allowed_claims: string[];
  banned_claims: string[];
  references: { code: string; text: string; source: string; grading: string; usage: string }[];
  ad_rules: string[];
  updated_at: string;
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export async function buildCompliance(db: PrismaClient, productRef: string): Promise<ComplianceView | null> {
  const pf = await db.productFile.findFirst({ where: { id: productRef, deletedAt: null } });
  if (!pf) return null;
  const check = await db.complianceCheck.findFirst({ where: { candidateId: pf.candidateId }, orderBy: [{ stage: "desc" }, { createdAt: "desc" }] });
  // «full» أقوى من «screen» (ترتيب الإنوم: screen ثم full)، وبنحتفظ بالأحدث ضمن نفس المرحلة

  const claims = await db.claimRule.findMany({ where: { deletedAt: null }, select: { phrase: true, updatedAt: true } });
  const rules = await db.adPolicyRule.findMany({ select: { rule: true, updatedAt: true } });
  const checks = (check?.checksJson ?? {}) as { allowed_claims?: unknown; references?: { code?: string; usage?: string }[] };

  let allowed = strings(checks.allowed_claims);
  if (allowed.length === 0) {
    const brief = await db.formulationBrief.findFirst({ where: { productFileId: pf.id, deletedAt: null }, orderBy: { createdAt: "desc" }, select: { allowedClaims: true } });
    allowed = strings(brief?.allowedClaims);
  }

  const refCodes = (checks.references ?? []).filter((r) => typeof r?.code === "string") as { code: string; usage?: string }[];
  const texts = refCodes.length ? await db.referenceText.findMany({ where: { code: { in: refCodes.map((r) => r.code) }, reviewStatus: "approved", deletedAt: null } }) : [];
  const references = texts.map((t) => ({
    code: t.code,
    text: t.text,
    source: t.source,
    grading: t.grading ?? "",
    usage: refCodes.find((r) => r.code === t.code)?.usage ?? t.usageRule ?? "",
  }));

  const stamps = [check?.updatedAt, ...claims.map((c) => c.updatedAt), ...rules.map((r) => r.updatedAt)].filter((d): d is Date => Boolean(d));
  const updated = stamps.length ? new Date(Math.max(...stamps.map((d) => d.getTime()))) : new Date(0);

  const classification = (check?.classification === "cosmetic" || check?.classification === "therapeutic" ? check.classification : "needs_review") as ComplianceView["classification"];
  return {
    product_ref: pf.id,
    classification,
    verdict: check?.verdict ?? "needs_specialist", // ما في فحص = يحتاج مراجعة
    allowed_claims: allowed,
    banned_claims: claims.map((c) => c.phrase),
    references,
    ad_rules: rules.map((r) => r.rule),
    updated_at: updated.toISOString(),
  };
}

export async function listCandidatesFor(db: PrismaClient, q: { status?: string | null; since?: string | null }) {
  const since = q.since ? new Date(q.since) : null;
  if (since && Number.isNaN(since.getTime())) throw new Error("تاريخ since مش صحيح");
  const rows = await db.candidate.findMany({
    where: { deletedAt: null, ...(q.status ? { status: q.status as never } : {}), ...(since ? { updatedAt: { gte: since } } : {}) },
    include: { problem: { select: { nameAr: true } } },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });
  return rows.map((c) => ({
    id: c.id,
    title_ar: c.titleAr,
    problem: c.problem?.nameAr ?? null,
    velocity: c.velocityScore,
    dna: c.dnaScore,
    status: c.status,
    link: s1PublicUrl(`/candidates/${c.id}`),
  }));
}
