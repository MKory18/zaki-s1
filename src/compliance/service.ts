// تشغيل بوابة الامتثال على مرشح: الفحوصات الثمانية بالكود، رأي A11، الحفظ بجدول ComplianceCheck، وقرار المراجع.
// الوكيل بيزوّد وما بيخفّف. الرفض بالكود ما بينقلب بقرار إنسان. أي تغيير بالحكم بيطلق compliance.updated.
import type { PrismaClient } from "@/generated/prisma/client";
import { AgentRunError } from "@/agents/runner";
import { runAgent } from "@/agents/service";
import {
  agentUnavailable, applyAgent, assertReviewAllowed, effectiveVerdict, ReviewRefused, runCodeChecks,
  type AgentOpinion, type Classification, type ComplianceInput, type ComplianceResult, type Library, type Verdict,
} from "@/core/compliance";
import { loadCoreConfig } from "@/core/config";
import { badRequest, notFound, refused, str } from "./errors";
import { emitEvent } from "./events";

export type AgentRunner = (db: PrismaClient, code: string, vars: Record<string, unknown>, opts?: { inputRef?: string }) => Promise<{ output: unknown }>;

export const checkRef = (candidateId: string) => `cand:${candidateId}`;
const VERDICTS: readonly Verdict[] = ["pass", "pass_with_edits", "needs_specialist", "fail"];
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "name" in x ? String((x as { name: unknown }).name) : "")).map((s) => s.trim()).filter(Boolean) : []);

export async function loadLibrary(db: PrismaClient, productRefs: string[]): Promise<Library> {
  const [claims, ingredients, texts, adRules, licenses] = await Promise.all([
    db.claimRule.findMany({ where: { deletedAt: null } }),
    db.ingredient.findMany({ where: { deletedAt: null } }),
    db.referenceText.findMany({ where: { deletedAt: null } }),
    db.adPolicyRule.findMany(),
    db.license.findMany({ where: { deletedAt: null, productRef: { in: productRefs } } }),
  ]);
  return {
    claims: claims.map((c) => ({ id: c.id, phrase: c.phrase, reason: c.reason, alternative: c.alternative, appliesTo: c.appliesTo, country: c.country })),
    ingredients: ingredients.map((i) => ({ id: i.id, nameAr: i.nameAr, nameEn: i.nameEn, status: i.status, note: i.note, adulterationRisk: i.adulterationRisk })),
    texts: texts.map((t) => ({ code: t.code, ingredient: t.ingredient, text: t.text, reviewStatus: t.reviewStatus, usageRule: t.usageRule })),
    adRules: adRules.map((r) => ({ rule: r.rule, wrongExample: r.wrongExample, rightExample: r.rightExample, lastReviewedAt: r.lastReviewedAt })),
    licenses: licenses.map((l) => ({ country: l.country, status: l.status, expiresAt: l.expiresAt })),
  };
}

/** آخر تعديل بأي مكتبة امتثال (لتجنّب إعادة الفحص إذا ما تغيّر شي). */
export async function libraryStamp(db: PrismaClient): Promise<Date> {
  const [a, b, c, d] = await Promise.all([
    db.claimRule.aggregate({ _max: { updatedAt: true } }),
    db.ingredient.aggregate({ _max: { updatedAt: true } }),
    db.referenceText.aggregate({ _max: { updatedAt: true } }),
    db.adPolicyRule.aggregate({ _max: { updatedAt: true } }),
  ]);
  return new Date(Math.max(0, ...[a, b, c, d].map((x) => x._max.updatedAt?.getTime() ?? 0)));
}

export interface RunOptions {
  stage: "screen" | "full";
  claims?: string[];
  ingredients?: string[];
  references?: { code: string; usage?: string }[];
  markets?: string[];
  declaredClass?: "cosmetic" | "therapeutic" | null;
  organicCertificate?: boolean;
}
export interface RunDeps {
  runAgent?: AgentRunner;
  now?: Date;
}
export interface RunOutcome {
  id: string;
  candidateId: string;
  stage: "screen" | "full";
  verdict: Verdict;
  effective: Verdict;
  classification: Classification;
  result: ComplianceResult;
  changed: boolean;
}

