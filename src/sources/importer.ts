// استيراد الملفات: رفع ← ربط أعمدة (محفوظ لكل مصدر) ← معاينة ← استيراد. ودعم نتيجة Kimi (JSON) ومخطط الكلمات.
import type { PrismaClient } from "@/generated/prisma/client";
import { validateShape, type Shape } from "@/agents/shape";
import { getSetting, setSetting } from "@/lib/settings";
import { MappingError, RowError, rowToDraft, scrub, suggestMapping, toNumber, validateMapping, type Draft, type Mapping } from "./mapping";
import { SOURCE_PRESETS, ingestDrafts, recordJob, type DraftEx, type PresetId } from "./ingest";
import { parseTable, TableError } from "./table";

export { MappingError, TableError };

export const mappingKey = (source: string) => `import.mapping.${source}`;

export async function savedMapping(db: PrismaClient, source: string): Promise<Mapping | null> {
  const s = await getSetting(db, mappingKey(source));
  return ((s?.value as { mapping?: Mapping } | undefined)?.mapping ?? null) as Mapping | null;
}

export interface Preview {
  headers: string[];
  sample: string[][];
  total: number;
  suggested: Mapping;
  saved: Mapping | null;
}

export async function previewFile(db: PrismaClient, source: PresetId, fileName: string, bytes: Uint8Array): Promise<Preview> {
  const t = parseTable(fileName, bytes);
  const saved = await savedMapping(db, source);
  const usable = saved ? Object.fromEntries(Object.entries(saved).filter(([, h]) => h && t.headers.includes(h))) : null;
  return { headers: t.headers, sample: t.rows.slice(0, 10), total: t.rows.length, suggested: suggestMapping(t.headers), saved: usable && Object.keys(usable).length ? (usable as Mapping) : null };
}

export interface ImportReport {
  jobId: string;
  status: string;
  rows: number;
  ok: number;
  failed: number;
  candidatesCreated: number;
  observationsCreated: number;
  duplicates: number;
  errors: { row: number; reason: string }[];
}

export async function importFile(
  db: PrismaClient,
  opts: { source: PresetId; fileName: string; bytes: Uint8Array; mapping: Mapping; saveMapping: boolean; actor: string },
): Promise<ImportReport> {
  const preset = SOURCE_PRESETS[opts.source];
  if (!preset) throw new MappingError("مصدر مجهول");
  const t = parseTable(opts.fileName, opts.bytes);
  const mapping = validateMapping(opts.mapping, t.headers);

  const drafts: Draft[] = [];
  const errors: { row: number; reason: string }[] = [];
  t.rows.forEach((r, i) => {
    try {
      drafts.push(rowToDraft(t.headers, r, mapping));
    } catch (e) {
      if (e instanceof RowError) errors.push({ row: i + 2, reason: e.message }); // +2: العنوان وبداية العدّ من 1
      else throw e;
    }
  });

  const ing = await ingestDrafts(db, drafts, { source: opts.source, access: preset.access, lane: preset.lane, capturedBy: opts.actor, fileKey: `file:${opts.fileName}` });
  if (opts.saveMapping) await setSetting(db, mappingKey(opts.source), { label: `ربط أعمدة مصدر ${preset.label}`, mapping }, opts.actor);
  const job = await recordJob(db, { source: opts.source, fileKey: `file:${opts.fileName}`, mapping, rows: t.rows.length, ok: drafts.length, failed: errors.length, errors });
  return { jobId: job.id, status: job.status, rows: t.rows.length, ok: drafts.length, failed: errors.length, ...ing, errors: errors.slice(0, 50) };
}

// ───── نتيجة Kimi (JSON من برومبت K1 أو K2): نفس شكل مخرج A02 ─────
const KIMI_ITEM: Shape = {
  name_zh: "string",
  name_ar: "string",
  problem: "string",
  trend_age_days: "number|null",
  creators_total: "number|null",
  new_creators_7d: "number|null",
  new_creators_prev_7d: "number|null",
  intent_comments: "number|null",
  skeptic_comments: "number|null",
  comment_sample: "number|null",
  yellow_cart_share: "number|null",
  cumulative_sales: "number|null",
  engagement_rate: "number|null",
  source_note: "string",
};

