// عقود الربط بين الأنظمة (docs/05-integration.md الجزء الخامس والسادس). كل شكل بنفس أسماء الحقول بالعقد بالضبط.
// الأنواع: money (نص بخانتين) · country · currency · datetime · YYYY-MM-DD · قيم ثابتة بـ |.
import type { Shape } from "@/agents/shape";

export const SYSTEMS = ["oms", "production", "mediabuyer", "finance", "workspace", "tasks", "clipper", "crisis"] as const;
export type SystemId = (typeof SYSTEMS)[number];

export const SYSTEM_LABELS_AR: Record<SystemId, string> = {
  oms: "الـ OMS",
  production: "نظام الإنتاج",
  mediabuyer: "الميديا باير",
  finance: "المالية",
  workspace: "مساحة العمل",
  tasks: "نظام المهام",
  clipper: "الكليبر",
  crisis: "الأزمات",
};

// ───── الـ OMS ─────
export const OMS_PERFORMANCE_RESPONSE: Shape = {
  generated_at: "datetime",
  items: [
    {
      product_id: "string",
      external_ref: "string",
      name: "string",
      country: "country",
      status: "string",
      started_at: "YYYY-MM-DD",
      ad_spend: "money",
      orders: "number",
      confirmed: "number",
      shipped: "number",
      delivered: "number",
      returned: "number",
      collected: "money",
      delivery_fees: "money",
      return_fees: "money",
      cogs_delivered: "money",
      offers_mix: [{ qty: "number", share: "number" }],
    },
  ],
};

export const OMS_DRAFT_REQUEST: Shape = {
  source: "s1",
  external_ref: "string",
  name_ar: "string",
  brand: "string",
  country: "country",
  currency: "currency",
  unit_cost: "money",
  offers: [{ qty: "number", price: "money" }],
  delivery_fee: "money",
  classification: "cosmetic|therapeutic|needs_review",
  license: { required: "boolean", number: "string|null" },
  compliance_url: "string",
  images: ["string"],
  note: "string",
};
// مسودة فقط: الرد لازم يكون status = draft (التفعيل بالـ OMS بموافقتك)
export const OMS_DRAFT_RESPONSE: Shape = { draft_id: "string", status: "draft", created_at: "datetime" };

// ───── نظام الإنتاج ─────
export const PRODUCTION_BRIEF_REQUEST: Shape = {
  external_ref: "string",
  product: { ref: "string", name_ar: "string", problem: "string", reference_pack_url: "string", label_text: "string" },
  angles: [{ code: "string", angle: "string", hook: "string", pattern: "string", page_ref: "string" }],
  allowed_claims: ["string"],
  banned_claims: ["string"],
  references: [{ code: "string", text: "string", source: "string", grading: "string", usage: "string" }],
  ad_rules: ["string"],
  compliance_updated_at: "datetime",
  publish_requires_owner_approval: "boolean",
  due: "YYYY-MM-DD",
};
export const PRODUCTION_BRIEF_RESPONSE: Shape = { brief_id: "string", status: "accepted" };
export const PRODUCTION_METRICS_RESPONSE: Shape = {
  items: [
    {
      video_id: "string",
      angle_code: "string",
      page_ref: "string",
      snapshot: "1h|24h|72h|7d",
      reach: "number",
      avg_watch_pct: "number",
      shares: "number",
      saves: "number",
      comments: "number",
      intent_comments: "number",
      messages: "number",
      captured_at: "datetime",
    },
  ],
};

// ───── الميديا باير ─────
export const MEDIABUYER_PLAN_REQUEST: Shape = {
  external_ref: "string",
  product_ref: "string",
  oms_draft_id: "string",
  country: "country",
  budget_usd: "money",
  duration_days: "number",
  winning_angles: ["string"],
  stop_rules: { max_cost_per_confirmed: "money", min_spend_before_stop: "money", max_return_rate_first_50: "number" },
  ad_rules_url: "string",
  requires_finance_check: "boolean",
  requires_owner_approval: "boolean",
};
export const MEDIABUYER_PLAN_RESPONSE: Shape = { plan_id: "string", status: "pending_owner_approval" };
export const MEDIABUYER_RESULTS_RESPONSE: Shape = {
  plan_id: "string",
  status: "string",
  spend: "money",
  started_at: "YYYY-MM-DD",
  ended_at: "YYYY-MM-DD|null",
  stopped_by_rule: "string|null",
};

