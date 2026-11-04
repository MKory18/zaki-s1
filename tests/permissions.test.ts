import { describe, expect, it } from "vitest";
import { ACTIONS, ROLES, can, type Role } from "../src/core/permissions";

// الجدول كما هو بملف المنطق (الجزء العاشر)، مكتوب هون مستقل عن الكود عشان يكشف أي انحراف.
const O: Role[] = ["owner", "deputy"];
const DOC: Record<string, Role[]> = {
  "dashboard.view": [...O, "researcher", "compliance", "viewer"],
  "capture.create": [...O, "researcher"],
  "candidate.watch_reject": [...O, "researcher"],
  "research.start": [...O],
  "texts.approve": [...O, "sharia"],
  "claims.approve": [...O, "compliance"],
  "formulation.approve": ["safety"],
  "trendlab.promote": [...O],
  "paid_test.plan": [...O],
  "oms.send": [...O],
  "settings.manage": [...O],
  "prompts.manage": [...O],
  "users.manage": [...O],
};

describe("الصلاحيات", () => {
  it("الأدوار سبعة", () => {
    expect(ROLES.length).toBe(7);
  });

  for (const [action, roles] of Object.entries(DOC)) {
    for (const role of ROLES) {
      it(`${action} ← ${role}: ${roles.includes(role) ? "مسموح" : "ممنوع"}`, () => {
        expect(can(role, action)).toBe(roles.includes(role));
      });
    }
  }

  it("«مشاهد» ما بيقدر يعمل أي قرار", () => {
    const decisions = ACTIONS.filter((a) => a !== "dashboard.view");
    expect(decisions.filter((a) => can("viewer", a))).toEqual([]);
  });

  it("المراجع الشرعي بيشوف النصوص بس", () => {
    expect(ACTIONS.filter((a) => can("sharia", a)).sort()).toEqual(["texts.approve", "texts.view"]);
  });

  it("مقيّم السلامة بيشوف البريفات بس", () => {
    expect(ACTIONS.filter((a) => can("safety", a)).sort()).toEqual(["formulation.approve", "formulations.view"]);
  });

  it("النائب مثل المالك", () => {
    for (const a of ACTIONS) {
      if (a === "formulation.approve") continue; // اعتماد التركيبة لمقيّم السلامة بس
      expect(can("deputy", a)).toBe(can("owner", a));
    }
  });

  it("الرفض هو الافتراضي: إجراء أو دور مجهول", () => {
    expect(can("owner", "anything.else")).toBe(false);
    expect(can("hacker", "users.manage")).toBe(false);
    expect(can(undefined, "users.manage")).toBe(false);
  });
});
