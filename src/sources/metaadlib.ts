// مكتبة إعلانات ميتا الرسمية (Graph API، ads_archive) للإعلانات اللي وصلت أوروبا فقط، بكلمات البحث.
// خطر موثّق: الواجهة ما بترجّع الإعلانات التجارية برّا أوروبا. فإعلانات سوريا والأردن بتيجي من الإضافة بضغطة منك، مش من هون.
// التوكن META_ADLIB_TOKEN بيروح بالترويسة Authorization بس (مش بالرابط)، وما بيظهر بأي سجل.
// ملاحظة صدق: الاستدعاء الحقيقي ما انفحص (ما في توكن بعد ولا تأكيد هوية).
import type { PrismaClient } from "@/generated/prisma/client";
import { raiseAlert } from "@/lib/alerts";
import { waitForSlot } from "@/adapters/limiter";
import { ingestDrafts, recordJob, type DraftEx } from "./ingest";
import { getSourceMode } from "./modes";
import { scrub } from "./mapping";
import { SourceCallError, SourceConfigError, type PullDeps, type PullReport } from "./aliexpress";

export const META_ENDPOINT = "https://graph.facebook.com/v21.0/ads_archive";
export const EU_COUNTRIES = ["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE"];

export interface MetaAd {
  id?: string;
  page_name?: string;
  ad_delivery_start_time?: string;
  ad_snapshot_url?: string;
  publisher_platforms?: string[];
}

export function buildMetaUrl(keyword: string, limit = 50): string {
  const q = new URLSearchParams({
    search_terms: keyword,
    ad_type: "ALL",
    ad_active_status: "ACTIVE",
    ad_reached_countries: JSON.stringify(EU_COUNTRIES),
    fields: "id,page_name,ad_delivery_start_time,ad_snapshot_url,publisher_platforms",
    limit: String(limit),
  });
  return `${META_ENDPOINT}?${q.toString()}`;
}

// إشارات الكلمة: عدد الإعلانات (نسخ) · أقدم إعلان شغّال · عدد الصفحات المعلنة (نفس المنتج عند عدة صفحات = مثبت)
export function adsToDraft(keyword: string, ads: MetaAd[]): DraftEx | null {
  if (ads.length === 0) return null;
  const starts = ads.map((a) => a.ad_delivery_start_time?.slice(0, 10)).filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  const pages = [...new Set(ads.map((a) => scrub(a.page_name ?? "")).filter(Boolean))];
  const snaps = ads.map((a) => a.ad_snapshot_url).filter((u): u is string => !!u && /^https:\/\/(www\.)?facebook\.com\//.test(u)).slice(0, 5);
  return {
    title: keyword, url: snaps[0] ?? null, market: null, capturedAt: new Date().toISOString().slice(0, 10), price: null, currency: null, sales: null, reviews: null, rating: null,
    listingAgeDays: null, trendAgeDays: null, adStartDate: starts[0] ?? null, adVersions: ads.length, advertisersInMarket: null, creators: null, newCreators7d: null, newCreatorsPrev7d: null,
    intentComments: null, skepticComments: null, commentSample: null, engagementRate: null, yellowCartShare: null, cumulativeSales: null, imageUrl: null, problem: null,
    sourceNote: `إعلانات أوروبا: ${ads.length} نسخة من ${pages.length} صفحة معلنة. ${pages.slice(0, 5).join("، ")}`,
  };
}

export function createMetaMockFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const kw = (new URL(String(input)).searchParams.get("search_terms") ?? "").toLowerCase();
    const ad = (i: number, page: string, start: string) => ({ id: `ad_${i}`, page_name: page, ad_delivery_start_time: start, ad_snapshot_url: `https://www.facebook.com/ads/archive/render_ad/?id=${i}`, publisher_platforms: ["facebook", "instagram"] });
    const data = kw.includes("empty") ? [] : [ad(1, "Natural Beauty Shop", "2026-08-20"), ad(2, "Herbal House", "2026-09-10"), ad(3, "Natural Beauty Shop", "2026-09-25")];
    return Response.json({ data });
  }) as typeof fetch;
}

export async function pullMetaEu(db: PrismaClient, keywords: string[], deps: PullDeps = {}): Promise<PullReport> {
  const mode = deps.mode ?? (await getSourceMode(db, "meta_eu"));
  const errors: { row: number; reason: string }[] = [];
  const token = (deps.env ?? process.env).META_ADLIB_TOKEN;
  if (mode === "real" && !token) {
    const msg = new SourceConfigError("توكن مكتبة إعلانات ميتا ناقص (META_ADLIB_TOKEN)").message;
    raiseAlert({ type: "source_failed", severity: "warning", message: `مكتبة إعلانات ميتا: ${msg}` });
    const job = await recordJob(db, { source: "meta_eu", fileKey: "api:ads_archive", mapping: { keywords }, rows: keywords.length, ok: 0, failed: keywords.length, errors: [{ row: 0, reason: msg }] });
    return { jobId: job.id, status: job.status, keywords: keywords.length, ok: 0, failed: keywords.length, observationsCreated: 0, candidatesCreated: 0, duplicates: 0, errors: [{ row: 0, reason: msg }] };
  }
  const f = deps.fetchImpl ?? (mode === "mock" ? createMetaMockFetch() : fetch);
  const acc = { observationsCreated: 0, candidatesCreated: 0, duplicates: 0 };
  let ok = 0;
  for (const [i, kw] of keywords.entries()) {
    try {
      await waitForSlot("src:meta_eu", 2, deps.sleep);
      const res = await f(buildMetaUrl(kw), { method: "GET", headers: mode === "mock" ? {} : { authorization: `Bearer ${token}` }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new SourceCallError(`HTTP ${res.status}`);
      const body = (await res.json()) as { data?: MetaAd[]; error?: { message?: string } };
      if (body.error) throw new SourceCallError(`رفضت الواجهة الطلب: ${body.error.message ?? "بلا رسالة"}`.replace(/access_token=\S+/g, "[محجوب]"));
      const draft = adsToDraft(kw, body.data ?? []);
      if (draft) {
        const r = await ingestDrafts(db, [draft], { source: "meta_eu", access: "api", lane: "regional_proven" });
        acc.observationsCreated += r.observationsCreated;
        acc.candidatesCreated += r.candidatesCreated;
        acc.duplicates += r.duplicates;
      }
      ok += 1;
    } catch (e) {
      errors.push({ row: i + 1, reason: `${kw}: ${e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "[رابط]") : "فشل"}` });
    }
  }
  const job = await recordJob(db, { source: "meta_eu", fileKey: "api:ads_archive", mapping: { keywords, mode }, rows: keywords.length, ok, failed: errors.length, errors });
  return { jobId: job.id, status: job.status, keywords: keywords.length, ok, failed: errors.length, ...acc, errors };
}
