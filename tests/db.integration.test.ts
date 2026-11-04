// بيشتغل بس لما DATABASE_URL مضبوط على قاعدة فاضية اتطبّق عليها الترحيل (الـ CI بيعمل هيك).
import { afterAll, describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client";
import { TransitionError } from "../src/core/candidate-status";
import { getDb } from "../src/lib/db";
import { transitionCandidate } from "../src/lib/candidates";
import { inspectDb } from "../src/lib/db-inspect";

const has = Boolean(process.env.DATABASE_URL);

describe.skipIf(!has)("قاعدة البيانات الحقيقية", () => {
  afterAll(async () => {
    await getDb().$disconnect();
  });

  it("الترحيل اشتغل: 53 جدول وامتداد المتجهات", async () => {
    const r = await inspectDb();
    expect(r.connected).toBe(true);
    expect(r.vectorExtension).toBe(true);
    expect(r.tables.length).toBe(53);
  });

  it("انتقال حالة غلط بينرفض والقاعدة ما بتتغيّر، والصح بيمرّ", async () => {
    const db = getDb();
    const c = await db.candidate.create({ data: { titleAr: "اختبار", titleSrc: "test", lane: "manual" } });
    await expect(transitionCandidate(db, c.id, "launched")).rejects.toBeInstanceOf(TransitionError);
    await expect(transitionCandidate(db, c.id, "banana")).rejects.toBeInstanceOf(TransitionError);
    expect((await db.candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
    const up = await transitionCandidate(db, c.id, "scanned");
    expect(up.status).toBe("scanned");
    await db.candidate.delete({ where: { id: c.id } });
  });

  it("المبالغ بتنحفظ بدقة (بلا أخطاء الأعداد العائمة)", async () => {
    const db = getDb();
    const c = await db.candidate.create({ data: { titleAr: "ماء الكمأة", titleSrc: "x", lane: "manual" } });
    const e = await db.economicsCalc.create({
      data: {
        candidateId: c.id,
        market: "JO",
        inputsJson: {},
        lossLimit: new Prisma.Decimal("0.65"),
        cpaCeiling: new Prisma.Decimal("5.53"),
        scalingCeiling: new Prisma.Decimal("6.51"),
        scenariosJson: [],
        kind: "projection",
      },
    });
    expect(e.cpaCeiling.toString()).toBe("5.53");
    expect(new Prisma.Decimal("0.1").plus("0.2").toString()).toBe("0.3");
    await db.economicsCalc.delete({ where: { id: e.id } });
    await db.candidate.delete({ where: { id: c.id } });
  });

  it("التضمين بينحفظ وبيتبحث بالتشابه (pgvector)", async () => {
    const db = getDb();
    const vec = (x: number) => "[" + [x, ...Array(1023).fill(0)].join(",") + "]";
    const a = await db.candidate.create({ data: { titleAr: "أ", titleSrc: "a", lane: "manual" } });
    const b = await db.candidate.create({ data: { titleAr: "ب", titleSrc: "b", lane: "manual" } });
    await db.$executeRaw`UPDATE "Candidate" SET "textEmbedding" = ${vec(1)}::vector WHERE id = ${a.id}`;
    await db.$executeRaw`UPDATE "Candidate" SET "textEmbedding" = ${vec(-1)}::vector WHERE id = ${b.id}`;
    const near = await db.$queryRaw<{ id: string }[]>`
      SELECT id FROM "Candidate" WHERE "textEmbedding" IS NOT NULL ORDER BY "textEmbedding" <=> ${vec(0.9)}::vector LIMIT 1`;
    expect(near[0].id).toBe(a.id);
    await db.candidate.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});
