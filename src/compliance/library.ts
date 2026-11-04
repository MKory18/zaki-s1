// مكتبات الامتثال بالتعديل: النصوص (بحالات المراجعة) · المكونات والمحظورات · الادعاءات · قواعد الإعلانات (بتاريخ آخر مراجعة).
// أي تعديل بيطلق حدث compliance.updated. النص ما بيدخل إلا باعتماد المراجع الشرعي، وأي تعديل على نص معتمد بيرجّعه لـ«بانتظار المراجع».
import type { PrismaClient } from "@/generated/prisma/client";
import { badRequest, conflict, notFound, refused, str, date } from "./errors";
import { emitEvent } from "./events";

export const LIBS = ["references", "ingredients", "claims", "ad-rules"] as const;
export type LibName = (typeof LIBS)[number];
export const isLib = (v: unknown): v is LibName => typeof v === "string" && (LIBS as readonly string[]).includes(v);

const TEXT_KINDS = ["hadith", "quran", "heritage"] as const;
const ING_STATUS = ["allowed", "restricted", "banned"] as const;
const APPLIES = ["cosmetic", "therapeutic", "all"] as const;
const oneOf = <T extends string>(v: unknown, list: readonly T[], field: string): T => {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) throw badRequest(`${field}: واحدة من ${list.join(" · ")}`);
  return v as T;
};
// نص ضعيف أو مختلف فيه: ما بيدخل المكتبة معتمد بلا قرار مختص
export const WEAK_GRADING = /مختلف|ضعيف|موضوع|لا يصح|لا أصل/;

const iso = (d: Date | null) => d?.toISOString() ?? null;

type Row = Record<string, unknown>;
const reviewOf = (r: { reviewStatus: string; reviewerId: string | null; reviewedAt: Date | null; reviewNote: string | null }) => ({ reviewStatus: r.reviewStatus, reviewerId: r.reviewerId, reviewedAt: iso(r.reviewedAt), reviewNote: r.reviewNote });

export async function listLibrary(db: PrismaClient, lib: LibName): Promise<Row[]> {
  if (lib === "references") {
    const rows = await db.referenceText.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });
    return rows.map((r) => ({ id: r.id, code: r.code, kind: r.kind, ingredient: r.ingredient, text: r.text, source: r.source, number: r.number, grading: r.grading, usageRule: r.usageRule, ...reviewOf(r) }));
  }
  if (lib === "ingredients") {
    const rows = await db.ingredient.findMany({ where: { deletedAt: null }, orderBy: [{ status: "asc" }, { nameAr: "asc" }] });
    return rows.map((r) => ({ id: r.id, nameAr: r.nameAr, nameEn: r.nameEn, inci: r.inci, origin: r.origin, status: r.status, note: r.note, adulterationRisk: r.adulterationRisk }));
  }
  if (lib === "claims") {
    const rows = await db.claimRule.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
    return rows.map((r) => ({ id: r.id, phrase: r.phrase, reason: r.reason, alternative: r.alternative, appliesTo: r.appliesTo, country: r.country }));
  }
  const rows = await db.adPolicyRule.findMany({ orderBy: { createdAt: "asc" } });
  const now = Date.now();
  return rows.map((r) => ({ id: r.id, platform: r.platform, rule: r.rule, wrongExample: r.wrongExample, rightExample: r.rightExample, lastReviewedAt: r.lastReviewedAt.toISOString(), staleDays: Math.floor((now - r.lastReviewedAt.getTime()) / 86_400_000) }));
}

async function changed(db: PrismaClient, lib: LibName, action: "create" | "update" | "delete" | "review", id: string, now: Date) {
  await emitEvent(db, "compliance.updated", { reason: "library", library: lib, action, id, updated_at: now.toISOString() }, now);
}

type Body = Record<string, unknown>;

