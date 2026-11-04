// حالات المرشح والانتقالات المسموحة بس (docs/02-plan.md الجزء السابع، قسم 9).
// أي انتقال مش مكتوب هون بينرفض. هاي الدالة الوحيدة اللي بتقرّر، وكل تغيير حالة بالنظام لازم يمرّ منها.
export const CANDIDATE_STATUSES = [
  "new",
  "scanned",
  "held",
  "shortlisted",
  "verified",
  "watching",
  "deep_research",
  "trend_lab",
  "paid_test",
  "launched",
  "failed",
  "rejected",
  "archived",
] as const;

export type CandidateStatus = (typeof CANDIDATE_STATUSES)[number];

export const STATUS_LABELS_AR: Record<CandidateStatus, string> = {
  new: "جديد",
  scanned: "مفروز",
  held: "مستني",
  shortlisted: "قائمة قصيرة",
  verified: "متحقق — جاهز لقرارك",
  watching: "مراقبة 14 يوم",
  deep_research: "بحث معمّق",
  trend_lab: "مختبر الترند",
  paid_test: "اختبار مدفوع",
  launched: "مُطلق",
  failed: "فشل",
  rejected: "مرفوض بسبب",
  archived: "مؤرشف",
};

export const TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  new: ["scanned"],
  scanned: ["shortlisted", "held"],
  held: ["scanned"], // لما تتحسن إشاراته
  shortlisted: ["verified"],
  verified: ["deep_research", "watching", "rejected"],
  watching: ["shortlisted", "archived"],
  deep_research: ["trend_lab", "rejected"],
  trend_lab: ["paid_test", "rejected"],
  paid_test: ["launched", "failed"],
  launched: ["archived"],
  failed: ["archived"], // ويدخل التعلّم
  rejected: ["archived"],
  archived: [],
};

export class TransitionError extends Error {
  constructor(public from: string, public to: string) {
    super(`انتقال غير مسموح: ${from} ← ${to}`);
  }
}

export function isStatus(v: unknown): v is CandidateStatus {
  return typeof v === "string" && (CANDIDATE_STATUSES as readonly string[]).includes(v);
}

export function nextStates(from: CandidateStatus): readonly CandidateStatus[] {
  return TRANSITIONS[from];
}

export function canTransition(from: unknown, to: unknown): boolean {
  return isStatus(from) && isStatus(to) && TRANSITIONS[from].includes(to);
}

export function assertTransition(from: unknown, to: unknown): asserts to is CandidateStatus {
  if (!canTransition(from, to)) throw new TransitionError(String(from), String(to));
}
