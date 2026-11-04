// خط التقييم اليومي بمرحلتين (docs/01-logic.md الجزء الثاني): الموحّد H01 ← الدمج (+الحَكَم H02) ← الحساب بالكود ← الماسح A06 على الجديد ←
// المحقق A07 على أعلى 30 فقط ← A08 وA09 وA10 على أعلى 15 ← تجميع البطاقات وقرار القواعد. الأرقام من الكود، والوكلاء بيفسّروا بس.
// فشل أي وكيل لمرشح: بيتسجّل ويضل المرشح بمرحلته وبيرجع ينفحص بالجولة الجاية (بلا نتيجة مفبركة).
import type { PrismaClient } from "@/generated/prisma/client";
import { assertTransition, type CandidateStatus } from "@/core/candidate-status";
import { loadCoreConfig } from "@/core/config";
import { decide, type InvestigatorOpinion } from "@/core/decision";
import { dedupeConfigFrom, dedupeDecision, titleSimilarity, type DedupeConfig } from "@/core/dedupe";
import { currentModel, listReferences } from "@/lib/dna";
import { dnaScore, rankReferences, validateTraits, type Traits } from "@/core/dna";
import { projectEconomics } from "@/core/economics";
import { evaluateReject } from "@/core/reject";
import { assessReadiness, whitespaceFactor } from "@/core/readiness";
import { saveVelocity } from "@/core/save";
import { computeVelocity } from "@/core/velocity";
import { hamming } from "@/core/phash";
import { AgentRunError } from "@/agents/runner";
import { latestCheck, screenCandidate, type AgentRunner } from "@/compliance/service";
import { runAgent } from "@/agents/service";
import { listSettings } from "@/lib/settings";
import { parseNumber, rawOf } from "@/core/settings-parse";
import { mergeCandidates } from "./merge";
import { aggregateSignals, creatorsTotal, minUsdPrice } from "./signals";

// ───── تشغيل وكيل بأمان: الفشل = null (مسجّل بجدول AgentRun) ─────
export type AgentFn = (code: string, vars: Record<string, unknown>, ref: string) => Promise<unknown | null>;

export function defaultAgent(db: PrismaClient): AgentFn {
  return async (code, vars, ref) => {
    try {
      return (await runAgent(db, code, vars, { inputRef: ref })).output;
    } catch (e) {
      if (e instanceof AgentRunError) return null;
      throw e;
    }
  };
}

export const candRef = (id: string) => `cand:${id}`;

export interface StageReport {
  stage: string;
  processed: number;
  skipped: number;
  details: Record<string, number>;
}
const rep = (stage: string): StageReport => ({ stage, processed: 0, skipped: 0, details: {} });
const bump = (r: StageReport, k: string, n = 1) => void (r.details[k] = (r.details[k] ?? 0) + n);

async function settingsMap(db: PrismaClient): Promise<Map<string, unknown>> {
  return new Map((await listSettings(db)).map((s) => [s.key, s.value]));
}
const topN = (m: Map<string, unknown>, key: string, d: number) => parseNumber(rawOf(m.get(key))) ?? d;

// الانتقال الآمن: بس المسموح
async function move(db: PrismaClient, id: string, from: CandidateStatus, to: CandidateStatus, extra: Record<string, unknown> = {}) {
  assertTransition(from, to);
  await db.candidate.update({ where: { id }, data: { status: to, ...extra } });
}