export async function createLibraryRow(db: PrismaClient, lib: LibName, body: Body, now: Date = new Date()): Promise<Row> {
  if (lib === "references") {
    const code = str(body.code, "الرمز", { required: true, max: 24 })!;
    if (!/^[A-Za-z0-9_-]{2,24}$/.test(code)) throw badRequest("الرمز: حروف إنجليزية وأرقام و- بس");
    if (await db.referenceText.findUnique({ where: { code } })) throw conflict("الرمز مستعمل");
    const grading = str(body.grading, "الدرجة");
    const created = await db.referenceText.create({
      data: {
        code,
        kind: oneOf(body.kind, TEXT_KINDS, "النوع"),
        ingredient: str(body.ingredient, "المكوّن"),
        text: str(body.text, "النص", { required: true, max: 2000 })!,
        source: str(body.source, "المصدر", { required: true })!,
        number: str(body.number, "الرقم"),
        grading,
        usageRule: str(body.usageRule, "قاعدة الاستخدام"),
        reviewStatus: grading && WEAK_GRADING.test(grading) ? "needs_specialist" : "pending", // المختلف فيه بيوقف من أول لحظة
      },
    });
    await changed(db, lib, "create", created.id, now);
    return (await listLibrary(db, lib)).find((r) => r.id === created.id)!;
  }
  if (lib === "ingredients") {
    const created = await db.ingredient.create({
      data: {
        nameAr: str(body.nameAr, "الاسم بالعربي", { required: true })!,
        nameEn: str(body.nameEn, "الاسم بالإنجليزي"),
        inci: str(body.inci, "INCI"),
        origin: str(body.origin, "الأصل"),
        status: oneOf(body.status, ING_STATUS, "الحالة"),
        note: str(body.note, "ملاحظة"),
        adulterationRisk: str(body.adulterationRisk, "خطر الغش"),
      },
    });
    await changed(db, lib, "create", created.id, now);
    return (await listLibrary(db, lib)).find((r) => r.id === created.id)!;
  }
  if (lib === "claims") {
    const created = await db.claimRule.create({
      data: {
        phrase: str(body.phrase, "العبارة الممنوعة", { required: true })!,
        reason: str(body.reason, "السبب", { required: true })!,
        alternative: str(body.alternative, "البديل"),
        appliesTo: body.appliesTo === undefined ? "all" : oneOf(body.appliesTo, APPLIES, "ينطبق على"),
        country: str(body.country, "البلد", { max: 4 })?.toUpperCase() ?? null,
      },
    });
    await changed(db, lib, "create", created.id, now);
    return (await listLibrary(db, lib)).find((r) => r.id === created.id)!;
  }
  const created = await db.adPolicyRule.create({
    data: {
      platform: str(body.platform, "المنصة") ?? "عام",
      rule: str(body.rule, "القاعدة", { required: true })!,
      wrongExample: str(body.wrongExample, "مثال غلط"),
      rightExample: str(body.rightExample, "مثال صح"),
      lastReviewedAt: date(body.lastReviewedAt, "آخر مراجعة") ?? now,
    },
  });
  await changed(db, lib, "create", created.id, now);
  return (await listLibrary(db, lib)).find((r) => r.id === created.id)!;
}

