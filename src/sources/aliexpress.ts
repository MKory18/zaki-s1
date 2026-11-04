// علي إكسبرس بالواجهة الرسمية (واجهة الشركاء، Affiliate API): بحث المنتجات · تفاصيل المنتج · الرائج.
// التوقيع: كل المعاملات (بدون sign) مرتبة أبجدياً ومدموجة مفتاح+قيمة، وHMAC-SHA256 بسر التطبيق، حروف كبيرة.
// ولا سحب لصفحات: بس الواجهة الرسمية بشروطها. المفتاح والسر والتتبع من .env، وما بيظهروا بأي رابط ولا سجل.
// ملاحظة صدق: الاستدعاء الحقيقي ما انفحص على حساب الشركاء (ما في مفتاح بعد). الوهمي بنفس الشكل المتوقع للرد.
import { createHmac } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { D } from "@/core/num";
import { raiseAlert } from "@/lib/alerts";
import { waitForSlot } from "@/adapters/limiter";
import { getSourceMode, type SourceMode } from "./modes";
import { ingestDrafts, recordJob, type DraftEx } from "./ingest";
import { scrub } from "./mapping";

export const ALI_GATEWAY = "https://api-sg.aliexpress.com/sync";
export const ALI_METHODS = {
  search: "aliexpress.affiliate.product.query",
  hot: "aliexpress.affiliate.hotproduct.query",
  detail: "aliexpress.affiliate.productdetail.get",
} as const;

export interface AliConfig {
  appKey: string;
  appSecret: string;
  trackingId: string;
}

export class SourceConfigError extends Error {}
export class SourceCallError extends Error {}

export function aliConfigFromEnv(env: Record<string, string | undefined> = process.env): AliConfig {
  const appKey = env.ALIEXPRESS_APP_KEY;
  const appSecret = env.ALIEXPRESS_APP_SECRET;
  const trackingId = env.ALIEXPRESS_TRACKING_ID;
  if (!appKey || !appSecret || !trackingId) throw new SourceConfigError("مفاتيح علي إكسبرس ناقصة (ALIEXPRESS_APP_KEY وALIEXPRESS_APP_SECRET وALIEXPRESS_TRACKING_ID)");
  return { appKey, appSecret, trackingId };
}

export function signParams(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params).filter((k) => k !== "sign").sort().map((k) => `${k}${params[k]}`).join("");
  return createHmac("sha256", secret).update(base).digest("hex").toUpperCase();
}

export function buildQuery(method: string, extra: Record<string, string>, cfg: AliConfig, now = Date.now()): URLSearchParams {
  const params: Record<string, string> = { method, app_key: cfg.appKey, timestamp: String(now), sign_method: "sha256", tracking_id: cfg.trackingId, ...extra };
  params.sign = signParams(params, cfg.appSecret);
  return new URLSearchParams(params);
}

export interface AliProduct {
  product_id?: string | number;
  product_title?: string;
  product_detail_url?: string;
  product_main_image_url?: string;
  target_sale_price?: string;
  target_sale_price_currency?: string;
  evaluate_rate?: string;
  lastest_volume?: string | number;
  first_level_category_name?: string;
}

// الرد بيجي ملفوف: aliexpress_affiliate_*_response.resp_result.result.products.product[]
export function parseProducts(json: unknown): AliProduct[] {
  const root = json as Record<string, unknown> | null;
  if (!root || typeof root !== "object") throw new SourceCallError("رد علي إكسبرس مش مفهوم");
  if ("error_response" in root) {
    const e = (root.error_response ?? {}) as { msg?: string; code?: string | number };
    throw new SourceCallError(`رفضت واجهة علي إكسبرس الطلب (${e.code ?? "؟"}): ${e.msg ?? "بلا رسالة"}`);
  }
  const wrapper = Object.entries(root).find(([k]) => /^aliexpress_affiliate_.*_response$/.test(k))?.[1] as { resp_result?: { resp_code?: number | string; resp_msg?: string; result?: { products?: { product?: AliProduct[] } } } } | undefined;
  if (!wrapper?.resp_result) throw new SourceCallError("رد علي إكسبرس بلا نتيجة");
  const code = Number(wrapper.resp_result.resp_code);
  if (code !== 200) throw new SourceCallError(`رفضت واجهة علي إكسبرس الطلب (${wrapper.resp_result.resp_code}): ${wrapper.resp_result.resp_msg ?? ""}`);
  return wrapper.resp_result.result?.products?.product ?? [];
}

export function productToDraft(p: AliProduct): DraftEx | null {
  const title = scrub(String(p.product_title ?? "")).trim();
  if (!title) return null;
  const pct = parseFloat(String(p.evaluate_rate ?? "").replace("%", ""));
  const price = parseFloat(String(p.target_sale_price ?? ""));
  const vol = Number(p.lastest_volume);
  const cur = String(p.target_sale_price_currency ?? "").toUpperCase();
  const url = String(p.product_detail_url ?? "");
  return {
    title,
    url: /^https?:\/\//.test(url) ? url : null,
    market: null,
    capturedAt: new Date().toISOString().slice(0, 10),
    price: Number.isFinite(price) ? price.toFixed(2) : null,
    currency: /^[A-Z]{3}$/.test(cur) ? cur : null,
    sales: Number.isFinite(vol) ? Math.round(vol) : null,
    reviews: null,
    rating: Number.isFinite(pct) ? D(pct).times(5).div(100).toDecimalPlaces(2).toNumber() : null, // التقييم من نسبة الرضا (تقريب عشري دقيق)
    listingAgeDays: null, trendAgeDays: null, adStartDate: null, adVersions: null, advertisersInMarket: null, creators: null, newCreators7d: null, newCreatorsPrev7d: null,
    intentComments: null, skepticComments: null, commentSample: null, engagementRate: null, yellowCartShare: null, cumulativeSales: null,
    imageUrl: /^https?:\/\//.test(String(p.product_main_image_url ?? "")) ? String(p.product_main_image_url) : null,
    problem: null,
    sourceNote: p.first_level_category_name ? scrub(String(p.first_level_category_name)) : null,
  };
}

