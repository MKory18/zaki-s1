// ربط الأعمدة: عمود بالملف ← حقل بملاحظة المصدر. بيتحفظ لكل مصدر، وبنقترحه تلقائياً من عناوين الأعمدة (عربي · إنجليزي · صيني).
// ولا بيانات شخصية: ما في حقل للتعليقات الخام (العدّ بس)، والإيميلات والأرقام بتنشال من النصوص.
export const TARGETS = [
  { id: "title", label: "عنوان المنتج", required: true },
  { id: "url", label: "الرابط" },
  { id: "market", label: "السوق (رمز حرفين)" },
  { id: "capturedAt", label: "تاريخ البيانات" },
  { id: "price", label: "السعر" },
  { id: "currency", label: "العملة" },
  { id: "sales", label: "المبيعات الظاهرة" },
  { id: "reviews", label: "عدد التقييمات" },
  { id: "rating", label: "معدل التقييم" },
  { id: "listingAgeDays", label: "عمر المنتج أو المتجر (أيام)" },
  { id: "trendAgeDays", label: "عمر الترند (أيام)" },
  { id: "adStartDate", label: "تاريخ بدء الإعلان" },
  { id: "adVersions", label: "عدد نسخ الإعلان" },
  { id: "advertisersInMarket", label: "عدد المعلنين بالسوق" },
  { id: "creators", label: "الصنّاع الكلي" },
  { id: "newCreators7d", label: "صنّاع جدد آخر 7 أيام" },
  { id: "newCreatorsPrev7d", label: "صنّاع جدد بالـ 7 قبلها" },
  { id: "intentComments", label: "تعليقات نية الشراء (عدد)" },
  { id: "skepticComments", label: "تعليقات التشكيك (عدد)" },
  { id: "commentSample", label: "حجم عيّنة التعليقات" },
  { id: "engagementRate", label: "حرارة التفاعل" },
  { id: "yellowCartShare", label: "السلة الصفراء" },
  { id: "cumulativeSales", label: "المبيعات التراكمية" },
  { id: "imageUrl", label: "رابط الصورة" },
  { id: "problem", label: "المشكلة" },
] as const;

export type TargetId = (typeof TARGETS)[number]["id"];
export type Mapping = Partial<Record<TargetId, string>>; // الهدف ← عنوان العمود

// مرادفات عناوين الأعمدة لاقتراح الربط تلقائياً
const SYNONYMS: Record<TargetId, string[]> = {
  title: ["title", "product", "product name", "name", "عنوان", "المنتج", "اسم المنتج", "商品名称", "商品名", "标题", "name_zh"],
  url: ["url", "link", "product url", "الرابط", "رابط", "链接", "商品链接"],
  market: ["market", "country", "السوق", "البلد", "国家"],
  capturedAt: ["date", "captured at", "التاريخ", "日期", "时间"],
  price: ["price", "السعر", "价格", "售价"],
  currency: ["currency", "العملة", "币种"],
  sales: ["sales", "sold", "orders", "المبيعات", "销量", "销售量"],
  reviews: ["reviews", "review count", "التقييمات", "评价数", "评论数"],
  rating: ["rating", "stars", "التقييم", "评分"],
  listingAgeDays: ["listing age", "age days", "عمر المنتج", "上架天数"],
  trendAgeDays: ["trend age", "trend_age_days", "trend age days", "عمر الترند", "趋势天数", "爆款天数"],
  adStartDate: ["start date", "ad start date", "ad_delivery_start_time", "تاريخ بدء الإعلان", "开始日期"],
  adVersions: ["versions", "ad versions", "ads count", "عدد النسخ", "素材数"],
  advertisersInMarket: ["advertisers", "advertisers in market", "المعلنين", "广告主数"],
  creators: ["creators", "creators total", "creators_total", "الصنّاع", "达人数", "带货达人数"],
  newCreators7d: ["new creators 7d", "new_creators_7d", "صنّاع جدد 7", "近7天新增达人"],
  newCreatorsPrev7d: ["new creators prev 7d", "new_creators_prev_7d", "صنّاع جدد قبلها", "前7天新增达人"],
  intentComments: ["intent comments", "intent_comments", "تعليقات النية", "求购评论数"],
  skepticComments: ["skeptic comments", "skeptic_comments", "تعليقات التشكيك", "质疑评论数"],
  commentSample: ["comment sample", "comment_sample", "عيّنة التعليقات", "评论样本数"],
  engagementRate: ["engagement", "engagement rate", "engagement_rate", "التفاعل", "互动率"],
  yellowCartShare: ["yellow cart", "yellow_cart_share", "السلة الصفراء", "挂车率", "小黄车占比"],
  cumulativeSales: ["cumulative sales", "cumulative_sales", "المبيعات التراكمية", "累计销量"],
  imageUrl: ["image", "image url", "الصورة", "图片", "主图"],
  problem: ["problem", "category", "المشكلة", "الفئة", "类目"],
};

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s_\-]+/g, " ");

