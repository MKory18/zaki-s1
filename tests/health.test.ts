import { describe, expect, it } from "vitest";
import { healthPayload } from "../src/lib/health";

describe("نقطة الصحة", () => {
  it("بترجع سليم مع اسم الخدمة والوقت", () => {
    const p = healthPayload(new Date("2026-10-27T09:00:00Z"));
    expect(p).toEqual({ status: "ok", service: "zaki-s1", time: "2026-10-27T09:00:00.000Z" });
  });
});