// ───── 1. الموحّد (H01): عنوان عربي وربط بالمشكلة. ما انوحّد = بيضل بعنوانه الأصلي ─────
export async function runNormalize(db: PrismaClient, agent: AgentFn = defaultAgent(db), limit = 100): Promise<StageReport> {
  const r = rep("normalize");
  const problems = await db.problem.findMany({ select: { id: true, nameAr: true } });
  const cands = await db.candidate.findMany({ where: { deletedAt: null, category: null, status: { in: ["new", "scanned", "held"] } }, orderBy: { createdAt: "asc" }, take: limit });
  for (const c of cands) {
    const out = (await agent("H01", { title_src: c.titleSrc, lang: /[一-鿿]/.test(c.titleSrc) ? "zh" : /[؀-ۿ]/.test(c.titleSrc) ? "ar" : "en", image_caption: "غير متوفر", problems }, candRef(c.id))) as { title_ar: string; problem_id: string | null; category: string | null } | null;
    if (!out) {
      r.skipped += 1;
      continue;
    }
    // المشكلة من الخريطة بس (أو null)
    const problemId = out.problem_id && problems.some((p) => p.id === out.problem_id) ? out.problem_id : (problems.find((p) => p.nameAr === out.problem_id)?.id ?? null);
    await db.candidate.update({ where: { id: c.id }, data: { titleAr: out.title_ar.trim() || c.titleAr, problemId: problemId ?? c.problemId, category: out.category?.trim() || "غير مصنّف" } });
    r.processed += 1;
  }
  return r;
}

// ───── 2. الدمج: بصمة الصورة + تشابه العنوان بحدود الإعدادات، والرمادي للحَكَم H02 ─────
export async function runDedupe(db: PrismaClient, agent: AgentFn = defaultAgent(db), cfgOverride?: DedupeConfig): Promise<StageReport> {
  const r = rep("dedupe");
  const m = await settingsMap(db);
  const cfg = cfgOverride ?? dedupeConfigFrom((k) => rawOf(m.get(k)));
  // بنحمّل المرشحين مرة وحدة (مش استعلام لكل مرشح جديد): الأقدم هو اللي بيضل، والجديد بينضم إله
  const all = await db.candidate.findMany({
    where: { deletedAt: null, status: { notIn: ["archived", "rejected"] } },
    include: { images: { select: { phash: true } } },
    orderBy: { createdAt: "asc" },
    take: 5000,
  });
  const gone = new Set<string>();
  for (const n of all.filter((c) => c.status === "new")) {
    if (gone.has(n.id)) continue;
    for (const o of all) {
      if (o.id === n.id || gone.has(o.id) || o.createdAt.getTime() > n.createdAt.getTime()) continue;
      const titleSim = Math.max(titleSimilarity(n.titleSrc, o.titleSrc), titleSimilarity(n.titleAr, o.titleAr), titleSimilarity(n.titleSrc, o.titleAr));
      let dist: number | null = null;
      for (const a of n.images) for (const b of o.images) if (a.phash && b.phash) dist = Math.min(dist ?? 64, hamming(a.phash, b.phash));
      const d = dedupeDecision({ phashDistance: dist, titleSim }, cfg);
      if (d.verdict === "different") continue;
      if (d.verdict === "same") {
        await mergeCandidates(db, n.id, o.id, "system", d.reason);
        gone.add(n.id);
        bump(r, "merged");
        r.processed += 1;
        break;
      }
      // رمادي: الحَكَم H02. واقف أو مش متأكد = بيضل منفصل.
      bump(r, "grey");
      const j = (await agent("H02", { a: { title: n.titleAr, title_src: n.titleSrc, lane: n.lane }, b: { title: o.titleAr, title_src: o.titleSrc, lane: o.lane }, scores: { phash_distance: dist, title_similarity: Number(titleSim.toFixed(2)) } }, candRef(n.id))) as { same: boolean; confidence: string } | null;
      if (j?.same && j.confidence !== "low") {
        await mergeCandidates(db, n.id, o.id, "system", `الحَكَم H02: ${d.reason}`);
        gone.add(n.id);
        bump(r, "merged_by_judge");
        r.processed += 1;
        break;
      }
      bump(r, j ? "kept_separate" : "judge_unavailable");
    }
  }
  return r;
}