// الخادم الوهمي: نفس شكل الرد الرسمي. «rosemary oil» بيرجّع ثلاث منتجات، وأي كلمة تانية منتج واحد، و«empty» ولا منتج.
export function createAliMockFetch(): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const q = new URL(String(input)).searchParams;
    const method = q.get("method") ?? "";
    const kw = (q.get("keywords") ?? "").toLowerCase();
    const mk = (id: number, title: string, price: string, vol: number, rate: string) => ({
      product_id: id, product_title: title, product_detail_url: `https://www.aliexpress.com/item/${id}.html`, product_main_image_url: `https://ae01.alicdn.com/kf/${id}.jpg`,
      target_sale_price: price, target_sale_price_currency: "USD", evaluate_rate: rate, lastest_volume: vol, first_level_category_name: "Beauty & Health",
    });
    let products: unknown[] = [];
    if (kw.includes("empty")) products = [];
    else if (kw.includes("rosemary")) products = [mk(1005001, "Rosemary Hair Growth Oil 60ml", "3.49", 12000, "94.5%"), mk(1005002, "Rosemary Mint Scalp Serum", "4.20", 3400, "92.0%"), mk(1005003, "Organic Rosemary Essential Oil 30ml", "2.10", 880, "90.5%")];
    else products = [mk(1006000 + kw.length, `Mock ${kw || "product"} item`, "5.00", 100, "95.0%")];
    const key = method.replace(/\./g, "_") + "_response";
    return Response.json({ [key]: { resp_result: { resp_code: 200, resp_msg: "OK", result: { current_record_count: products.length, products: { product: products } } } } });
  }) as typeof fetch;
}

export interface PullReport {
  jobId: string;
  status: string;
  keywords: number;
  ok: number;
  failed: number;
  observationsCreated: number;
  candidatesCreated: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

export interface PullDeps {
  mode?: SourceMode;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  sleep?: (ms: number) => Promise<void>;
  now?: number;
  pageSize?: number;
}

// سحب علي إكسبرس بكلمات: بحث لكل كلمة، ملاحظات بالرابط والتاريخ ونوع الوصول والثقة، وسجل نجاح أو فشل
export async function pullAliexpress(db: PrismaClient, keywords: string[], deps: PullDeps = {}): Promise<PullReport> {
  const mode = deps.mode ?? (await getSourceMode(db, "aliexpress"));
  const errors: { row: number; reason: string }[] = [];
  let cfg: AliConfig | null = null;
  if (mode === "real") {
    try {
      cfg = aliConfigFromEnv(deps.env);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "إعداد ناقص";
      raiseAlert({ type: "source_failed", severity: "warning", message: `علي إكسبرس: ${msg}` });
      const job = await recordJob(db, { source: "aliexpress", fileKey: "api:search", mapping: { keywords }, rows: keywords.length, ok: 0, failed: keywords.length, errors: [{ row: 0, reason: msg }] });
      return { jobId: job.id, status: job.status, keywords: keywords.length, ok: 0, failed: keywords.length, observationsCreated: 0, candidatesCreated: 0, duplicates: 0, errors: [{ row: 0, reason: msg }] };
    }
  }
  const f = deps.fetchImpl ?? (mode === "mock" ? createAliMockFetch() : fetch);
  const acc = { observationsCreated: 0, candidatesCreated: 0, duplicates: 0 };
  let ok = 0;
  for (const [i, kw] of keywords.entries()) {
    try {
      await waitForSlot("src:aliexpress", 2, deps.sleep);
      const q = buildQuery(ALI_METHODS.search, { keywords: kw, page_no: "1", page_size: String(deps.pageSize ?? 20), target_currency: "USD", target_language: "EN", ship_to_country: "JO", fields: "product_id,product_title,product_detail_url,product_main_image_url,target_sale_price,target_sale_price_currency,evaluate_rate,lastest_volume,first_level_category_name" }, cfg ?? { appKey: "mock", appSecret: "mock", trackingId: "mock" }, deps.now);
      const res = await f(`${ALI_GATEWAY}?${q.toString()}`, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new SourceCallError(`HTTP ${res.status}`);
      const products = parseProducts(await res.json());
      const drafts = products.map(productToDraft).filter((d): d is DraftEx => d !== null);
      const r = await ingestDrafts(db, drafts, { source: "aliexpress", access: "api", lane: "manual" });
      acc.observationsCreated += r.observationsCreated;
      acc.candidatesCreated += r.candidatesCreated;
      acc.duplicates += r.duplicates;
      ok += 1;
    } catch (e) {
      // الرسالة بلا أي رابط (الرابط فيه التوقيع)، فما بيتسرّب شي
      errors.push({ row: i + 1, reason: `${kw}: ${e instanceof Error ? e.message.replace(/https?:\/\/\S+/g, "[رابط]") : "فشل"}` });
    }
  }
  const job = await recordJob(db, { source: "aliexpress", fileKey: "api:search", mapping: { keywords, mode }, rows: keywords.length, ok, failed: errors.length, errors });
  return { jobId: job.id, status: job.status, keywords: keywords.length, ok, failed: errors.length, ...acc, errors };
}
