import { apiError, guard } from "@/lib/api-guard";
import { getDb } from "@/lib/db";
import { STATUS_LABELS_AR, isStatus, type CandidateStatus } from "@/core/candidate-status";
import { scrub } from "@/sources/mapping";
import { ingestDrafts, type DraftEx } from "@/sources/ingest";
import { LANE_LABELS_AR } from "@/pipeline/card";

export const dynamic = "force-dynamic";

// قائمة المرشحين: فلاتر الحالة والمسار والمشكلة والبحث. الأرقام المعروضة محسوبة بالكود.
export const GET = guard("dashboard.view", async ({ req }) => {
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const lane = q.get("lane");
  const text = q.get("q")?.trim();
  const db = getDb();
  const where = {
    deletedAt: null,
    ...(status && isStatus(status) ? { status: status as never } : {}),
    ...(lane && lane in LANE_LABELS_AR ? { lane: lane as never } : {}),
    ...(q.get("problem") ? { problemId: q.get("problem")! } : {}),
    ...(text ? { OR: [{ titleAr: { contains: text, mode: "insensitive" as const } }, { titleSrc: { contains: text, mode: "insensitive" as const } }] } : {}),
  };
  const rows = await db.candidate.findMany({ where, include: { problem: { select: { nameAr: true } } }, orderBy: [{ velocityScore: { sort: "desc", nulls: "last" } }, { lastSeenAt: "desc" }], take: 200 });
  const groups = await db.candidate.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } });
  return Response.json({
    counts: Object.fromEntries(groups.map((g) => [g.status, g._count._all])),
    items: rows.map((c) => ({
      id: c.id, titleAr: c.titleAr, problem: c.problem?.nameAr ?? null, lane: c.lane, laneLabel: LANE_LABELS_AR[c.lane], status: c.status, statusLabel: STATUS_LABELS_AR[c.status as CandidateStatus],
      velocity: c.velocityScore, dna: c.dnaScore, suggested: c.decisionSuggested, conflict: c.conflictFlag, sourcesCount: c.sourcesCount, lastSeenAt: c.lastSeenAt.toISOString(),
    })),
  });
});

// إدخال يدوي: منتج أو فكرة (رابط · صورة · ملاحظة · السوق). بيدخل كمرشح بنفس المسار، بثقة «يدوي» 0.5.
export const POST = guard("capture.create", async ({ req, user, audit }) => {
  const body = (await req.json().catch(() => null)) as { title?: string; url?: string; imageUrl?: string; note?: string; market?: string } | null;
  const title = scrub(body?.title?.trim() ?? "").slice(0, 200);
  if (!title) return apiError(400, "bad_request", "اكتب اسم المنتج أو الفكرة");
  const okUrl = (u?: string) => !u || /^https?:\/\//i.test(u);
  if (!okUrl(body?.url) || !okUrl(body?.imageUrl)) return apiError(400, "bad_request", "الرابط لازم يبدأ بـ http");
  const market = body?.market?.toUpperCase();
  if (market && !/^[A-Z]{2}$/.test(market)) return apiError(400, "bad_request", "السوق لازم رمز حرفين");
  const draft: DraftEx = {
    title, url: body?.url || null, market: market || null, capturedAt: new Date().toISOString().slice(0, 10), price: null, currency: null, sales: null, reviews: null, rating: null, listingAgeDays: null,
    trendAgeDays: null, adStartDate: null, adVersions: null, advertisersInMarket: null, creators: null, newCreators7d: null, newCreatorsPrev7d: null, intentComments: null, skepticComments: null,
    commentSample: null, engagementRate: null, yellowCartShare: null, cumulativeSales: null, imageUrl: body?.imageUrl || null, problem: null, sourceNote: body?.note ? scrub(body.note).slice(0, 500) : null,
  };
  const r = await ingestDrafts(getDb(), [draft], { source: "manual", access: "manual", lane: "manual", capturedBy: user.sub });
  const cand = await getDb().candidate.findFirst({ where: { titleSrc: { equals: title, mode: "insensitive" }, deletedAt: null } });
  audit("Candidate", cand?.id ?? null, null, { title, manual: true });
  return Response.json({ id: cand?.id, ...r }, { status: 201 });
});
