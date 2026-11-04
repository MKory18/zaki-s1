// خدمة الحمض على القاعدة: المرجعيات (يدوي · من الـ OMS · مقترح بانتظار الاعتماد)، ملفات الحمض، نسخ الأوزان، وتعلّم الأسبوع.
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { getOmsPerformance } from "@/adapters/systems";
import type { OutboxDeps } from "@/adapters/outbox";
import { actualEconomics } from "@/core/economics";
import { dnaScore, learn, rankReferences, validateTraits, type DnaModel, type Sample, type Traits } from "@/core/dna";
import { loadDnaConfig } from "@/core/dna-config";
import { raiseAlert } from "@/lib/alerts";

export class DnaError extends Error {
  constructor(public code: "not_found" | "bad_request", message: string) {
    super(message);
  }
}

// ───── المرجعيات ─────
export type ReferenceState = "pending" | "approved";

export async function listReferences(db: PrismaClient) {
  const rows = await db.dnaReference.findMany({ where: { deletedAt: null }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    origin: r.origin,
    productRef: r.productRef,
    traits: r.traitsJson as Traits,
    performance: r.performanceJson,
    state: (r.active ? "approved" : "pending") as ReferenceState,
    approvedBy: r.approvedBy,
  }));
}

// منتج رابح بيعطيه المالك أو الباحث: بيدخل «بانتظار الاعتماد» وبيصير مرجع بعد اعتماده (active)
export async function addManualReference(db: PrismaClient, input: { name: string; traits: Record<string, unknown>; productRef?: string }) {
  const name = input.name?.trim();
  if (!name) throw new DnaError("bad_request", "اسم المرجع ناقص");
  let traits: Traits;
  try {
    traits = validateTraits(input.traits ?? {});
  } catch (e) {
    throw new DnaError("bad_request", e instanceof Error ? e.message : "صفات غلط");
  }
  return db.dnaReference.create({ data: { name, origin: "manual", productRef: input.productRef ?? null, traitsJson: traits as never, active: false } });
}

export async function setReferenceState(db: PrismaClient, id: string, action: "approve" | "reject", actor: string) {
  const r = await db.dnaReference.findFirst({ where: { id, deletedAt: null } });
  if (!r) throw new DnaError("not_found", "المرجع مش موجود");
  if (action === "approve") return db.dnaReference.update({ where: { id }, data: { active: true, approvedBy: actor } });
  return db.dnaReference.update({ where: { id }, data: { active: false, deletedAt: new Date() } }); // رفض = حذف ناعم
}

// ───── ملف الحمض لمنتج مختبر (بيتعبّى بالمنتج الحي، وبيتعلّم منه الحمض) ─────
export async function setProfile(db: PrismaClient, ownerType: "product" | "candidate" | "reference", ownerId: string, traitsIn: Record<string, unknown>, filledBy: string) {
  let traits: Traits;
  try {
    traits = validateTraits(traitsIn);
  } catch (e) {
    throw new DnaError("bad_request", e instanceof Error ? e.message : "صفات غلط");
  }
  return db.dnaProfile.upsert({
    where: { ownerType_ownerId: { ownerType, ownerId } },
    create: { ownerType, ownerId, traitsJson: traits as never, filledBy },
    update: { traitsJson: traits as never, filledBy },
  });
}

// ───── نسخ الأوزان ─────
export interface WeightSetView {
  version: number;
  learnedAt: string;
  productsCount: number;
  model: DnaModel;
  explanation: string | null;
}

export async function listWeightSets(db: PrismaClient, limit = 20) {
  const rows = await db.dnaWeightSet.findMany({ orderBy: { version: "desc" }, take: limit });
  return rows.map((r) => ({ version: r.version, learnedAt: r.learnedAt.toISOString(), productsCount: r.productsCount }));
}

async function latestSet(db: PrismaClient): Promise<WeightSetView | null> {
  const r = await db.dnaWeightSet.findFirst({ orderBy: { version: "desc" } });
  if (!r) return null;
  const sizes = r.sampleSizesJson as unknown as { model: DnaModel; explanation?: string | null };
  return { version: r.version, learnedAt: r.learnedAt.toISOString(), productsCount: r.productsCount, model: sizes.model, explanation: sizes.explanation ?? null };
}

// النموذج الحالي: آخر نسخة أوزان، أو الافتراضي (ن = 0) قبل أي تعلّم
export async function currentModel(db: PrismaClient): Promise<{ model: DnaModel; version: number | null }> {
  const set = await latestSet(db);
  if (set) return { model: set.model, version: set.version };
  return { model: learn([], await loadDnaConfig(db)), version: null };
}

