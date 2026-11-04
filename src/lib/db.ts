// اتصال قاعدة البيانات (Prisma 7 مع محوّل pg). الرابط من DATABASE_URL على الخادم بس.
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const g = globalThis as unknown as { __s1Prisma?: PrismaClient };

export function dbConfigured(env = process.env): boolean {
  return Boolean(env.DATABASE_URL);
}

export function getDb(): PrismaClient {
  if (g.__s1Prisma) return g.__s1Prisma;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL مش مضبوط");
  g.__s1Prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  return g.__s1Prisma;
}