// ملف المنتج (إذا موجود) بيعطي مرجع المنتج للتراخيص والدفعات؛ وإلا المرشح نفسه
async function productRefs(db: PrismaClient, candidateId: string): Promise<string[]> {
  const pf = await db.productFile.findFirst({ where: { candidateId, deletedAt: null }, select: { id: true } });
  return pf ? [pf.id, candidateId] : [candidateId];
}

export async function eyeBatchReady(db: PrismaClient, refs: string[]): Promise<boolean> {
  const n = await db.batch.count({ where: { productRef: { in: refs }, deletedAt: null, status: "released", sterile: true } });
  return n > 0;
}

async function buildInput(db: PrismaClient, candidateId: string, o: RunOptions, now: Date): Promise<{ input: ComplianceInput; refs: string[] }> {
  const c = await db.candidate.findFirst({ where: { id: candidateId, deletedAt: null }, include: { problem: { select: { nameAr: true } } } });
  if (!c) throw notFound("المرشح مش موجود");
  const refs = await productRefs(db, candidateId);
  const pf = await db.productFile.findFirst({ where: { candidateId, deletedAt: null }, select: { id: true } });
  const brief = pf ? await db.formulationBrief.findFirst({ where: { productFileId: pf.id, deletedAt: null }, orderBy: { createdAt: "desc" } }) : null;
  const markets = o.markets?.length ? o.markets : [(await loadCoreConfig(db)).market.code];
  return {
    refs,
    input: {
      stage: o.stage,
      product: { title: c.titleAr, problem: c.problem?.nameAr ?? null, category: c.category, form: brief?.form ?? null },
      ingredients: o.ingredients ?? strings(brief?.ingredientsJson),
      claims: o.claims ?? strings(brief?.allowedClaims),
      references: o.references ?? [],
      markets,
      declaredClass: o.declaredClass ?? null,
      organicCertificate: Boolean(o.organicCertificate),
      eyeBatchReady: await eyeBatchReady(db, refs),
      now,
    },
  };
}

function asOpinion(v: unknown): AgentOpinion | null {
  const o = v as Partial<AgentOpinion> | null;
  if (!o || typeof o !== "object" || !VERDICTS.includes(o.verdict as Verdict)) return null;
  const cls = o.classification;
  return {
    classification: cls === "cosmetic" || cls === "therapeutic" ? cls : "needs_review",
    classification_reason: String(o.classification_reason ?? ""),
    claims: Array.isArray(o.claims) ? o.claims.filter((c) => c && typeof c.text === "string") : [],
    references: Array.isArray(o.references) ? o.references.filter((r) => r && typeof r.code === "string") : [],
    ingredients: Array.isArray(o.ingredients) ? o.ingredients.filter((i) => i && typeof i.name === "string") : [],
    organic_ok: typeof o.organic_ok === "boolean" ? o.organic_ok : null,
    eye_product: Boolean(o.eye_product),
    license_needed: Array.isArray(o.license_needed) ? o.license_needed.filter((l) => l && typeof l.country === "string") : [],
    ad_rules: Array.isArray(o.ad_rules) ? o.ad_rules.map(String) : [],
    verdict: o.verdict as Verdict,
    reasons: Array.isArray(o.reasons) ? o.reasons.map(String) : [],
  };
}

const defaultRunner: AgentRunner = (db, code, vars, opts) => runAgent(db, code, vars, opts);

