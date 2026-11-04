// لوحة التنبيهات من جدول Alert (المصدر الدائم). الأحدث أول، والمفتوحة = ما انعمل لها «شفت».
import type { PrismaClient } from "@/generated/prisma/client";

export async function listBoard(db: PrismaClient, all = false, limit = 100) {
  const rows = await db.alert.findMany({ where: all ? {} : { ackAt: null }, orderBy: { createdAt: "desc" }, take: limit });
  return rows.map((a) => ({
    id: a.id,
    at: a.createdAt.toISOString(),
    type: a.type,
    severity: a.severity,
    message: a.message,
    link: a.link,
    channels: (Array.isArray(a.channels) ? a.channels : []) as string[],
    ackBy: a.ackBy,
    ackAt: a.ackAt?.toISOString() ?? null,
  }));
}

export async function ackAlert(db: PrismaClient, id: string, actor: string) {
  const a = await db.alert.findUnique({ where: { id } });
  if (!a) return null;
  if (a.ackAt) return { id, ackBy: a.ackBy, ackAt: a.ackAt.toISOString(), already: true };
  const u = await db.alert.update({ where: { id }, data: { ackBy: actor, ackAt: new Date() } });
  return { id, ackBy: u.ackBy, ackAt: u.ackAt!.toISOString(), already: false };
}
