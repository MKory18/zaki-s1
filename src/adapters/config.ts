// وضع كل نظام (وهمي أو حقيقي) من الإعدادات integration.<النظام>، والعنوان والتوكن من .env على الخادم بس.
// ما بنقبل عنوان من الشاشة: العناوين من .env (موثوقة)، والشاشة بتختار الوضع بس.
import type { PrismaClient } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";
import { SYSTEMS, type SystemId } from "./contracts";

export type Mode = "mock" | "real";

export const settingKey = (s: SystemId) => `integration.${s}`;
export const baseUrlEnv = (s: SystemId) => `${s.toUpperCase()}_BASE_URL`;
export const tokenEnv = (s: SystemId) => `${s.toUpperCase()}_TOKEN`;

export async function getMode(db: PrismaClient, system: SystemId): Promise<Mode> {
  const s = await getSetting(db, settingKey(system));
  const raw = String((s?.value as { raw?: unknown } | undefined)?.raw ?? "mock").trim().toLowerCase();
  return raw === "real" ? "real" : "mock"; // أي قيمة غريبة = وهمي (الأمان أولاً)
}

export async function getModes(db: PrismaClient): Promise<Record<SystemId, Mode>> {
  const out = {} as Record<SystemId, Mode>;
  for (const s of SYSTEMS) out[s] = await getMode(db, s);
  return out;
}

// https إلزامي، والـ http بس لـ localhost (نفس قاعدة crm بالاستوديو)
export function validBaseUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1" || u.hostname === "[::1]";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return null;
    return url.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function s1PublicUrl(path: string, env = process.env): string {
  const base = (env.APP_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}
