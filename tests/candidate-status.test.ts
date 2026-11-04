import { describe, expect, it } from "vitest";
import { CANDIDATE_STATUSES, TRANSITIONS, TransitionError, assertTransition, canTransition, nextStates } from "../src/core/candidate-status";
import { CandidateStatus as PrismaStatus } from "../src/generated/prisma/enums";

// الجدول كما هو بخطة البناء (الجزء السابع، قسم 9)، مكتوب هون مستقل عن الكود
const DOC: Record<string, string[]> = {
  new: ["scanned"],
  scanned: ["shortlisted", "held"],
  held: ["scanned"],
  shortlisted: ["verified"],
  verified: ["deep_research", "watching", "rejected"],
  watching: ["shortlisted", "archived"],
  deep_research: ["trend_lab", "rejected"],
  trend_lab: ["paid_test", "rejected"],
  paid_test: ["launched", "failed"],
  launched: ["archived"],
  failed: ["archived"],
  rejected: ["archived"],
  archived: [],
};

describe("حالات المرشح", () => {
  it("13 حالة، ومطابقة لإنوم قاعدة البيانات", () => {
    expect(CANDIDATE_STATUSES.length).toBe(13);
    expect([...CANDIDATE_STATUSES].sort()).toEqual(Object.values(PrismaStatus).sort());
  });

  it("الانتقالات مطابقة للجدول بالضبط", () => {
    expect(TRANSITIONS).toEqual(DOC);
  });

  it("كل زوج حالتين: المسموح مسموح وغيره مرفوض", () => {
    for (const from of CANDIDATE_STATUSES) {
      for (const to of CANDIDATE_STATUSES) {
        expect(canTransition(from, to), `${from}→${to}`).toBe(DOC[from].includes(to));
      }
    }
  });

  it("انتقال غلط بينرفض برسالة بالعربي", () => {
    expect(() => assertTransition("new", "launched")).toThrow(TransitionError);
    expect(() => assertTransition("new", "launched")).toThrow("انتقال غير مسموح");
    expect(() => assertTransition("archived", "new")).toThrow(TransitionError);
    expect(() => assertTransition("scanned", "scanned")).toThrow(TransitionError);
  });

  it("قيم مجهولة ما بتمرّ", () => {
    expect(canTransition("new", "banana")).toBe(false);
    expect(canTransition(undefined, "scanned")).toBe(false);
  });

  it("المؤرشف نهاية الطريق، والرفض والفشل ما بيرجعوا", () => {
    expect(nextStates("archived")).toEqual([]);
    expect(canTransition("rejected", "verified")).toBe(false);
    expect(canTransition("failed", "paid_test")).toBe(false);
  });

  it("مسار الفكرة للإطلاق كامل", () => {
    const path = ["new", "scanned", "shortlisted", "verified", "deep_research", "trend_lab", "paid_test", "launched", "archived"];
    for (let i = 0; i < path.length - 1; i++) expect(canTransition(path[i], path[i + 1])).toBe(true);
  });
});
