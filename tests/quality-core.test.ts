import { describe, expect, it } from "vitest";
import { daysUntil, licenseAlert, releaseBlockers, type BatchFacts } from "../src/core/quality";

const NOW = new Date("2026-11-04T09:00:00Z");
const ok = (over: Partial<BatchFacts> = {}): BatchFacts => ({ coaKey: "coa/1.pdf", independentTestKey: "lab/1.pdf", sterile: null, category: "general", heavyMetalsTested: null, expiresAt: new Date("2028-01-01"), ...over });

describe("بوابة الإفراج عن الدفعة", () => {
  it("دفعة كاملة بتنفرج", () => {
    expect(releaseBlockers(ok(), { firstFromSupplier: true, now: NOW })).toEqual([]);
  });
  it("دفعة بلا شهادة ما بتنفرج", () => {
    expect(releaseBlockers(ok({ coaKey: null }), { firstFromSupplier: false, now: NOW })).toEqual(["ما في شهادة تحليل (COA) للدفعة"]);
  });
  it("كحل بلا تحليل معادن ثقيلة ما بينفرج حتى بشهادة وفحص مستقل", () => {
    const r = releaseBlockers(ok({ category: "kohl" }), { firstFromSupplier: false, now: NOW });
    expect(r).toHaveLength(1);
    expect(r[0]).toContain("معادن ثقيلة");
    expect(releaseBlockers(ok({ category: "kohl", heavyMetalsTested: true }), { firstFromSupplier: false, now: NOW })).toEqual([]);
  });
  it("منتج عين: لازم معقّم ومفحوص مستقل", () => {
    const r = releaseBlockers(ok({ category: "eye", sterile: false, independentTestKey: null }), { firstFromSupplier: false, now: NOW });
    expect(r.some((x) => x.includes("التصنيع المعقّم"))).toBe(true);
    expect(r.some((x) => x.includes("الفحص المخبري المستقل"))).toBe(true);
    expect(releaseBlockers(ok({ category: "eye", sterile: true }), { firstFromSupplier: false, now: NOW })).toEqual([]);
  });
  it("فحص الامتثال بيقول عين: بيطبّق نفس القواعد حتى لو الفئة «عادي»", () => {
    expect(releaseBlockers(ok({ sterile: null }), { firstFromSupplier: false, eyeFromCheck: true, now: NOW })).toHaveLength(1);
  });
  it("الفحص المستقل إلزامي لأول دفعة من المورّد ولفئات خطر الغش", () => {
    expect(releaseBlockers(ok({ independentTestKey: null }), { firstFromSupplier: true, now: NOW })).toHaveLength(1);
    expect(releaseBlockers(ok({ independentTestKey: null }), { firstFromSupplier: false, now: NOW })).toEqual([]);
    expect(releaseBlockers(ok({ independentTestKey: null, category: "fraud_risk" }), { firstFromSupplier: false, now: NOW })).toHaveLength(1);
    expect(releaseBlockers(ok({ independentTestKey: null }), { firstFromSupplier: false, fraudFromCheck: true, now: NOW })).toHaveLength(1);
  });
  it("الدفعة المنتهية ما بتنفرج", () => {
    expect(releaseBlockers(ok({ expiresAt: new Date("2026-11-04T08:00:00Z") }), { firstFromSupplier: false, now: NOW })).toEqual(["الدفعة منتهية الصلاحية"]);
  });
  it("الأسباب بلا تكرار", () => {
    const r = releaseBlockers(ok({ category: "kohl", independentTestKey: null }), { firstFromSupplier: true, now: NOW });
    expect(new Set(r).size).toBe(r.length);
  });
});

describe("تراخيص: تنبيه قبل الانتهاء", () => {
  const lic = (days: number, over = {}) => ({ expiresAt: new Date(NOW.getTime() + days * 86_400_000), alertDays: 60, status: "active", ...over });
  it("بعد 61 يوم: ولا شي، بعد 60: تنبيه، بعد 0: تنبيه، قبل: منتهي", () => {
    expect(licenseAlert(lic(61), NOW)).toBeNull();
    expect(licenseAlert(lic(60), NOW)).toBe("expiring");
    expect(licenseAlert(lic(1), NOW)).toBe("expiring");
    expect(licenseAlert(lic(-1), NOW)).toBe("expired");
  });
  it("الملغي والقيد الطلب ما بينبّهوا، وبلا تاريخ ولا شي", () => {
    expect(licenseAlert(lic(10, { status: "revoked" }), NOW)).toBeNull();
    expect(licenseAlert(lic(10, { status: "requested" }), NOW)).toBeNull();
    expect(licenseAlert({ expiresAt: null, alertDays: 60, status: "active" }, NOW)).toBeNull();
  });
  it("حدّ التنبيه من الترخيص نفسه", () => {
    expect(licenseAlert(lic(100, { alertDays: 120 }), NOW)).toBe("expiring");
    expect(daysUntil(new Date(NOW.getTime() + 3 * 86_400_000), NOW)).toBe(3);
  });
});
