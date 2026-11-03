import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
// @ts-expect-error ملف mjs بلا تعريفات
import { scanText } from "../tools/secret-scan.mjs";

describe("فحص الأسرار", () => {
  it("بيمسك مفتاح حقيقي الشكل", () => {
    const fake = "sk-" + "a".repeat(30);
    expect(scanText("x.ts", `const k = "${fake}"`).length).toBeGreaterThan(0);
  });

  it("بيمسك قيمة لسر بملف إعدادات", () => {
    expect(scanText("x.env", "GLM_API_KEY=abc123def").length).toBe(1);
  });

  it("بيقبل سر فاضي أو إشارة لمتغير", () => {
    expect(scanText(".env.example", "GLM_API_KEY=")).toEqual([]);
    expect(scanText("compose.yml", "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}")).toEqual([]);
  });

  it("المستودع نظيف", () => {
    const out = execFileSync("node", ["tools/secret-scan.mjs"], { encoding: "utf8" });
    expect(out).toContain("نظيف");
  });
});