export async function updateLibraryRow(db: PrismaClient, lib: LibName, id: string, body: Body, now: Date = new Date()): Promise<Row> {
  const has = (k: string) => body[k] !== undefined;
  if (lib === "references") {
    const cur = await db.referenceText.findFirst({ where: { id, deletedAt: null } });
    if (!cur) throw notFound("النص مش موجود");
    const data: Body = {};
    if (has("kind")) data.kind = oneOf(body.kind, TEXT_KINDS, "النوع");
    if (has("ingredient")) data.ingredient = str(body.ingredient, "المكوّن");
    if (has("text")) data.text = str(body.text, "النص", { required: true, max: 2000 });
    if (has("source")) data.source = str(body.source, "المصدر", { required: true });
    if (has("number")) data.number = str(body.number, "الرقم");
    if (has("grading")) data.grading = str(body.grading, "الدرجة");
    if (has("usageRule")) data.usageRule = str(body.usageRule, "قاعدة الاستخدام");
    // تعديل المحتوى (النص أو المصدر أو الرقم أو الدرجة) بيلغي الاعتماد: لازم المراجع يشوفه من جديد
    const content = ["text", "source", "number", "grading", "kind"].some((k) => has(k) && data[k] !== (cur as unknown as Body)[k]);
    if (content && cur.reviewStatus !== "pending") Object.assign(data, { reviewStatus: WEAK_GRADING.test(String(data.grading ?? cur.grading ?? "")) ? "needs_specialist" : "pending", reviewerId: null, reviewedAt: null, reviewNote: null });
    await db.referenceText.update({ where: { id }, data: data as never });
  } else if (lib === "ingredients") {
    if (!(await db.ingredient.findFirst({ where: { id, deletedAt: null } }))) throw notFound("المكوّن مش موجود");
    const data: Body = {};
    if (has("nameAr")) data.nameAr = str(body.nameAr, "الاسم بالعربي", { required: true });
    if (has("nameEn")) data.nameEn = str(body.nameEn, "الاسم بالإنجليزي");
    if (has("inci")) data.inci = str(body.inci, "INCI");
    if (has("origin")) data.origin = str(body.origin, "الأصل");
    if (has("status")) data.status = oneOf(body.status, ING_STATUS, "الحالة");
    if (has("note")) data.note = str(body.note, "ملاحظة");
    if (has("adulterationRisk")) data.adulterationRisk = str(body.adulterationRisk, "خطر الغش");
    await db.ingredient.update({ where: { id }, data: data as never });
  } else if (lib === "claims") {
    if (!(await db.claimRule.findFirst({ where: { id, deletedAt: null } }))) throw notFound("القاعدة مش موجودة");
    const data: Body = {};
    if (has("phrase")) data.phrase = str(body.phrase, "العبارة الممنوعة", { required: true });
    if (has("reason")) data.reason = str(body.reason, "السبب", { required: true });
    if (has("alternative")) data.alternative = str(body.alternative, "البديل");
    if (has("appliesTo")) data.appliesTo = oneOf(body.appliesTo, APPLIES, "ينطبق على");
    if (has("country")) data.country = str(body.country, "البلد", { max: 4 })?.toUpperCase() ?? null;
    await db.claimRule.update({ where: { id }, data: data as never });
  } else {
    if (!(await db.adPolicyRule.findUnique({ where: { id } }))) throw notFound("القاعدة مش موجودة");
    const data: Body = {};
    if (has("platform")) data.platform = str(body.platform, "المنصة", { required: true });
    if (has("rule")) data.rule = str(body.rule, "القاعدة", { required: true });
    if (has("wrongExample")) data.wrongExample = str(body.wrongExample, "مثال غلط");
    if (has("rightExample")) data.rightExample = str(body.rightExample, "مثال صح");
    if (body.reviewed === true) data.lastReviewedAt = now; // «راجعتها اليوم»
    else if (has("lastReviewedAt")) data.lastReviewedAt = date(body.lastReviewedAt, "آخر مراجعة") ?? now;
    await db.adPolicyRule.update({ where: { id }, data: data as never });
  }
  await changed(db, lib, "update", id, now);
  return (await listLibrary(db, lib)).find((r) => r.id === id)!;
}

export async function deleteLibraryRow(db: PrismaClient, lib: LibName, id: string, now: Date = new Date()): Promise<void> {
  if (lib === "ad-rules") {
    if (!(await db.adPolicyRule.findUnique({ where: { id } }))) throw notFound("القاعدة مش موجودة");
    await db.adPolicyRule.delete({ where: { id } });
  } else {
    const model = lib === "references" ? db.referenceText : lib === "ingredients" ? db.ingredient : db.claimRule;
    const found = await (model as unknown as { findFirst: (a: unknown) => Promise<unknown> }).findFirst({ where: { id, deletedAt: null } });
    if (!found) throw notFound("السجل مش موجود");
    await (model as unknown as { update: (a: unknown) => Promise<unknown> }).update({ where: { id }, data: { deletedAt: now } });
  }
  await changed(db, lib, "delete", id, now);
}

// ───── اعتماد النصوص: المراجع الشرعي (والمالك) ─────
export type TextDecision = "approve" | "reject" | "needs_specialist";

export async function reviewText(db: PrismaClient, id: string, actorId: string, input: { decision?: unknown; note?: unknown }, now: Date = new Date()) {
  const decision = oneOf(input.decision, ["approve", "reject", "needs_specialist"] as const, "القرار");
  const t = await db.referenceText.findFirst({ where: { id, deletedAt: null } });
  if (!t) throw notFound("النص مش موجود");
  const note = str(input.note, "السبب", { max: 1000 });
  const weak = WEAK_GRADING.test(t.grading ?? "") || t.reviewStatus === "needs_specialist";
  if (decision !== "approve" && !note) throw badRequest("السبب مطلوب لما ترفض أو توقف النص");
  if (decision === "approve" && weak && (!note || note.length < 5)) throw refused("النص مختلف فيه أو موقوف لقرار مختص: اكتب أساس قرارك (5 أحرف على الأقل) عشان يتعتمد");
  if (decision === "approve" && !t.grading) throw refused("ما في درجة للنص (صحيح · حسن · متفق عليه): ما بيتعتمد");
  const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "needs_specialist";
  await db.referenceText.update({ where: { id }, data: { reviewStatus: status, reviewerId: actorId, reviewedAt: now, reviewNote: note } });
  await changed(db, "references", "review", id, now);
  return { id, code: t.code, reviewStatus: status, reviewerId: actorId, reviewedAt: now.toISOString(), reviewNote: note };
}
