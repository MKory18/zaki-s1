// الجودة: سجل الدفعات · شهادات التحليل · الفحص المستقل · التعقيم · الإفراج، والتراخيص بتنبيه قبل الانتهاء.
// الدفعة ما بتنفرج إلا إذا نجحت كل شروط البوابة (core/quality.ts). التنبيهات بلا تكرار (نفس الرسالة المفتوحة ما بتنعاد).
import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlert } from "@/lib/alerts";
import { drain } from "@/lib/persist";
import { BATCH_CATEGORIES, daysUntil, isBatchCategory, isLicenseStatus, LICENSE_STATUSES, licenseAlert, releaseBlockers, type BatchCategory } from "@/core/quality";
import { badRequest, bool, conflict, date, int, notFound, refused, str } from "./errors";
import { emitEvent } from "./events";

type Body = Record<string, unknown>;
const iso = (d: Date | null) => d?.toISOString() ?? null;

// ───── تنبيه مرة وحدة: ما بنكرر رسالة مفتوحة (بالقاعدة ولا بنفس الجولة) ─────
export async function raiseOnce(db: PrismaClient, a: { type: string; severity: "info" | "warning" | "critical"; message: string; link?: string }, seen: Set<string>, now: Date = new Date()): Promise<boolean> {
  const key = `${a.type}|${a.message}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const open = await db.alert.findFirst({ where: { type: a.type, message: a.message, ackAt: null }, select: { id: true } });
  if (open) return false;
  raiseAlert({ type: a.type, severity: a.severity, message: a.message, link: a.link ?? null }, now);
  return true;
}

// ───── الدفعات ─────
export const batchView = (b: Awaited<ReturnType<PrismaClient["batch"]["findFirstOrThrow"]>>) => ({
  id: b.id, productRef: b.productRef, supplierId: b.supplierId, batchNo: b.batchNo, qty: b.qty, producedAt: iso(b.producedAt), expiresAt: iso(b.expiresAt),
  coaKey: b.coaKey, independentTestKey: b.independentTestKey, sterile: b.sterile, category: b.category ?? "general", heavyMetalsTested: b.heavyMetalsTested,
  status: b.status, releasedAt: iso(b.releasedAt), releasedBy: b.releasedBy, blockReason: b.blockReason, notes: b.notes, createdAt: b.createdAt.toISOString(),
});

export async function listBatches(db: PrismaClient, q: { status?: string | null; productRef?: string | null } = {}) {
  const rows = await db.batch.findMany({
    where: { deletedAt: null, ...(q.status ? { status: q.status as never } : {}), ...(q.productRef ? { productRef: q.productRef } : {}) },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  return rows.map(batchView);
}

async function checkSupplier(db: PrismaClient, supplierId: string | null) {
  if (supplierId && !(await db.supplier.findFirst({ where: { id: supplierId, deletedAt: null }, select: { id: true } }))) throw badRequest("المورّد مش موجود");
}

function batchFields(body: Body, partial: boolean) {
  const has = (k: string) => !partial || body[k] !== undefined;
  const d: Body = {};
  if (has("supplierId")) d.supplierId = str(body.supplierId, "المورّد");
  if (has("qty")) d.qty = int(body.qty, "الكمية", { min: 1, max: 10_000_000, required: !partial });
  if (has("producedAt")) d.producedAt = date(body.producedAt, "تاريخ الإنتاج");
  if (has("expiresAt")) d.expiresAt = date(body.expiresAt, "تاريخ الانتهاء");
  if (has("coaKey")) d.coaKey = str(body.coaKey, "مفتاح شهادة التحليل", { max: 500 });
  if (has("independentTestKey")) d.independentTestKey = str(body.independentTestKey, "مفتاح الفحص المستقل", { max: 500 });
  if (has("sterile")) d.sterile = bool(body.sterile, "التعقيم");
  if (has("heavyMetalsTested")) d.heavyMetalsTested = bool(body.heavyMetalsTested, "تحليل المعادن الثقيلة");
  if (has("category")) {
    const c = body.category === undefined || body.category === null || body.category === "" ? "general" : body.category;
    if (!isBatchCategory(c)) throw badRequest(`الفئة: ${BATCH_CATEGORIES.join(" · ")}`);
    d.category = c;
  }
  if (has("notes")) d.notes = str(body.notes, "ملاحظات");
  return d;
}

export async function createBatch(db: PrismaClient, body: Body) {
  const productRef = str(body.productRef, "المنتج", { required: true, max: 120 })!;
  const batchNo = str(body.batchNo, "رقم الدفعة", { required: true, max: 80 })!;
  const d = batchFields(body, false);
  await checkSupplier(db, (d.supplierId as string | null) ?? null);
  if (await db.batch.findUnique({ where: { productRef_batchNo: { productRef, batchNo } } })) throw conflict("رقم الدفعة مستعمل لنفس المنتج");
  const row = await db.batch.create({ data: { productRef, batchNo, ...d, status: "pending" } as never });
  return batchView(row);
}

export async function updateBatch(db: PrismaClient, id: string, body: Body) {
  const cur = await db.batch.findFirst({ where: { id, deletedAt: null } });
  if (!cur) throw notFound("الدفعة مش موجودة");
  if (cur.status !== "pending") throw conflict("الدفعة المفروجة أو الموقوفة ما بتتعدّل (سجلها ثابت)");
  const d = batchFields(body, true);
  if (d.supplierId !== undefined) await checkSupplier(db, d.supplierId as string | null);
  return batchView(await db.batch.update({ where: { id }, data: d as never }));
}

async function releaseContext(db: PrismaClient, b: { id: string; productRef: string; supplierId: string | null }, now: Date) {
  const earlier = await db.batch.count({ where: { id: { not: b.id }, productRef: b.productRef, deletedAt: null, status: "released", ...(b.supplierId ? { supplierId: b.supplierId } : {}) } });
  const pf = await db.productFile.findFirst({ where: { OR: [{ id: b.productRef }, { candidateId: b.productRef }], deletedAt: null }, select: { candidateId: true } });
  const check = await db.complianceCheck.findFirst({ where: { candidateId: pf?.candidateId ?? b.productRef }, orderBy: [{ stage: "desc" }, { createdAt: "desc" }] });
  const j = (check?.checksJson ?? {}) as { eye?: boolean; fraud_categories?: unknown[] };
  return { firstFromSupplier: earlier === 0, eyeFromCheck: Boolean(j.eye), fraudFromCheck: Array.isArray(j.fraud_categories) && j.fraud_categories.length > 0, now };
}

export async function releaseBatch(db: PrismaClient, id: string, actorId: string, now: Date = new Date()) {
  const b = await db.batch.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw notFound("الدفعة مش موجودة");
  if (b.status === "released") return batchView(b); // نفس الطلب مرتين = نفس النتيجة
  if (b.status === "blocked") throw conflict("الدفعة موقوفة: ما بترجع تنفرج (سجّل دفعة جديدة)");
  const blockers = releaseBlockers({ coaKey: b.coaKey, independentTestKey: b.independentTestKey, sterile: b.sterile, category: b.category, heavyMetalsTested: b.heavyMetalsTested, expiresAt: b.expiresAt }, await releaseContext(db, b, now));
  if (blockers.length) {
    if (!b.coaKey) {
      await raiseOnce(db, { type: "batch_no_certificate", severity: "warning", message: `الدفعة ${b.batchNo} (${b.productRef}) ما بتنفرج: ما في شهادة تحليل`, link: "/batches" }, new Set(), now);
      await drain();
    }
    throw refused(`الدفعة ما بتنفرج: ${blockers[0]}`, { blockers });
  }
  const u = await db.batch.update({ where: { id }, data: { status: "released", releasedAt: now, releasedBy: actorId } });
  return batchView(u);
}

export async function blockBatch(db: PrismaClient, id: string, actorId: string, input: { reason?: unknown }, now: Date = new Date()) {
  const reason = str(input.reason, "سبب الإيقاف", { required: true, max: 1000 })!;
  const b = await db.batch.findFirst({ where: { id, deletedAt: null } });
  if (!b) throw notFound("الدفعة مش موجودة");
  if (b.status === "blocked") return batchView(b);
  const u = await db.batch.update({ where: { id }, data: { status: "blocked", blockReason: reason, releasedBy: actorId } });
  await emitEvent(db, "batch.blocked", { batch_id: b.id, product_ref: b.productRef, batch_no: b.batchNo, reason, blocked_at: now.toISOString() }, now);
  raiseAlert({ type: "batch_blocked", severity: "critical", message: `انوقفت الدفعة ${b.batchNo} (${b.productRef}): ${reason}`, link: "/batches" }, now);
  await drain();
  return batchView(u);
}

// ───── التراخيص ─────
export const licenseView = (l: Awaited<ReturnType<PrismaClient["license"]["findFirstOrThrow"]>>, now: Date = new Date()) => ({
  id: l.id, productRef: l.productRef, country: l.country, authority: l.authority, type: l.type, regNo: l.regNo, issuedAt: iso(l.issuedAt), expiresAt: iso(l.expiresAt),
  status: l.status, alertDays: l.alertDays, daysLeft: l.expiresAt ? daysUntil(l.expiresAt, now) : null, alert: licenseAlert({ expiresAt: l.expiresAt, alertDays: l.alertDays, status: l.status }, now),
});

export async function listLicenses(db: PrismaClient, q: { productRef?: string | null } = {}, now: Date = new Date()) {
  const rows = await db.license.findMany({ where: { deletedAt: null, ...(q.productRef ? { productRef: q.productRef } : {}) }, orderBy: [{ expiresAt: { sort: "asc", nulls: "last" } }], take: 500 });
  return rows.map((l) => licenseView(l, now));
}

function licenseFields(body: Body, partial: boolean) {
  const has = (k: string) => !partial || body[k] !== undefined;
  const d: Body = {};
  if (has("country")) d.country = str(body.country, "البلد", { required: !partial, max: 4 })?.toUpperCase();
  if (has("authority")) d.authority = str(body.authority, "الجهة", { required: !partial });
  if (has("type")) d.type = str(body.type, "نوع الترخيص", { required: !partial });
  if (has("regNo")) d.regNo = str(body.regNo, "رقم التسجيل");
  if (has("issuedAt")) d.issuedAt = date(body.issuedAt, "تاريخ الإصدار");
  if (has("expiresAt")) d.expiresAt = date(body.expiresAt, "تاريخ الانتهاء");
  if (has("status")) {
    const s = body.status ?? "requested";
    if (!isLicenseStatus(s)) throw badRequest(`الحالة: ${LICENSE_STATUSES.join(" · ")}`);
    d.status = s;
  }
  if (has("alertDays")) d.alertDays = int(body.alertDays, "أيام التنبيه", { min: 1, max: 365 }) ?? 60;
  return d;
}

export async function createLicense(db: PrismaClient, body: Body, now: Date = new Date()) {
  const productRef = str(body.productRef, "المنتج", { required: true, max: 120 })!;
  const d = licenseFields(body, false);
  const row = await db.license.create({ data: { productRef, alertDays: 60, status: "requested", ...d } as never });
  await emitEvent(db, "compliance.updated", { reason: "license", product_ref: productRef, country: row.country, updated_at: now.toISOString() }, now);
  return licenseView(row, now);
}

export async function updateLicense(db: PrismaClient, id: string, body: Body, now: Date = new Date()) {
  const cur = await db.license.findFirst({ where: { id, deletedAt: null } });
  if (!cur) throw notFound("الترخيص مش موجود");
  const row = await db.license.update({ where: { id }, data: licenseFields(body, true) as never });
  await emitEvent(db, "compliance.updated", { reason: "license", product_ref: cur.productRef, country: row.country, updated_at: now.toISOString() }, now);
  return licenseView(row, now);
}

export async function deleteLicense(db: PrismaClient, id: string, now: Date = new Date()) {
  const cur = await db.license.findFirst({ where: { id, deletedAt: null } });
  if (!cur) throw notFound("الترخيص مش موجود");
  await db.license.update({ where: { id }, data: { deletedAt: now } });
}

// ───── المهام الدورية ─────
export interface SweepReport {
  alerts: number;
  events: number;
  checked: number;
}

// license.alerts (08:00): الترخيص ضمن نافذة التنبيه أو المنتهي ← تنبيه + حدث license.expiring للأزمات، مرة وحدة
export async function sweepLicenses(db: PrismaClient, now: Date = new Date()): Promise<SweepReport> {
  const rows = await db.license.findMany({ where: { deletedAt: null, expiresAt: { not: null } } });
  const seen = new Set<string>();
  const r: SweepReport = { alerts: 0, events: 0, checked: rows.length };
  for (const l of rows) {
    const a = licenseAlert({ expiresAt: l.expiresAt, alertDays: l.alertDays, status: l.status }, now);
    if (!a) continue;
    const day = l.expiresAt!.toISOString().slice(0, 10);
    const left = daysUntil(l.expiresAt!, now);
    const msg = a === "expired" ? `انتهى ترخيص ${l.productRef} في ${l.country} (${l.authority}) بتاريخ ${day}` : `ترخيص ${l.productRef} في ${l.country} (${l.authority}) بينتهي ${day} (باقي ${left} يوم)`;
    if (await raiseOnce(db, { type: "license_expiring", severity: a === "expired" ? "critical" : "warning", message: msg, link: "/licenses" }, seen, now)) {
      r.alerts += 1;
      await emitEvent(db, "license.expiring", { license_id: l.id, product_ref: l.productRef, country: l.country, expires_at: day, days_left: left, expired: a === "expired" }, now);
      r.events += 1;
    }
  }
  return r;
}

// دفعات معلّقة من أكتر من 24 ساعة بلا شهادة تحليل
export async function sweepBatches(db: PrismaClient, now: Date = new Date()): Promise<SweepReport> {
  const cutoff = new Date(now.getTime() - 24 * 3_600_000);
  const rows = await db.batch.findMany({ where: { deletedAt: null, status: "pending", coaKey: null, createdAt: { lte: cutoff } } });
  const seen = new Set<string>();
  const r: SweepReport = { alerts: 0, events: 0, checked: rows.length };
  for (const b of rows) {
    if (await raiseOnce(db, { type: "batch_no_certificate", severity: "warning", message: `الدفعة ${b.batchNo} (${b.productRef}) بلا شهادة تحليل من أكتر من يوم`, link: "/batches" }, seen, now)) r.alerts += 1;
  }
  return r;
}

// policy.staleness (الأحد): قواعد الإعلانات اللي ما انراجعت من 90 يوم
export async function sweepPolicies(db: PrismaClient, now: Date = new Date(), days = 90): Promise<SweepReport> {
  const rows = await db.adPolicyRule.findMany({ where: { lastReviewedAt: { lt: new Date(now.getTime() - days * 86_400_000) } }, orderBy: { lastReviewedAt: "asc" } });
  const r: SweepReport = { alerts: 0, events: 0, checked: rows.length };
  if (!rows.length) return r;
  const msg = `${rows.length} قاعدة إعلانات ما انراجعت من ${days} يوم (أقدمها: ${rows[0].rule}). راجع سياسة المنصة وسجّل «راجعتها».`;
  if (await raiseOnce(db, { type: "policy_stale", severity: "warning", message: msg, link: "/libraries?tab=adrules" }, new Set(), now)) r.alerts += 1;
  return r;
}

export type { BatchCategory };
