import { defineConfig } from "prisma/config";

// رابط القاعدة من .env (الاسم بس بالكود). بلا قيمة لتوليد العميل بيشتغل بقيمة مؤقتة غير مستعملة.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url: process.env.DATABASE_URL ?? "postgresql://placeholder:placeholder@localhost:5432/placeholder" },
});
