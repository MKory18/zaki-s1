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
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `http://127.0.0.1:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 120_000,
    // قيم تجربة بس (مش أسرار حقيقية): دخول المالك المحلي مفتوح لنسخة التطوير
    env: { AUTH_SECRET: "e2e-test-secret-e2e-test-secret-1234", AUTH_DEV_OWNER: "1" }, // scan:ok
  },
});
