import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

// المفاتيح المطلوبة بخطة البناء (الجزء الأول، قسم 5)
const REQUIRED = [
  "APP_URL", "DATABASE_URL", "REDIS_URL", "TZ",
  "S3_ENDPOINT", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET",
  "AUTH_OIDC_ISSUER", "AUTH_OIDC_CLIENT_ID", "AUTH_OIDC_CLIENT_SECRET", "AUTH_SECRET",
  "TELEGRAM_BOT_TOKEN", "TELEGRAM_OWNER_CHAT_ID",
  "GLM_API_KEY", "GLM_BASE_URL", "KIMI_API_KEY", "KIMI_BASE_URL", "CLAUDE_API_KEY", "GEMINI_API_KEY",
  "INTERNAL_MODEL_BASE_URL", "INTERNAL_MODEL_KEY",
  "ALIEXPRESS_APP_KEY", "ALIEXPRESS_APP_SECRET", "ALIEXPRESS_TRACKING_ID", "META_ADLIB_TOKEN", "GOOGLE_TRENDS_KEY", "SERP_API_KEY",
  "OMS_BASE_URL", "OMS_TOKEN", "PRODUCTION_BASE_URL", "PRODUCTION_TOKEN", "MEDIABUYER_BASE_URL", "MEDIABUYER_TOKEN",
  "FINANCE_BASE_URL", "FINANCE_TOKEN", "WORKSPACE_BASE_URL", "WORKSPACE_TOKEN", "TASKS_BASE_URL", "TASKS_TOKEN",
  "CLIPPER_BASE_URL", "CLIPPER_TOKEN", "CRISIS_BASE_URL", "CRISIS_TOKEN",
  "WEBHOOK_SECRET_PRODUCTION", "WEBHOOK_SECRET_MEDIABUYER", "WEBHOOK_SECRET_OMS", "EXTENSION_SIGNING_SECRET",
];

describe(".env.example", () => {
  const lines = readFileSync(".env.example", "utf8").split(/\r?\n/);
  const entries = new Map<string, string>();
  for (const l of lines) {
    const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(l);
    if (m) entries.set(m[1], m[2]);
  }

  it("فيه كل المفاتيح المطلوبة", () => {
    const missing = REQUIRED.filter((k) => !entries.has(k));
    expect(missing).toEqual([]);
  });

  it("الأسرار فيه فاضية", () => {
    const filled = [...entries].filter(([k, v]) => /(KEY|SECRET|TOKEN|PASSWORD)/.test(k) && v.trim() !== "");
    expect(filled).toEqual([]);
  });
});