// ───── المالية ─────
export const FINANCE_BUDGET_RESPONSE: Shape = { month: "string", total: "money", committed: "money", available: "money", outside_dna_share: "number" };
export const FINANCE_COST_REQUEST: Shape = {
  external_ref: "string",
  kind: "samples|first_batch|lab_test",
  amount: "money",
  currency: "currency",
  product_ref: "string",
  note: "string",
};
export const FINANCE_COST_RESPONSE: Shape = { request_id: "string", status: "pending_owner_approval" };

// ───── مساحة العمل · المهام · الكليبر · الأزمات (الردود بالعقد مش محدّدة: بنقبل أي رد ناجح) ─────
export const WORKSPACE_IDEA_REQUEST: Shape = { external_ref: "string", title: "string", summary: "string", link: "string", tags: ["string"] };
export const WORKSPACE_PROJECT_REQUEST: Shape = { external_ref: "string", title: "string", cards: [{ title: "string" }], link: "string" };
export const TASKS_TASK_REQUEST: Shape = { external_ref: "string", title: "string", assignee_role: "string", due: "YYYY-MM-DD", checklist: ["string"], link: "string" };
export const CLIPPER_BRIEF_REQUEST: Shape = { external_ref: "string", name_ar: "string", angles: ["string"], assets_url: "string", compliance_url: "string" };
export const CRISIS_ALERT_REQUEST: Shape = { external_ref: "string", type: "string", severity: "low|medium|high", product_ref: "string", message: "string", link: "string" };

// ───── الواردة لسيستم 1 ─────
export const COMPLIANCE_RESPONSE: Shape = {
  product_ref: "string",
  classification: "cosmetic|therapeutic|needs_review",
  verdict: "pass|pass_with_edits|needs_specialist|fail",
  allowed_claims: ["string"],
  banned_claims: ["string"],
  references: [{ code: "string", text: "string", source: "string", grading: "string", usage: "string" }],
  ad_rules: ["string"],
  updated_at: "datetime",
};

export const EVENT_ENVELOPE: Shape = { event_id: "string", type: "string", occurred_at: "datetime", data: {} };

export const INBOUND_EVENT_TYPES = {
  production: ["brief.accepted", "brief.rejected", "video.published", "metrics.snapshot"],
  mediabuyer: ["test.approved", "test.started", "test.stopped", "test.completed"],
  oms: ["draft.activated", "draft.rejected", "product.performance.updated", "quality.complaint"],
  finance: ["cost_request.approved", "cost_request.rejected", "budget.updated"],
} as const;
export type InboundSystem = keyof typeof INBOUND_EVENT_TYPES;

export const OUTBOUND_EVENT_TYPES = {
  "compliance.updated": ["الإنتاج", "الميديا باير", "الكليبر", "الردود"],
  "batch.blocked": ["الـ OMS", "الأزمات"],
  "license.expiring": ["الأزمات"],
  "product.approved": ["مساحة العمل"],
} as const;

// ───── سجل العقود الصادرة: النظام + المسار ← شكل الطلب والرد (الرد اختياري لما العقد ما بيحدّده) ─────
export const OUTBOUND_CONTRACTS: Record<string, { request: Shape; response?: Shape }> = {
  "oms POST /api/v1/product-drafts": { request: OMS_DRAFT_REQUEST, response: OMS_DRAFT_RESPONSE },
  "production POST /api/v1/briefs": { request: PRODUCTION_BRIEF_REQUEST, response: PRODUCTION_BRIEF_RESPONSE },
  "mediabuyer POST /api/v1/test-plans": { request: MEDIABUYER_PLAN_REQUEST, response: MEDIABUYER_PLAN_RESPONSE },
  "finance POST /api/v1/cost-requests": { request: FINANCE_COST_REQUEST, response: FINANCE_COST_RESPONSE },
  "workspace POST /api/v1/ideas": { request: WORKSPACE_IDEA_REQUEST },
  "workspace POST /api/v1/projects": { request: WORKSPACE_PROJECT_REQUEST },
  "tasks POST /api/v1/tasks": { request: TASKS_TASK_REQUEST },
  "clipper POST /api/v1/product-briefs": { request: CLIPPER_BRIEF_REQUEST },
  "crisis POST /api/v1/alerts": { request: CRISIS_ALERT_REQUEST },
};
