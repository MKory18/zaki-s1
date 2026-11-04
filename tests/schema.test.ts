import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const src = readFileSync("prisma/schema.prisma", "utf8");
const models = [...src.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)].map((m) => ({ name: m[1], body: m[2] }));

describe("مخطط قاعدة البيانات", () => {
  it("54 جدول: 53 بأسماء الخطة + الأحداث الصادرة", () => {
    expect(models.length).toBe(54);
    const names = models.map((m) => m.name);
    for (const n of ["Candidate", "Observation", "ImageAsset", "Problem", "Market", "Keyword", "DnaReference", "DnaProfile", "DnaWeightSet", "ScoreSnapshot", "EconomicsCalc", "MarketReadiness", "Decision", "RejectReason", "ReferenceText", "Ingredient", "ClaimRule", "AdPolicyRule", "ComplianceCheck", "Batch", "License", "ProductFile", "FormulationBrief", "Supplier", "Quote", "Sample", "DraftMessage", "BrandBrief", "BrandRegistry", "TestPage", "TrendTest", "TrendAngle", "VideoMetric", "LaunchPack", "OutboundRequest", "InboundEvent", "Agent", "Prompt", "PromptVersion", "AgentRun", "ModelProvider", "ModelRoute", "User", "Setting", "Alert", "Report", "AuditLog", "ExtensionDevice", "SelectorSet", "CaptureJob", "ImportJob", "ConsultantThread", "ConsultantMessage", "OutboundEvent"]) {
      expect(names, n).toContain(n);
    }
  });

  it("كل جدول فيه id وcreatedAt وupdatedAt", () => {
    for (const m of models) {
      expect(m.body, m.name).toMatch(/\bid\s+String\s+@id/);
      expect(m.body, m.name).toMatch(/\bcreatedAt\s+DateTime/);
      expect(m.body, m.name).toMatch(/\bupdatedAt\s+DateTime\s+@updatedAt/);
    }
  });

  it("التواريخ كلها مع منطقة زمنية", () => {
    for (const m of models) {
      for (const line of m.body.split("\n")) {
        if (/^\s+\w+\s+DateTime\??\s/.test(line)) expect(line, `${m.name}: ${line}`).toContain("@db.Timestamptz");
      }
    }
  });

  it("المبالغ Decimal مش Float", () => {
    for (const m of models) {
      for (const line of m.body.split("\n")) {
        const f = /^\s+(\w+)\s+(\w+)/.exec(line);
        if (f && /(price|cost|budget|ceiling|limit)/i.test(f[1])) expect(f[2], `${m.name}.${f[1]}`).toBe("Decimal");
      }
    }
  });

  it("الحذف الناعم للسجلات المهمة", () => {
    for (const n of ["Candidate", "DnaReference", "ReferenceText", "Ingredient", "ClaimRule", "Batch", "License", "ProductFile", "FormulationBrief", "Supplier", "BrandBrief", "TestPage", "TrendTest", "Agent", "Prompt", "User"]) {
      expect(models.find((m) => m.name === n)?.body, n).toMatch(/deletedAt\s+DateTime\?/);
    }
  });

  it("ولا حقل لبيانات شخصية لزبائن", () => {
    for (const m of models) {
      for (const line of m.body.split("\n")) {
        const f = /^\s+(\w+)\s+\w+/.exec(line);
        if (f) expect(f[1], `${m.name}.${f[1]}`).not.toMatch(/phone|email|mobile|address|customerName|buyerName|username/i);
      }
    }
  });

  it("التضمينات vector(1024) بالمرشح والصورة، وترحيل الفهارس موجود", () => {
    expect(src.match(/Unsupported\("vector\(1024\)"\)/g)?.length).toBe(2);
    const idx = readFileSync("prisma/migrations/0002_vector_indexes/migration.sql", "utf8");
    expect(idx).toContain("hnsw");
    const init = readFileSync("prisma/migrations/0001_init/migration.sql", "utf8");
    expect(init).toContain("CREATE EXTENSION IF NOT EXISTS vector");
    expect(init.match(/CREATE TABLE/g)?.length).toBe(53);
  });
});