export interface LearnReport {
  version: number;
  products: number;
  skippedNoProfile: number;
  successes: number;
  proposedReferences: number;
  explanation: string | null;
}

// المهمة الأسبوعية (السبت 23:00): بتسحب أداء الـ OMS، بتعلّم الناجح والخاسر من أرقامه، وبتحفظ نسخة أوزان جديدة.
// فشل الـ OMS: بتضل آخر نسخة فعّالة (بيرمي الخطأ والتنبيه من المحوّل).
export async function runLearning(db: PrismaClient, deps: OutboxDeps & { explain?: (m: DnaModel, prev: DnaModel | null) => Promise<string | null> } = {}): Promise<LearnReport> {
  const today = new Date().toISOString().slice(0, 10);
  const perf = await getOmsPerformance(db, { from: "2020-01-01", to: today }, deps);
  const cfg = await loadDnaConfig(db);

  const samples: Sample[] = [];
  let skipped = 0;
  let proposed = 0;
  for (const it of perf.items) {
    const profile = await db.dnaProfile.findUnique({ where: { ownerType_ownerId: { ownerType: "product", ownerId: it.external_ref } } });
    // الناجح من أرقام الـ OMS بس (ربح الطلب المُسلَّم > 0)، مش من اللايكات
    const actual = actualEconomics({
      adSpend: it.ad_spend, orders: it.orders, confirmed: it.confirmed, shipped: it.shipped, delivered: it.delivered, returned: it.returned,
      collected: it.collected, deliveryFees: it.delivery_fees, returnFees: it.return_fees, cogsDelivered: it.cogs_delivered,
    });
    if (!profile) {
      skipped += 1;
      continue;
    }
    const traits = profile.traitsJson as Traits;
    samples.push({ traits, success: actual.success });
    // منتج ناجح بلا مرجع: بنقترحه («مقترح بانتظار الاعتماد»)، وإنت بتقرر
    if (actual.success) {
      const exists = await db.dnaReference.findFirst({ where: { productRef: it.external_ref, deletedAt: null } });
      if (!exists) {
        await db.dnaReference.create({
          data: { name: it.name, origin: "oms", productRef: it.external_ref, traitsJson: traits as never, performanceJson: { source: "oms", profitPerDelivered: actual.profitPerDelivered, returnRate: actual.returnRate } as never, active: false },
        });
        proposed += 1;
      }
    }
  }

  const prev = await latestSet(db);
  const model = learn(samples, cfg);
  let explanation: string | null = null;
  if (deps.explain) {
    try {
      explanation = await deps.explain(model, prev?.model ?? null);
    } catch {
      explanation = null; // الشرح اختياري (A05): فشله ما بيوقف التعلّم
    }
  }
  const last = await db.dnaWeightSet.findFirst({ orderBy: { version: "desc" } });
  const version = (last?.version ?? 0) + 1;
  await db.dnaWeightSet.create({
    data: {
      version,
      weightsJson: Object.fromEntries(Object.values(model.traits).map((t) => [t.id, t.finalWeight])) as never,
      priorsJson: cfg.points as never,
      sampleSizesJson: { model, explanation, skippedNoProfile: skipped } as never,
      productsCount: samples.length,
    },
  });
  if (skipped > 0) raiseAlert({ type: "dna_missing_profiles", severity: "info", message: `تعلّم الحمض: ${skipped} منتج من الـ OMS بلا ملف حمض، ما دخلوا بالحساب` });
  return { version, products: samples.length, skippedNoProfile: skipped, successes: samples.filter((s) => s.success).length, proposedReferences: proposed, explanation };
}

// ───── درجة مرشح وأقرب مرجع ─────
export async function scoreTraits(db: PrismaClient, traitsIn: Record<string, unknown>, sims: Record<string, { textSim?: number | null; imageSim?: number | null }> = {}) {
  let traits: Traits;
  try {
    traits = validateTraits(traitsIn);
  } catch (e) {
    throw new DnaError("bad_request", e instanceof Error ? e.message : "صفات غلط");
  }
  const { model, version } = await currentModel(db);
  const cfg = await loadDnaConfig(db);
  const score = dnaScore(traits, model);
  const refs = (await listReferences(db)).filter((r) => r.state === "approved");
  const ranked = rankReferences(traits, refs.map((r) => ({ id: r.id, name: r.name, traits: r.traits, ...(sims[r.id] ?? {}) })), cfg.simWeights);
  return { weightsVersion: version, score, closest: ranked[0] ?? null, references: ranked };
}

export { Prisma };