export async function importKimiJson(db: PrismaClient, text: string, actor: string): Promise<ImportReport> {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new TableError("النص مش JSON صالح");
  }
  const items = Array.isArray(json) ? json : (json as { items?: unknown })?.items;
  if (!Array.isArray(items) || items.length === 0) throw new TableError("ما لقيت items بالنتيجة");
  const preset = SOURCE_PRESETS.kimi;
  const drafts: DraftEx[] = [];
  const errors: { row: number; reason: string }[] = [];
  items.forEach((it, i) => {
    const errs = validateShape(KIMI_ITEM, it);
    if (errs.length) return void errors.push({ row: i + 1, reason: errs[0] });
    const x = it as Record<string, string | number | null>;
    const num = (k: string) => (typeof x[k] === "number" ? Math.round(x[k] as number) : null);
    const ratio = (k: string) => (typeof x[k] === "number" ? (x[k] as number) : null);
    drafts.push({
      title: scrub(String(x.name_zh)), titleAr: scrub(String(x.name_ar)), url: null, market: null, capturedAt: null, price: null, currency: null, sales: null, reviews: null, rating: null,
      listingAgeDays: null, trendAgeDays: num("trend_age_days"), adStartDate: null, adVersions: null, advertisersInMarket: null, creators: num("creators_total"),
      newCreators7d: num("new_creators_7d"), newCreatorsPrev7d: num("new_creators_prev_7d"), intentComments: num("intent_comments"), skepticComments: num("skeptic_comments"),
      commentSample: num("comment_sample"), engagementRate: ratio("engagement_rate"), yellowCartShare: ratio("yellow_cart_share"), cumulativeSales: num("cumulative_sales"),
      imageUrl: null, problem: scrub(String(x.problem)), sourceNote: scrub(String(x.source_note)),
    });
  });
  const ing = await ingestDrafts(db, drafts, { source: "kimi", access: preset.access, lane: preset.lane, capturedBy: actor, fileKey: "paste:kimi" });
  const job = await recordJob(db, { source: "kimi", fileKey: "paste:kimi", mapping: null, rows: items.length, ok: drafts.length, failed: errors.length, errors });
  return { jobId: job.id, status: job.status, rows: items.length, ok: drafts.length, failed: errors.length, ...ing, errors };
}

// ───── مخطط الكلمات: كلمات مقترحة بحجم البحث الشهري، بانتظار اعتمادك ─────
const KW_HEADERS = ["keyword", "الكلمة", "search term", "关键词"];
const VOL_HEADERS = ["avg. monthly searches", "avg monthly searches", "monthly searches", "volume", "حجم البحث", "平均月搜索量"];

export function langOf(text: string): "ar" | "zh" | "en" {
  return /[؀-ۿ]/.test(text) ? "ar" : /[一-鿿]/.test(text) ? "zh" : "en";
}

export async function importKeywords(db: PrismaClient, fileName: string, bytes: Uint8Array, actor: string): Promise<ImportReport> {
  const t = parseTable(fileName, bytes);
  const norm = (s: string) => s.trim().toLowerCase();
  const kwCol = t.headers.findIndex((h) => KW_HEADERS.includes(norm(h)));
  if (kwCol < 0) throw new MappingError("ما لقيت عمود الكلمة (Keyword أو الكلمة)");
  const volCol = t.headers.findIndex((h) => VOL_HEADERS.includes(norm(h)));
  let created = 0;
  let dup = 0;
  const errors: { row: number; reason: string }[] = [];
  for (const [i, r] of t.rows.entries()) {
    const text = scrub(r[kwCol] ?? "").trim();
    if (!text) {
      errors.push({ row: i + 2, reason: "كلمة فاضية" });
      continue;
    }
    let vol: number | null = null;
    try {
      vol = volCol >= 0 ? toNumber(r[volCol] ?? "") : null;
    } catch {
      errors.push({ row: i + 2, reason: `حجم بحث غلط: «${r[volCol]}»` });
      continue;
    }
    const lang = langOf(text);
    const found = await db.keyword.findUnique({ where: { text_lang: { text, lang } } });
    if (found) dup += 1;
    else {
      await db.keyword.create({ data: { text, lang, source: `keyword_planner${vol !== null ? `:${Math.round(vol)}` : ""}`, status: "proposed" } });
      created += 1;
    }
  }
  const job = await recordJob(db, { source: "keyword_planner", fileKey: `file:${fileName}`, mapping: { keyword: t.headers[kwCol], volume: volCol >= 0 ? t.headers[volCol] : null }, rows: t.rows.length, ok: created + dup, failed: errors.length, errors });
  void actor;
  return { jobId: job.id, status: job.status, rows: t.rows.length, ok: created + dup, failed: errors.length, candidatesCreated: 0, observationsCreated: 0, duplicates: dup, errors };
}
