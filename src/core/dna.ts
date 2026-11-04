// نواة الحمض (docs/01-logic.md الجزء الرابع، قسم 1 و3 و4). كل الحساب هون، وكل وزن بحجم عيّنته.
// الحمض بيوصي وما بيقرر. المنتج «ناجح» بس من أرقام الـ OMS.
import { D } from "./num";

// الصفات اللي بتتحسب بدرجة الحمض: المعرّف ← الاسم والقيم المسموحة. القيم والنقاط الافتراضية بتنقرا من ملف البذور (dna.points).
export const SCORED_TRAITS = [
  { id: "problem_clarity", label: "وضوح المشكلة", attr: "وضوح المشكلة", values: ["عالي", "متوسط", "ضعيف"] },
  { id: "result_speed", label: "سرعة النتيجة", attr: "سرعة النتيجة", values: ["أيام", "أسابيع", "أشهر"] },
  { id: "repeat", label: "التكرار", attr: "التكرار", values: ["بيخلص وبينطلب", "مرة وحدة"] },
  { id: "cost_tier", label: "شريحة التكلفة", attr: "شريحة التكلفة", values: ["أقل من 2.5$", "2.5–5$", "فوق 5$"] },
  { id: "demo", label: "قابلية العرض بالفيديو", attr: "قابلية العرض", values: ["نتيجة بتنشاف", "تجربة حسية", "شرح", "صعب"] },
  { id: "heritage", label: "الزاوية التراثية أو الدينية", attr: "الزاوية", values: ["نص نبوي", "قرآن", "تراث بلد", "بلا"] },
  { id: "embarrassing", label: "المشكلة مخجلة", attr: "مخجلة", values: ["نعم", "لا"] },
  { id: "visible", label: "المشكلة بتنشاف", attr: "بتنشاف", values: ["نعم", "لا"] },
  { id: "logistics", label: "اللوجستيات", attr: "اللوجستيات", values: ["كريم أو صلب", "سائل", "جهاز", "هش أو حساس للحرارة"] },
  { id: "regulatory", label: "الحساسية التنظيمية", attr: "الحساسية التنظيمية", values: ["تجميلي", "يحتاج تسجيل", "مقيّد إعلانياً"] },
] as const;

export type TraitId = (typeof SCORED_TRAITS)[number]["id"];
export const TRAIT_IDS = SCORED_TRAITS.map((t) => t.id) as TraitId[];

// صفات بملف المنتج بس مش بالدرجة (بتتعبّى وبتنعرض)
export const EXTRA_TRAITS = {
  category: ["تجميل", "عناية", "علاجي يحتاج تسجيل", "جهاز", "غيره"],
  seasonality: ["رمضان", "صيف", "شتاء", "أعياد", "طول السنة"],
} as const;

export type Traits = Partial<Record<TraitId | "category" | "seasonality", string>> & { consumption_days?: number };

export class TraitError extends Error {}

// بيتأكد إن كل قيمة من القيم المسموحة بالضبط (ولا صفة مجهولة)
export function validateTraits(traits: Record<string, unknown>): Traits {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(traits)) {
    if (v === null || v === undefined || v === "" || v === "—") continue; // مش معبّاة
    const scored = SCORED_TRAITS.find((t) => t.id === k);
    if (scored) {
      if (!(scored.values as readonly string[]).includes(String(v))) throw new TraitError(`قيمة «${v}» مش مسموحة لصفة «${scored.label}» (المسموح: ${scored.values.join(" · ")})`);
      out[k] = String(v);
    } else if (k === "category" || k === "seasonality") {
      if (!(EXTRA_TRAITS[k] as readonly string[]).includes(String(v))) throw new TraitError(`قيمة «${v}» مش مسموحة لصفة «${k === "category" ? "الفئة" : "الموسمية"}»`);
      out[k] = String(v);
    } else if (k === "consumption_days") {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) throw new TraitError("مدة الاستهلاك لازم عدد أيام صحيح موجب");
      out[k] = n;
    } else throw new TraitError(`صفة مجهولة: ${k}`);
  }
  return out as Traits;
}