export async function runCompliance(db: PrismaClient, candidateId: string, opts: RunOptions, deps: RunDeps = {}): Promise<RunOutcome> {
  if (opts.stage !== "screen" && opts.stage !== "full") throw badRequest("المرحلة: screen أو full");
  const now = deps.now ?? new Date();
  const { input, refs } = await buildInput(db, candidateId, opts, now);
  const lib = await loadLibrary(db, refs);
  let result = runCodeChecks(input, lib);

  // الوكيل A11: رأيه بيزوّد على الكود بس. متوقف = الكود لحاله (والفحص الكامل بيوقف لقرار مختص)
  const run = deps.runAgent ?? defaultRunner;
  let agentRunId: string | null = null;
  try {
    const approved = lib.texts.filter((t) => t.reviewStatus === "approved").map((t) => ({ code: t.code, text: t.text, usage: t.usageRule ?? "عن المادة" }));
    const r = await run(db, "A11", {
      product: input.product,
      ingredients: input.ingredients,
      claims: input.claims,
      references: input.references,
      markets: input.markets,
      code_checks: { classification: result.classification, verdict: result.verdict, checks: result.checks.map((c) => ({ n: c.n, key: c.key, status: c.status, detail: c.detail })), claims: result.claims, fraud_categories: result.fraud_categories },
      library: approved,
      ad_rules: lib.adRules.map((a) => a.rule),
    }, { inputRef: checkRef(candidateId) });
    const opinion = asOpinion(r.output);
    result = opinion ? applyAgent(result, opinion) : agentUnavailable(result, "رد الوكيل مش بالشكل المطلوب");
    if (opinion) agentRunId = (await db.agentRun.findFirst({ where: { agentCode: "A11", inputRef: checkRef(candidateId), status: "ok" }, orderBy: { createdAt: "desc" }, select: { id: true } }))?.id ?? null;
  } catch (e) {
    if (!(e instanceof AgentRunError)) throw e;
    result = agentUnavailable(result, e.message);
  }

  const prev = await db.complianceCheck.findFirst({ where: { candidateId }, orderBy: { createdAt: "desc" } });
  const row = await db.complianceCheck.create({
    data: { candidateId, stage: opts.stage, classification: result.classification, checksJson: result as never, verdict: result.verdict, reasons: result.reasons as never, agentRunId },
  });
  const was = prev ? effectiveVerdict({ verdict: prev.verdict, humanVerdict: prev.humanVerdict }) : null;
  const changed = was !== result.verdict || prev?.classification !== result.classification;
  if (changed) await emitEvent(db, "compliance.updated", { reason: "check", candidate_id: candidateId, check_id: row.id, stage: opts.stage, verdict: result.verdict, classification: result.classification, updated_at: now.toISOString() }, now);
  return { id: row.id, candidateId, stage: opts.stage, verdict: result.verdict, effective: result.verdict, classification: result.classification, result, changed };
}

