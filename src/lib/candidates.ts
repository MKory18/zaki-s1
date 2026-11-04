// تغيير حالة المرشح: الطريق الوحيد، وبيفحص الانتقال المسموح قبل ما يكتب.
import type { PrismaClient } from "@/generated/prisma/client";
import { assertTransition } from "@/core/candidate-status";

export async function transitionCandidate(db: PrismaClient, id: string, to: string) {
  return db.$transaction(async (tx) => {
    const c = await tx.candidate.findFirst({ where: { id, deletedAt: null }, select: { status: true } });
    if (!c) throw new Error("المرشح مش موجود");
    assertTransition(c.status, to); // بيرمي TransitionError لانتقال غير مسموح أو قيمة مجهولة
    return tx.candidate.update({ where: { id }, data: { status: to } });
  });
}