// شريحة التكلفة بيحسبها الكود من تكلفة الوحدة بالدولار
export function costTierOf(unitCostUsd: number): string {
  return unitCostUsd < 2.5 ? "أقل من 2.5$" : unitCostUsd <= 5 ? "2.5–5$" : "فوق 5$";
}

// ───── النموذج: وزن لكل صفة + نسبة نجاح لكل قيمة ─────
export interface ValueStat {
  value: string;
  count: number; // منتجات مختبرة بهالقيمة
  successes: number; // الناجحين منهم
  rate: number; // نسبة النجاح (مع النقاط الافتراضية)
  small: boolean; // «عيّنة صغيرة»: أقل من الحد (3)
}

export interface TraitModel {
  id: TraitId;
  label: string;
  defaultWeight: number;
  learnedWeight: number;
  confidence: number; // المعروف ÷ (المعروف + 10)
  finalWeight: number;
  known: number; // منتجات معروفة قيمة هالصفة فيها
  values: ValueStat[];
}

export interface DnaModel {
  products: number; // ن: المنتجات المختبرة
  traits: Record<TraitId, TraitModel>;
}

export interface DnaConfig {
  /** نقاط افتراضية 0..1 لكل قيمة */
  points: Record<TraitId, Record<string, number>>;
  /** أوزان افتراضية لكل صفة */
  weights: Record<TraitId, number>;
  confidenceK: number; // 10
  blendK: number; // 10
  smallSample: number; // 3
  simWeights: [number, number, number]; // نص · صورة · صفات
}

export interface Sample {
  traits: Traits;
  success: boolean; // من أرقام الـ OMS (ربح الطلب المُسلَّم > 0)
}

// نسبة النجاح لقيمة صفة = (الناجحين + 2 × النقاط الافتراضية) ÷ (المنتجات + 2)
export function successRate(successes: number, count: number, defaultPoint: number): number {
  return D(successes).plus(D(defaultPoint).times(2)).div(D(count).plus(2)).toNumber();
}

// النموذج قبل أي تجربة: النقاط الافتراضية هي اللي بتحكم (ن = 0)
export function learn(samples: Sample[], cfg: DnaConfig): DnaModel {
  const n = samples.length;
  const traits = {} as Record<TraitId, TraitModel>;
  for (const t of SCORED_TRAITS) {
    const stats: ValueStat[] = t.values.map((value) => {
      const withValue = samples.filter((s) => s.traits[t.id] === value);
      const successes = withValue.filter((s) => s.success).length;
      const def = cfg.points[t.id]?.[value] ?? 0;
      return { value, count: withValue.length, successes, rate: successRate(successes, withValue.length, def), small: withValue.length < cfg.smallSample };
    });
    const known = samples.filter((s) => s.traits[t.id] !== undefined).length;
    const rates = stats.map((s) => s.rate);
    // وزن الصفة المتعلَّم = (أعلى نسبة نجاح − أقل نسبة) × الثقة
    const confidence = known / (known + cfg.confidenceK);
    const learned = (Math.max(...rates) - Math.min(...rates)) * confidence;
    // الوزن النهائي = ن ÷ (ن + 10) × المتعلَّم + 10 ÷ (ن + 10) × الافتراضي
    const defaultWeight = cfg.weights[t.id];
    const finalWeight = (n / (n + cfg.blendK)) * learned + (cfg.blendK / (n + cfg.blendK)) * defaultWeight;
    traits[t.id] = { id: t.id, label: t.label, defaultWeight, learnedWeight: learned, confidence, finalWeight, known, values: stats };
  }
  return { products: n, traits };
}

export interface ScorePart {
  trait: TraitId;
  label: string;
  value: string;
  weight: number;
  rate: number;
  maxRate: number;
  ratio: number;
}

export interface DnaScore {
  score: number | null;
  parts: ScorePart[];
  missing: TraitId[]; // صفات ما انعبّت: انشالت من الحساب
  rule: string;
}