// ───── 3. الحساب بالكود: مؤشر السرعة (والحمض إذا في ملف) لكل مرشح حي ─────
export async function runCompute(db: PrismaClient): Promise<StageReport> {
  const r = rep("compute");
  const cfg = await loadCoreConfig(db);
  const { model } = await currentModel(db);
  const cands = await db.candidate.findMany({ where: { deletedAt: null, status: { notIn: ["archived", "rejected", "launched", "failed"] } }, include: { observations: true } });
  for (const c of cands) {
    if (c.observations.length === 0) {
      r.skipped += 1;
      continue;
    }
    const velocity = computeVelocity(aggregateSignals(c.observations), cfg.velocity);
    const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } } });
    const dna = profile ? dnaScore(profile.traitsJson as Traits, model) : null;
    await saveVelocity(db, c.id, velocity, { dna: dna ?? {}, similarity: {} });
    if (dna?.score != null) await db.candidate.update({ where: { id: c.id }, data: { dnaScore: dna.score } });
    r.processed += 1;
    bump(r, velocity.insufficient ? "insufficient" : "scored");
  }
  return r;
}

// ───── 4. الماسح A06: يكمل · يستنى · يوقف (الوقف = ما بيصعد اليوم، مش رفض نهائي) ─────
export async function runScanner(db: PrismaClient, agent: AgentFn = defaultAgent(db)): Promise<StageReport> {
  const r = rep("scanner");
  const cands = await db.candidate.findMany({ where: { deletedAt: null, status: { in: ["new", "scanned"] } }, include: { observations: true, problem: true }, orderBy: { createdAt: "asc" }, take: 1000 });
  for (const c of cands) {
    const sig = aggregateSignals(c.observations);
    const intent = sig.commentSample && sig.commentSample >= 50 && typeof sig.intentComments === "number" ? Number((sig.intentComments / sig.commentSample).toFixed(3)) : "غير مقاس";
    const out = (await agent("A06", { title_ar: c.titleAr, problem: c.problem?.nameAr ?? "غير مطابق", image_caption: "غير متوفر", lane: c.lane, trend_age_days: sig.trendAgeDays ?? "غير مقاس", intent_ratio: intent }, candRef(c.id))) as { verdict: "continue" | "hold" | "stop"; reason: string } | null;
    if (!out) {
      r.skipped += 1;
      continue;
    }
    let status = c.status;
    if (status === "new") {
      await move(db, c.id, "new", "scanned");
      status = "scanned";
    }
    if (out.verdict === "continue") await move(db, c.id, "scanned", "shortlisted", { decisionReason: null });
    else await move(db, c.id, "scanned", "held", { decisionReason: `${out.verdict === "stop" ? "الماسح: يوقف" : "الماسح: يستنى"} — ${out.reason}` });
    bump(r, out.verdict);
    r.processed += 1;
  }
  return r;
}

// ───── 5. المحقق A07: أعلى N (30) من القائمة القصيرة بس، ولا أكتر ─────
export async function runVerifier(db: PrismaClient, agent: AgentFn = defaultAgent(db)): Promise<StageReport> {
  const r = rep("verifier");
  const m = await settingsMap(db);
  const n = topN(m, "pipeline.verifier_top_n", 30);
  const cfg = await loadCoreConfig(db);
  const { model } = await currentModel(db);
  const refs = (await listReferences(db)).filter((x) => x.state === "approved");
  const cands = await db.candidate.findMany({ where: { deletedAt: null, status: "shortlisted" }, orderBy: [{ velocityScore: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }], take: n, include: { observations: true } });
  for (const c of cands) {
    const sig = aggregateSignals(c.observations);
    const velocity = computeVelocity(sig, cfg.velocity);
    const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } } });
    const traits = (profile?.traitsJson ?? {}) as Traits;
    const dna = profile ? dnaScore(traits, model) : null;
    const closest = profile ? rankReferences(traits, refs.map((x) => ({ id: x.id, name: x.name, traits: x.traits })))[0] : null;
    const out = (await agent("A07", {
      observations: c.observations.slice(0, 20).map((o) => ({ id: o.id, source: o.source, url: o.url, captured_at: o.capturedAt.toISOString().slice(0, 10), trust: o.trust })),
      velocity: { score: velocity.score, insufficient: velocity.insufficient, signals: velocity.signals.map((s) => ({ key: s.key, raw: s.raw, score: s.score, weight: s.weight })) },
      dna: { score: dna?.score ?? null, closest: closest?.name ?? null },
      economics: null,
      readiness: null,
      traits: { filled: traits, missing: dna?.missing ?? [] },
    }, candRef(c.id))) as { traits_filled: { trait: string; value: string; why: string }[]; opinion: InvestigatorOpinion } | null;
    if (!out) {
      r.skipped += 1;
      continue;
    }
    // صفات الحمض الناقصة: بقيم مسموحة بس (القيمة الغلط بتنتجاهل)
    const filled: Record<string, string> = {};
    for (const t of out.traits_filled ?? []) {
      try {
        Object.assign(filled, validateTraits({ [t.trait]: t.value }));
      } catch {
        bump(r, "ignored_trait");
      }
    }
    if (Object.keys(filled).length) {
      const merged = { ...traits, ...filled };
      await db.dnaProfile.upsert({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } }, create: { ownerType: "candidate", ownerId: c.id, traitsJson: merged as never, filledBy: "A07" }, update: { traitsJson: merged as never, filledBy: "A07" } });
    }
    await move(db, c.id, "shortlisted", "verified");
    bump(r, `opinion_${out.opinion}`);
    r.processed += 1;
  }
  bump(r, "limit", n);
  return r;
}