// اقتراح ربط: لكل هدف أول عمود عنوانه يطابق مرادف (ولا عمود بينربط لهدفين)
export function suggestMapping(headers: string[]): Mapping {
  const out: Mapping = {};
  const used = new Set<string>();
  for (const t of TARGETS) {
    const hit = headers.find((h) => !used.has(h) && SYNONYMS[t.id].some((s) => norm(s) === norm(h)));
    if (hit) {
      out[t.id] = hit;
      used.add(hit);
    }
  }
  return out;
}

export class MappingError extends Error {}

export function validateMapping(mapping: Mapping, headers: string[]): Mapping {
  const clean: Mapping = {};
  for (const [k, v] of Object.entries(mapping)) {
    if (!v) continue;
    if (!TARGETS.some((t) => t.id === k)) throw new MappingError(`هدف مجهول: ${k}`);
    if (!headers.includes(v)) throw new MappingError(`العمود «${v}» مش موجود بالملف`);
    clean[k as TargetId] = v;
  }
  if (!clean.title && !clean.url) throw new MappingError("لازم تربط عمود العنوان أو الرابط");
  return clean;
}

// ───── تحويل صف لملاحظة مصدر ─────
export interface Draft {
  title: string;
  url: string | null;
  market: string | null;
  capturedAt: string | null; // ISO
  price: string | null; // نص عشري بخانتين
  currency: string | null;
  sales: number | null;
  reviews: number | null;
  rating: number | null;
  listingAgeDays: number | null;
  trendAgeDays: number | null;
  adStartDate: string | null;
  adVersions: number | null;
  advertisersInMarket: number | null;
  creators: number | null;
  newCreators7d: number | null;
  newCreatorsPrev7d: number | null;
  intentComments: number | null;
  skepticComments: number | null;
  commentSample: number | null;
  engagementRate: number | null; // نسبة 0..1
  yellowCartShare: number | null; // نسبة 0..1
  cumulativeSales: number | null;
  imageUrl: string | null;
  problem: string | null;
}

export class RowError extends Error {}

// أرقام: بتقبل الفواصل و«12K» و«1.2万» و«٣٤» (أرقام عربية)
export function toNumber(raw: string): number | null {
  let s = raw.trim();
  if (s === "" || s === "—" || s === "-" || s.toLowerCase() === "null" || s.toLowerCase() === "n/a") return null;
  s = s.replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/[,،\s]/g, "").replace(/[$€£¥]/g, "");
  let mult = 1;
  if (/万$/.test(s)) (mult = 10_000), (s = s.slice(0, -1));
  else if (/亿$/.test(s)) (mult = 100_000_000), (s = s.slice(0, -1));
  else if (/k$/i.test(s)) (mult = 1000), (s = s.slice(0, -1));
  else if (/m$/i.test(s)) (mult = 1_000_000), (s = s.slice(0, -1));
  if (!/^-?\d+(\.\d+)?$/.test(s)) throw new RowError(`قيمة رقمية غلط: «${raw}»`);
  return Number(s) * mult;
}

