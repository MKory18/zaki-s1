// بطاقة المرشح (docs/01-logic.md الجزء الرابع، قسم 10): الرأس · الأرقام · الامتثال · السوق · المصادر · الآراء · القرار · السجل.
// الأرقام كلها من الكود (نفس وحدة الحاسبة)، وآراء الوكلاء معلّمة «تقدير» وبتظهر جنب الرقم الحقيقي مش بداله.
import { latestCheck } from "@/compliance/service";
import type { PrismaClient } from "@/generated/prisma/client";
import { nextStates, STATUS_LABELS_AR, type CandidateStatus } from "@/core/candidate-status";
import { loadCoreConfig, RULES_VERSION } from "@/core/config";
import { decide, DECISION_LABELS_AR } from "@/core/decision";
import { dnaScore, rankReferences, type Traits } from "@/core/dna";
import { evaluateReject } from "@/core/reject";
import { assessReadiness, whitespaceFactor } from "@/core/readiness";
import { computeVelocity } from "@/core/velocity";
import { projectEconomics } from "@/core/economics";
import { ACCESS_LABELS_AR, type AccessMethod } from "@/sources/trust";
import { currentModel, listReferences } from "@/lib/dna";
import { listAudit } from "@/lib/audit";
import { aggregateSignals, creatorsTotal, minUsdPrice } from "./signals";
import { candRef, economicsFor, investigatorOpinion } from "./stages";

export const LANE_LABELS_AR = { china_early: "ترند صيني مبكر", regional_proven: "مثبت إقليمياً", manual: "فكرة يدوية" } as const;

export async function buildCard(db: PrismaClient, id: string) {
  const c = await db.candidate.findFirst({ where: { id, deletedAt: null }, include: { observations: { orderBy: { capturedAt: "desc" } }, images: true, problem: true } });
  if (!c) return null;
  const cfg = await loadCoreConfig(db);
  const { model, version } = await currentModel(db);
  const sig = aggregateSignals(c.observations);
  const velocity = computeVelocity(sig, cfg.velocity);
  const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } } });
  const traits = (profile?.traitsJson ?? null) as Traits | null;
  const dna = traits ? dnaScore(traits, model) : null;
  const refs = (await listReferences(db)).filter((x) => x.state === "approved");
  const closest = traits ? rankReferences(traits, refs.map((x) => ({ id: x.id, name: x.name, traits: x.traits })))[0] ?? null : null;

  const unit = minUsdPrice(c.observations);
  const econ = await economicsFor(db, c.id, unit, cfg);
  let scenarios: ReturnType<typeof projectEconomics>["scenarios"] | null = null;
  if (econ && unit !== null && cfg.market.deliveryFee !== null && cfg.market.defaultReturn !== null) {
    scenarios = projectEconomics({ unitCostUsd: unit.toFixed(2), offers: [{ qty: 1, price: (unit * 9).toFixed(2), share: 1 }], deliveryFee: cfg.market.deliveryFee, returnFee: cfg.market.returnFee ?? 0, returnRate: cfg.market.defaultReturn, safetyMargin: cfg.market.safetyMargin }).scenarios;
  }
  const hits = evaluateReject({ lane: c.lane, creators: creatorsTotal(c.observations), trendAgeDays: sig.trendAgeDays, cumulativeSales: sig.cumulativeSales, expectedPerShipment: econ ? parseFloat(econ.lossLimit) : null }, cfg.reject);
  const readiness = assessReadiness([whitespaceFactor(sig.advertisersInMarket ?? null)]);
  const inv = await investigatorOpinion(db, c.id);
  const comp = await latestCheck(db, c.id);
  const rule = decide({ rejectHits: hits, velocity: velocity.score, dna: dna?.score ?? null, cpaCeiling: econ ? parseFloat(econ.cpaCeiling) : null, complianceVerdict: comp ? comp.effective : null, readiness: readiness.verdict, investigator: inv?.opinion ?? null }, cfg.decision);

  const opinions: Record<string, unknown> = {};
  for (const code of ["A06", "A07", "A08", "A09", "A10"]) {
    const run = await db.agentRun.findFirst({ where: { agentCode: code, inputRef: candRef(c.id), status: "ok" }, orderBy: { createdAt: "desc" } });
    if (run?.outputJson) opinions[code] = { at: run.createdAt.toISOString(), output: run.outputJson, estimate: true }; // «تقدير» مش حقيقة
  }
  const decisions = await db.decision.findMany({ where: { candidateId: c.id }, orderBy: { createdAt: "desc" }, take: 20 });
  const history = listAudit(500).filter((e) => e.entity === "Candidate" && e.entityId === c.id).slice(0, 30);

  return {
    rulesVersion: RULES_VERSION,
    header: { id: c.id, titleAr: c.titleAr, titleSrc: c.titleSrc, problem: c.problem?.nameAr ?? null, category: c.category, status: c.status, statusLabel: STATUS_LABELS_AR[c.status as CandidateStatus], lane: c.lane, laneLabel: LANE_LABELS_AR[c.lane], images: c.images.map((i) => i.sourceUrl).filter(Boolean), sourcesCount: c.sourcesCount, conflict: c.conflictFlag },
    numbers: {
      velocity,
      dna: dna ? { score: dna.score, rule: dna.rule, missing: dna.missing, weightsVersion: version, closest } : null,
      economics: econ ? { ...econ, scenarios } : null,
      rejectHits: hits,
    },
    compliance: comp
      ? { status: comp.effective, checkId: comp.id, stage: comp.stage, classification: comp.classification, reasons: comp.reasons, human: comp.humanVerdict, note: comp.humanVerdict ? `${comp.humanVerdict} (قرار المراجع: ${comp.humanNote ?? ""})` : comp.reasons.join(" · ") || "ولا ملاحظة" }
      : { status: "pending", checkId: null, stage: null, classification: null, reasons: [] as string[], human: null, note: "ما انفحص امتثاله لسا (الفحص المبدئي بيجي مع الفحص اليومي)" },
    market: { readiness, whitespaceAdvertisers: sig.advertisersInMarket ?? null },
    sources: c.observations.map((o) => ({ id: o.id, source: o.source, access: ACCESS_LABELS_AR[o.accessMethod as AccessMethod] ?? o.accessMethod, trust: o.trust, url: o.url, capturedAt: o.capturedAt.toISOString().slice(0, 10), snapshot: o.snapshotKey })),
    opinions,
    decision: {
      rule: { decision: rule.decision, label: DECISION_LABELS_AR[rule.decision], reasons: rule.reasons, conflict: rule.conflict, watchDays: rule.watchDays ?? null, outsideBudgetShare: rule.outsideBudgetShare ?? null },
      investigator: inv,
      allowedNext: nextStates(c.status as CandidateStatus),
      ready: c.status === "verified",
      history: decisions.map((d) => ({ at: d.createdAt.toISOString(), actor: d.actorId, action: d.action, reasonCode: d.reasonCode, reasonText: d.reasonText })),
    },
    audit: history.map((e) => ({ at: e.at, actor: e.actorId, action: e.action, before: e.before, after: e.after })),
  };
}