// ───── 6. الفحص المبدئي: A08 وA09 وA10 وA11 المبدئي على أعلى 15 من المتحقَّق منهم ─────
export async function runScreen(db: PrismaClient, agent: AgentFn = defaultAgent(db)): Promise<StageReport> {
  const r = rep("screen");
  const m = await settingsMap(db);
  const n = topN(m, "pipeline.screen_top_n", 15);
  const cfg = await loadCoreConfig(db);
  const refs = (await listReferences(db)).filter((x) => x.state === "approved");
  const { model } = await currentModel(db);
  const cands = await db.candidate.findMany({ where: { deletedAt: null, status: "verified" }, orderBy: [{ velocityScore: { sort: "desc", nulls: "last" } }], take: n, include: { observations: true } });
  for (const c of cands) {
    const sig = aggregateSignals(c.observations);
    const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } } });
    if (profile) {
      const traits = profile.traitsJson as Traits;
      const dna = dnaScore(traits, model);
      await agent("A08", { candidate_traits: traits, references: refs.map((x) => ({ name: x.name, traits: x.traits })), scores: { dna: dna.score, parts: dna.parts.map((p) => ({ trait: p.trait, weight: Number(p.weight.toFixed(3)), ratio: Number(p.ratio.toFixed(3)) })) } }, candRef(c.id));
      bump(r, "a08");
    }
    const unit = minUsdPrice(c.observations);
    const econ = await economicsFor(db, c.id, unit, cfg);
    if (econ) {
      await agent("A09", { economics: econ, competitor_prices: unit === null ? [] : [{ source: "السوق", price_usd: unit }], market: cfg.market.code, offer_mix: "60% · 30% · 10%" }, candRef(c.id));
      bump(r, "a09");
    }
    await agent("A10", { market: cfg.market.code, whitespace: whitespaceFactor(sig.advertisersInMarket ?? null), search_trend: "unknown", local_prices: [], logistics: null, regulatory: null, angle: null }, candRef(c.id));
    bump(r, "a10");
    // الامتثال المبدئي (A11 بعد فحوصات الكود). الوكيل متوقف = الكود لحاله. ما بنعيد فحص مرشح ما تغيّرت المكتبات من آخر فحص.
    const asRunner: AgentRunner = async (_db, code, vars, o) => {
      const out = await agent(code, vars, o?.inputRef ?? candRef(c.id));
      if (out === null) throw new AgentRunError("gateway", "الوكيل ما رجّع نتيجة");
      return { output: out };
    };
    const comp = await screenCandidate(db, c.id, { runAgent: asRunner });
    if (comp) bump(r, `compliance_${comp.verdict}`);
    r.processed += 1;
  }
  bump(r, "limit", n);
  return r;
}

