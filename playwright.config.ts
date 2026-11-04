import { defineConfig } from "@playwright/test";

const PORT = 3217;

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // محلياً ممكن PW_CHANNEL=msedge لو ما في كروميوم منزّل
    channel: process.env.PW_CHANNEL || undefined,
  },
  webServer: [
    { command: "node tests/e2e/fake-openai.mjs", url: "http://127.0.0.1:3218/ok", reuseExistingServer: false, timeout: 30_000 },
    {
      command: `npx next dev -p ${PORT}`,
      url: `http://127.0.0.1:${PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 120_000,
      // قيم تجربة بس (مش أسرار حقيقية): دخول المالك المحلي مفتوح لنسخة التطوير، ومفاتيح وهمية للخادم الوهمي
      env: {
        AUTH_SECRET: "e2e-test-secret-e2e-test-secret-1234", // scan:ok
        AUTH_DEV_OWNER: "1",
        GLM_API_KEY: "e2e-glm-key-must-not-leak", // scan:ok
        KIMI_API_KEY: "e2e-kimi-key-must-not-leak", // scan:ok
      },
    },
  ],
});