// ───── الفحص المبدئي ضمن خط التقييم اليومي: أعلى N، وما بنعيد فحص مرشح ما تغيّر شي بالمكتبات من آخر فحص إلو ─────
export async function screenCandidate(db: PrismaClient, candidateId: string, deps: RunDeps = {}): Promise<RunOutcome | null> {
  const last = await db.complianceCheck.findFirst({ where: { candidateId, stage: "screen" }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
  if (last && last.createdAt.getTime() >= (await libraryStamp(db)).getTime()) return null;
  return runCompliance(db, candidateId, { stage: "screen" }, deps);
}

// ───── آخر فحص + حكمه الفعلي ─────
export async function latestCheck(db: PrismaClient, candidateId: string) {
  const row = await db.complianceCheck.findFirst({ where: { candidateId }, orderBy: [{ stage: "desc" }, { createdAt: "desc" }] });
  if (!row) return null;
  const result = row.checksJson as unknown as ComplianceResult;
  return {
    id: row.id,
    stage: row.stage,
    at: row.createdAt.toISOString(),
    classification: row.classification as Classification | null,
    verdict: row.verdict,
    humanVerdict: row.humanVerdict,
    humanNote: row.humanNote,
    effective: effectiveVerdict({ verdict: row.verdict, humanVerdict: row.humanVerdict }),
    reasons: (Array.isArray(row.reasons) ? row.reasons : []) as string[],
    result,
  };
}

export async function listChecks(db: PrismaClient, candidateId: string, limit = 20) {
  const rows = await db.complianceCheck.findMany({ where: { candidateId }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((r) => ({
    id: r.id, stage: r.stage, at: r.createdAt.toISOString(), classification: r.classification, verdict: r.verdict, humanVerdict: r.humanVerdict, humanNote: r.humanNote,
    effective: effectiveVerdict({ verdict: r.verdict, humanVerdict: r.humanVerdict }), reasons: (Array.isArray(r.reasons) ? r.reasons : []) as string[],
  }));
}

// ───── قرار مراجع الامتثال ─────
export async function reviewCheck(db: PrismaClient, checkId: string, actorId: string, input: { verdict?: unknown; note?: unknown }, now: Date = new Date()) {
  if (typeof input.verdict !== "string" || !VERDICTS.includes(input.verdict as Verdict)) throw badRequest("الحكم: pass · pass_with_edits · needs_specialist · fail");
  const human = input.verdict as Verdict;
  const note = str(input.note, "السبب", { required: true, max: 1000 })!;
  const c = await db.complianceCheck.findUnique({ where: { id: checkId } });
  if (!c) throw notFound("الفحص مش موجود");
  // النصوص المقترحة لازم تكون معتمدة الآن من المراجع الشرعي (مش وقت الفحص)
  const refs = ((c.checksJson as unknown as ComplianceResult).refs ?? []).filter((r) => r.status !== "approved_ok").map((r) => r.code);
  const texts = refs.length ? await db.referenceText.findMany({ where: { code: { in: refs }, deletedAt: null }, select: { code: true, reviewStatus: true } }) : [];
  const pending = refs.filter((code) => texts.find((t) => t.code === code)?.reviewStatus !== "approved");
  try {
    assertReviewAllowed({ verdict: c.verdict }, human, pending);
  } catch (e) {
    if (e instanceof ReviewRefused) throw refused(e.message);
    throw e;
  }
  const u = await db.complianceCheck.update({ where: { id: checkId }, data: { humanVerdict: human, humanReviewerId: actorId, humanNote: note, humanReviewedAt: now } });
  await emitEvent(db, "compliance.updated", { reason: "review", candidate_id: c.candidateId, check_id: c.id, verdict: human, updated_at: now.toISOString() }, now);
  return { id: u.id, candidateId: u.candidateId, verdict: u.verdict, humanVerdict: u.humanVerdict, humanNote: u.humanNote, effective: effectiveVerdict({ verdict: u.verdict, humanVerdict: u.humanVerdict }) };
}

// ───── صناديق المراجعين ─────
export interface TextBoxItem { id: string; code: string; kind: string; ingredient: string | null; text: string; source: string; number: string | null; grading: string | null; reviewStatus: string }
export interface CheckBoxItem { id: string; candidateId: string; title: string; stage: string; verdict: Verdict; classification: string | null; reasons: string[]; at: string }
export async function inbox(db: PrismaClient, box: "texts"): Promise<TextBoxItem[]>;
export async function inbox(db: PrismaClient, box: "claims"): Promise<CheckBoxItem[]>;
export async function inbox(db: PrismaClient, box: "texts" | "claims"): Promise<TextBoxItem[] | CheckBoxItem[]> {
  if (box === "texts") {
    const rows = await db.referenceText.findMany({ where: { deletedAt: null, reviewStatus: { in: ["pending", "needs_specialist"] } }, orderBy: [{ reviewStatus: "desc" }, { code: "asc" }] });
    return rows.map((t) => ({ id: t.id, code: t.code, kind: t.kind, ingredient: t.ingredient, text: t.text, source: t.source, number: t.number, grading: t.grading, reviewStatus: t.reviewStatus }));
  }
  const rows = await db.complianceCheck.findMany({ where: { humanVerdict: null, verdict: { in: ["needs_specialist", "pass_with_edits"] } }, orderBy: { createdAt: "desc" }, take: 300, include: { candidate: { select: { id: true, titleAr: true, deletedAt: true } } } });
  // آخر فحص لكل (مرشح، مرحلة) بس
  const seen = new Set<string>();
  const out: CheckBoxItem[] = [];
  for (const r of rows) {
    const key = `${r.candidateId}:${r.stage}`;
    if (seen.has(key) || r.candidate.deletedAt) continue;
    seen.add(key);
    out.push({ id: r.id, candidateId: r.candidateId, title: r.candidate.titleAr, stage: r.stage, verdict: r.verdict, classification: r.classification, reasons: (Array.isArray(r.reasons) ? r.reasons : []) as string[], at: r.createdAt.toISOString() });
  }
  // لو في فحص أحدث للمرشح نفسه (نفس المرحلة) غير معلّق، القديم ما بيطلع (اتجاوزه فحص جديد)
  const latest = await Promise.all(out.map((o) => db.complianceCheck.findFirst({ where: { candidateId: o.candidateId, stage: o.stage as "screen" | "full" }, orderBy: { createdAt: "desc" }, select: { id: true } })));
  return out.filter((o, i) => latest[i]?.id === o.id);
}