// نسبة: «6%» أو «0.06» أو «6» (فوق 1 = مئوية)
export function toRatio(raw: string): number | null {
  const pct = raw.includes("%");
  const n = toNumber(raw.replace("%", ""));
  if (n === null) return null;
  const r = pct || n > 1 ? n / 100 : n;
  if (r < 0 || r > 1) throw new RowError(`النسبة خارج 0–100%: «${raw}»`);
  return r;
}

export function toDate(raw: string): string | null {
  const s = raw.trim();
  if (!s || s === "—") return null;
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s) ?? /^(\d{4})年(\d{1,2})月(\d{1,2})/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  else if (/^\d{4}-\d{2}-\d{2}T/.test(s)) iso = s.slice(0, 10);
  if (!iso || Number.isNaN(Date.parse(iso))) throw new RowError(`تاريخ غلط: «${raw}»`);
  return iso;
}

// نشيل الإيميلات وأرقام الهواتف من أي نص قبل التخزين (ولا بيانات شخصية)
export function scrub(s: string): string {
  return s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[محذوف]").replace(/(?:\+|00)?\d(?:[\s-]?\d){8,}/g, "[محذوف]");
}

export function rowToDraft(headers: string[], row: string[], mapping: Mapping): Draft {
  const get = (t: TargetId) => {
    const col = mapping[t];
    return col ? (row[headers.indexOf(col)] ?? "").trim() : "";
  };
  const int = (t: TargetId) => {
    const n = toNumber(get(t));
    return n === null ? null : Math.round(n);
  };
  const title = scrub(get("title"));
  const url = get("url") || null;
  if (!title && !url) throw new RowError("بلا عنوان ولا رابط");
  const priceN = toNumber(get("price"));
  const rating = toNumber(get("rating"));
  if (rating !== null && (rating < 0 || rating > 5)) throw new RowError(`التقييم خارج 0–5: «${get("rating")}»`);
  const market = get("market").toUpperCase();
  if (market && !/^[A-Z]{2}$/.test(market)) throw new RowError(`السوق لازم رمز حرفين: «${get("market")}»`);
  const cur = get("currency").toUpperCase();
  if (cur && !/^[A-Z]{3}$/.test(cur)) throw new RowError(`العملة لازم رمز ثلاثي: «${get("currency")}»`);
  const urlOk = (u: string | null) => u === null || /^https?:\/\//i.test(u);
  if (!urlOk(url)) throw new RowError(`الرابط لازم يبدأ بـ http: «${url}»`);
  const img = get("imageUrl") || null;
  if (!urlOk(img)) throw new RowError("رابط الصورة لازم يبدأ بـ http");
  return {
    title: title || (url as string),
    url,
    market: market || null,
    capturedAt: toDate(get("capturedAt")),
    price: priceN === null ? null : priceN.toFixed(2),
    currency: cur || null,
    sales: int("sales"),
    reviews: int("reviews"),
    rating,
    listingAgeDays: int("listingAgeDays"),
    trendAgeDays: int("trendAgeDays"),
    adStartDate: toDate(get("adStartDate")),
    adVersions: int("adVersions"),
    advertisersInMarket: int("advertisersInMarket"),
    creators: int("creators"),
    newCreators7d: int("newCreators7d"),
    newCreatorsPrev7d: int("newCreatorsPrev7d"),
    intentComments: int("intentComments"),
    skepticComments: int("skepticComments"),
    commentSample: int("commentSample"),
    engagementRate: get("engagementRate") ? toRatio(get("engagementRate")) : null,
    yellowCartShare: get("yellowCartShare") ? toRatio(get("yellowCartShare")) : null,
    cumulativeSales: int("cumulativeSales"),
    imageUrl: img,
    problem: get("problem") ? scrub(get("problem")) : null,
  };
}
