import { describe, expect, it } from "vitest";
import { devLoginAllowed } from "../src/lib/auth-routes";

describe("دخول المالك المحلي", () => {
  it("مفتوح بالتطوير بس لما ينضبط المتغيّر", () => {
    expect(devLoginAllowed({ NODE_ENV: "development", AUTH_DEV_OWNER: "1" } as never)).toBe(true);
    expect(devLoginAllowed({ NODE_ENV: "development" } as never)).toBe(false);
  });

  it("مقفول بالإنتاج دايماً حتى لو انضبط المتغيّر", () => {
    expect(devLoginAllowed({ NODE_ENV: "production", AUTH_DEV_OWNER: "1" } as never)).toBe(false);
  });
});