// الاقتصاد للمرشح: بس لما كل المدخلات معروفة (تكلفة مرجعية من سعر السوق، وأجرة التوصيل ونسبة المرتجع من إعدادات السوق). الناقص = null (مش تخمين).
export async function economicsFor(_db: PrismaClient, _candidateId: string, unitCostUsd: number | null, cfg: Awaited<ReturnType<typeof loadCoreConfig>>) {
  const m = cfg.market;
  if (unitCostUsd === null || m.deliveryFee === null || m.defaultReturn === null) return null;
  try {
    const p = projectEconomics({ unitCostUsd: unitCostUsd.toFixed(2), offers: [{ qty: 1, price: (unitCostUsd * 9).toFixed(2), share: 1 }], deliveryFee: m.deliveryFee, returnFee: m.returnFee ?? 0, returnRate: m.defaultReturn, safetyMargin: m.safetyMargin });
    return { cpaCeiling: p.cpaCeiling, lossLimit: p.lossLimit, scalingCeiling: p.scalingCeiling, note: "تقدير: السعر افتراضي 9 أضعاف السعر المرجعي، عدّله من الحاسبة" };
  } catch {
    return null;
  }
}

// ───── 7. تجميع البطاقات: قرار القواعد + رأي المحقق + علامة «تعارض» ─────
export interface CardNumbers {
  velocity: ReturnType<typeof computeVelocity>;
  dna: ReturnType<typeof dnaScore> | null;
  creators: number | null;
}

export async function investigatorOpinion(db: PrismaClient, candidateId: string): Promise<{ opinion: InvestigatorOpinion; reason: string; risks: string[] } | null> {
  const run = await db.agentRun.findFirst({ where: { agentCode: "A07", inputRef: candRef(candidateId), status: "ok" }, orderBy: { createdAt: "desc" } });
  const o = run?.outputJson as { opinion?: InvestigatorOpinion; reason?: string; risks?: string[] } | null;
  return o?.opinion ? { opinion: o.opinion, reason: o.reason ?? "", risks: o.risks ?? [] } : null;
}

export async function assembleCards(db: PrismaClient): Promise<StageReport> {
  const r = rep("cards");
  const cfg = await loadCoreConfig(db);
  const { model } = await currentModel(db);
  const cands = await db.candidate.findMany({ where: { deletedAt: null, status: { in: ["shortlisted", "verified", "watching", "held", "scanned"] } }, include: { observations: true } });
  for (const c of cands) {
    if (c.observations.length === 0) continue;
    const sig = aggregateSignals(c.observations);
    const velocity = computeVelocity(sig, cfg.velocity);
    const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: c.id } } });
    const dna = profile ? dnaScore(profile.traitsJson as Traits, model) : null;
    const econ = await economicsFor(db, c.id, minUsdPrice(c.observations), cfg);
    const hits = evaluateReject({ lane: c.lane, creators: creatorsTotal(c.observations), trendAgeDays: sig.trendAgeDays, cumulativeSales: sig.cumulativeSales, expectedPerShipment: econ ? parseFloat(econ.lossLimit) : null }, cfg.reject);
    const readiness = assessReadiness([whitespaceFactor(sig.advertisersInMarket ?? null)]);
    const inv = await investigatorOpinion(db, c.id);
    const comp = await latestCheck(db, c.id);
    const d = decide({ rejectHits: hits, velocity: velocity.score, dna: dna?.score ?? null, cpaCeiling: econ ? parseFloat(econ.cpaCeiling) : null, complianceVerdict: comp ? comp.effective : null, readiness: readiness.verdict, investigator: inv?.opinion ?? null }, cfg.decision);
    const mapped = d.decision === "reject_auto" || d.decision === "reject" ? "reject" : d.decision === "watch" ? "watch" : "deep_research";
    await db.candidate.update({
      where: { id: c.id },
      data: { velocityScore: velocity.score, dnaScore: dna?.score ?? null, decisionSuggested: mapped, decisionReason: `${d.decision}: ${d.reasons.join(" · ")}`, conflictFlag: d.conflict, outsideDna: d.decision === "deep_research_outside_dna" },
    });
    bump(r, d.decision);
    if (d.conflict) bump(r, "conflict");
    r.processed += 1;
  }
  return r;
}
