// الأدوار السبعة وجدول الصلاحيات (docs/01-logic.md الجزء العاشر).
// الرفض هو الافتراضي: أي إجراء أو دور مش مكتوب هون = ممنوع.
export const ROLES = ["owner", "deputy", "researcher", "compliance", "sharia", "safety", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS_AR: Record<Role, string> = {
  owner: "مالك",
  deputy: "نائب",
  researcher: "باحث",
  compliance: "مراجع امتثال",
  sharia: "مراجع شرعي",
  safety: "مقيّم سلامة",
  viewer: "مشاهد",
};

// النائب إله نفس صلاحيات المالك.
const OWNERS: readonly Role[] = ["owner", "deputy"];

export const MATRIX = {
  "dashboard.view": [...OWNERS, "researcher", "compliance", "viewer"],
  "capture.create": [...OWNERS, "researcher"],
  "candidate.watch_reject": [...OWNERS, "researcher"],
  "research.start": [...OWNERS],
  "texts.view": [...OWNERS, "sharia"],
  "texts.approve": [...OWNERS, "sharia"],
  "claims.approve": [...OWNERS, "compliance"],
  "formulations.view": [...OWNERS, "safety"],
  "formulation.approve": ["safety"],
  "trendlab.promote": [...OWNERS],
  "paid_test.plan": [...OWNERS],
  "oms.send": [...OWNERS],
  "settings.manage": [...OWNERS],
  "prompts.manage": [...OWNERS],
  "users.manage": [...OWNERS],
  "audit.view": [...OWNERS],
  // الجودة (الدفعات والتراخيص): المالك والنائب، والمراجع الامتثال بيشوف بس
  "quality.view": [...OWNERS, "compliance"],
  "quality.manage": [...OWNERS],
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof MATRIX;
export const ACTIONS = Object.keys(MATRIX) as Action[];

export function isRole(v: unknown): v is Role {
  return typeof v === "string" && (ROLES as readonly string[]).includes(v);
}

export function can(role: unknown, action: string): boolean {
  if (!isRole(role)) return false;
  const allowed = (MATRIX as Record<string, readonly Role[]>)[action];
  return Array.isArray(allowed) && allowed.includes(role);
}
