// إعدادات البوابة بتنحفظ بالإعدادات (المفتاح gateway.config) عشان تضل بعد إعادة التشغيل. المفاتيح نفسها بـ .env، مش هون.
import type { PrismaClient } from "@/generated/prisma/client";
import { getSetting, setSetting } from "@/lib/settings";
import { getGatewayConfig, setGatewayConfig, validateConfig } from "./config";
import type { GatewayConfig } from "./types";

export const GATEWAY_KEY = "gateway.config";

const g = globalThis as unknown as { __s1GatewayLoaded?: boolean };

// بيقرا الإعدادات المحفوظة مرة وحدة لكل تشغيل. الباقي بالذاكرة.
export async function ensureGatewayConfig(db: PrismaClient): Promise<GatewayConfig> {
  if (!g.__s1GatewayLoaded) {
    g.__s1GatewayLoaded = true;
    try {
      const saved = await getSetting(db, GATEWAY_KEY);
      if (saved) setGatewayConfig(validateConfig(saved.value));
    } catch (e) {
      g.__s1GatewayLoaded = false;
      console.error("[gateway] تعذّر تحميل الإعدادات المحفوظة:", e instanceof Error ? e.message : e);
    }
  }
  return getGatewayConfig();
}

export async function saveGatewayConfig(db: PrismaClient, cfg: GatewayConfig, actor: string) {
  const { before, after } = await setSetting(db, GATEWAY_KEY, cfg, actor);
  setGatewayConfig(cfg);
  g.__s1GatewayLoaded = true;
  return { before, after };
}