// درجة الحمض = مجموع (وزن الصفة × نسبة نجاح قيمة المرشح ÷ أعلى نسبة نجاح بالصفة) ÷ مجموع الأوزان × 100
export function dnaScore(traits: Traits, model: DnaModel): DnaScore {
  const parts: ScorePart[] = [];
  const missing: TraitId[] = [];
  for (const id of TRAIT_IDS) {
    const m = model.traits[id];
    const v = traits[id];
    if (v === undefined) {
      missing.push(id);
      continue;
    }
    const stat = m.values.find((x) => x.value === v);
    if (!stat) throw new TraitError(`قيمة «${v}» مش مسموحة لصفة «${m.label}»`);
    const maxRate = Math.max(...m.values.map((x) => x.rate));
    parts.push({ trait: id, label: m.label, value: v, weight: m.finalWeight, rate: stat.rate, maxRate, ratio: stat.rate / maxRate });
  }
  const totalWeight = parts.reduce((a, p) => a.plus(p.weight), D(0));
  if (parts.length === 0 || totalWeight.lte(0)) return { score: null, parts, missing, rule: "ما في صفات معبّاة: درجة الحمض مش محسوبة" };
  const sum = parts.reduce((a, p) => a.plus(D(p.weight).times(p.ratio)), D(0));
  const raw = sum.div(totalWeight).times(100);
  return {
    score: raw.toDecimalPlaces(0).toNumber(),
    parts,
    missing,
    rule: `مجموع (وزن × نسبة النجاح ÷ الأعلى) ${sum.toDecimalPlaces(4)} ÷ مجموع الأوزان ${totalWeight.toDecimalPlaces(4)} × 100 = ${raw.toDecimalPlaces(2)}${missing.length ? ` (${missing.length} صفة ناقصة انشالت)` : ""}`,
  };
}

// ───── التشابه مع المرجعيات ─────
export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) throw new Error("طولين التضمين مش متساويين");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

// نسبة الصفات المتطابقة (من الصفات المعروفة عند الطرفين)
export function traitsMatch(a: Traits, b: Traits): { ratio: number | null; matching: TraitId[]; different: TraitId[] } {
  const both = TRAIT_IDS.filter((id) => a[id] !== undefined && b[id] !== undefined);
  const matching = both.filter((id) => a[id] === b[id]);
  return { ratio: both.length ? matching.length / both.length : null, matching, different: both.filter((id) => a[id] !== b[id]) };
}

export interface Similarity {
  value: number | null; // 0..1
  parts: { text: number | null; image: number | null; traits: number | null };
  note?: string;
}

// التشابه = 0.5 × النص + 0.3 × الصورة + 0.2 × نسبة الصفات المتطابقة. المكوّن الناقص بينشال وأوزان الباقي بتتوزّع (ومعلَّم).
export function similarity(parts: { text?: number | null; image?: number | null; traits?: number | null }, w: [number, number, number] = [0.5, 0.3, 0.2]): Similarity {
  const items: [keyof Similarity["parts"], number | null | undefined, number][] = [["text", parts.text, w[0]], ["image", parts.image, w[1]], ["traits", parts.traits, w[2]]];
  const have = items.filter(([, v]) => typeof v === "number" && Number.isFinite(v));
  const norm = { text: parts.text ?? null, image: parts.image ?? null, traits: parts.traits ?? null };
  if (have.length === 0) return { value: null, parts: norm, note: "ما في أي مكوّن تشابه" };
  const totalW = have.reduce((a, [, , wt]) => a + wt, 0);
  const sum = have.reduce((a, [, v, wt]) => a + (v as number) * wt, 0);
  const missing = items.length - have.length;
  return { value: sum / totalW, parts: norm, note: missing ? `${missing} من مكوّنات التشابه ناقصة: انشالت وأوزان الباقي توزّعت` : undefined };
}

export interface ReferenceInput {
  id: string;
  name: string;
  traits: Traits;
  textSim?: number | null;
  imageSim?: number | null;
}

export interface ClosestResult {
  id: string;
  name: string;
  similarity: Similarity;
  matching: TraitId[];
  different: TraitId[];
}

export function rankReferences(candidate: Traits, refs: ReferenceInput[], w?: [number, number, number]): ClosestResult[] {
  return refs
    .map((r) => {
      const m = traitsMatch(candidate, r.traits);
      return { id: r.id, name: r.name, similarity: similarity({ text: r.textSim, image: r.imageSim, traits: m.ratio }, w), matching: m.matching, different: m.different };
    })
    .sort((a, b) => (b.similarity.value ?? -1) - (a.similarity.value ?? -1));
}
