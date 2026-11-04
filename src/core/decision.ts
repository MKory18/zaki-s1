// قواعد القرار (docs/01-logic.md الجزء الرابع، قسم 9): الكود بيقترح وإنت بتعتمد.
// رأي المحقق بيظهر جنب قرار القواعد، وإذا تعارضوا البطاقة بتنعلّم «تعارض».
import type { RejectReasonHit } from "./reject";
import type { ReadinessVerdict } from "./readiness";

export type RuleDecision = "reject_auto" | "deep_research" | "deep_research_outside_dna" | "watch" | "reject";
export type InvestigatorOpinion = "deep_research" | "watch" | "reject";

export interface DecisionConfig {
  deepMinVelocity: number; // 65
  deepMinDna: number; // 60
  outsideMinVelocity: number; // 80
  watchVelocity: [number, number]; // [45, 65)
  watchDna: [number, number]; // [45, 60)
  watchDays: number; // 14
  outsideBudgetShare: number; // 0.20
  minCpaCeiling: number; // الحد الأدنى لسقف تكلفة الطلب للسوق (4$)
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  deepMinVelocity: 65,
  deepMinDna: 60,
  outsideMinVelocity: 80,
  watchVelocity: [45, 65],
  watchDna: [45, 60],
  watchDays: 14,
  outsideBudgetShare: 0.2,
  minCpaCeiling: 4,
};

export interface DecisionInput {
  rejectHits: RejectReasonHit[];
  velocity: number | null; // null = بيانات غير كافية
  dna: number | null;
  cpaCeiling: number | null;
  complianceVerdict?: "pass" | "pass_with_edits" | "needs_specialist" | "fail" | null;
  readiness?: ReadinessVerdict | null;
  investigator?: InvestigatorOpinion | null;
}

export interface DecisionResult {
  decision: RuleDecision;
  reasons: string[];
  conflict: boolean;
  watchDays?: number;
  outsideBudgetShare?: number;
}

export const DECISION_LABELS_AR: Record<RuleDecision, string> = {
  reject_auto: "ارفض تلقائياً",
  deep_research: "بحث معمّق",
  deep_research_outside_dna: "بحث معمّق — خارج الحمض",
  watch: "راقب",
  reject: "ارفض",
};

const inRange = (v: number | null, [lo, hi]: [number, number]) => v !== null && v >= lo && v < hi;

export function decide(i: DecisionInput, cfg: DecisionConfig = DEFAULT_DECISION_CONFIG): DecisionResult {
  const done = (decision: RuleDecision, reasons: string[], extra: Partial<DecisionResult> = {}): DecisionResult => {
    const isDeep = decision === "deep_research" || decision === "deep_research_outside_dna";
    const conflict = i.investigator ? (isDeep && i.investigator === "reject") || (!isDeep && decision !== "watch" && i.investigator === "deep_research") : false;
    return { decision, reasons, conflict, ...extra };
  };

  if (i.rejectHits.length) return done("reject_auto", i.rejectHits.map((h) => h.message));

  const complianceOk = i.complianceVerdict !== "fail";
  const readinessOk = i.readiness !== "not_ready";
  const economicsOk = i.cpaCeiling !== null && i.cpaCeiling > cfg.minCpaCeiling;
  const v = i.velocity;
  const d = i.dna;

  // بحث معمّق: المؤشر 65+ · الحمض 60+ · سقف تكلفة الطلب فوق الحد الأدنى · الامتثال مش مرفوض · السوق مش «مش جاهز»
  if (v !== null && d !== null && v >= cfg.deepMinVelocity && d >= cfg.deepMinDna && economicsOk && complianceOk && readinessOk) {
    return done("deep_research", [`المؤشر ${v} والحمض ${d} فوق الحدّين، والاقتصاد والامتثال والسوق تمام`]);
  }
  // خارج الحمض: المؤشر 80+ · الحمض أقل من 60 · الاقتصاد والامتثال تمام (بيحسب من حصة الـ 20%)
  if (v !== null && d !== null && v >= cfg.outsideMinVelocity && d < cfg.deepMinDna && economicsOk && complianceOk && readinessOk) {
    return done("deep_research_outside_dna", [`المؤشر ${v} قوي بس الحمض ${d} أقل من ${cfg.deepMinDna}`], { outsideBudgetShare: cfg.outsideBudgetShare });
  }
  // راقب: المؤشر 45–65 · أو الحمض 45–60 · أو بيانات غير كافية
  if (v === null) return done("watch", ["بيانات غير كافية: بيرجع ينحسب يومياً"], { watchDays: cfg.watchDays });
  if (inRange(v, cfg.watchVelocity) || inRange(d, cfg.watchDna)) return done("watch", [`المؤشر ${v}${d !== null ? ` والحمض ${d}` : ""} بشريحة المراقبة`], { watchDays: cfg.watchDays });

  const why: string[] = [];
  if (v >= cfg.deepMinVelocity && (d === null || d >= cfg.deepMinDna)) {
    if (!economicsOk) why.push(`سقف تكلفة الطلب ${i.cpaCeiling ?? "؟"} مش فوق الحد الأدنى ${cfg.minCpaCeiling}`);
    if (!complianceOk) why.push("الامتثال مرفوض");
    if (!readinessOk) why.push("السوق مش جاهز");
  }
  return done("reject", why.length ? why : ["ما حقق شروط البحث المعمّق ولا المراقبة"]);
}
