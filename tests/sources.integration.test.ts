// قاعدة حقيقية: سحب علي إكسبرس (وهمي) بيعبّي ملاحظات، ملف نموذجي بيدخل بربط الأعمدة، ومصدر فاشل بيبيّن فشل مش صفر.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { strToU8 } from "fflate";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { importFile, importKeywords, importKimiJson, previewFile, savedMapping } from "../src/sources/importer";
import { pullAliexpress } from "../src/sources/aliexpress";
import { pullMetaEu } from "../src/sources/metaadlib";
import { runSource, searchKeywords, sourceStatuses } from "../src/sources/run";
import { resetLimitsForTests } from "../src/adapters/limiter";
import { listAlerts, resetAlertsForTests } from "../src/lib/alerts";

const has = Boolean(process.env.DATABASE_URL);
const fast = { sleep: async () => undefined };
const uniq = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ملف نموذجي من منصة بيانات مرخّصة (عناوين صينية): 4 صفوف، منها صف بيانات غلط وصف فيه إيميل بالعنوان
function douyinCsv(tag: string) {
  return [
    "商品名称,链接,累计销量,带货达人数,近7天新增达人,前7天新增达人,求购评论数,评论样本数,挂车率,互动率,爆款天数,类目",
    `迷迭香防脱精油 ${tag},https://www.douyin.com/product/${tag}-1,30000,140,60,25,13,120,35%,6%,12,تساقط الشعر`,
    `灰指甲修复液 ${tag},https://www.douyin.com/product/${tag}-2,1.2万,90,30,30,5,100,20%,4%,20,`,
    `坏数据 ${tag},https://www.douyin.com/product/${tag}-3,ليس رقم,10,1,1,1,60,10%,2%,5,`,
    `联系 seller@example.com ${tag},https://www.douyin.com/product/${tag}-4,500,20,5,5,2,80,10%,3%,9,`,
  ].join("\n");
}

describe.skipIf(!has)("المصادر والاستيراد على قاعدة حقيقية", () => {
  const db = () => getDb();
  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().$disconnect();
  });
  beforeEach(() => {
    resetLimitsForTests();
    resetAlertsForTests();
  });

  it("علي إكسبرس: سحب «rosemary oil» (وهمي) بيعبّي ملاحظات بالرابط والتاريخ ونوع الوصول والثقة", async () => {
    const r = await pullAliexpress(db(), ["rosemary oil"], { mode: "mock", ...fast });
    expect(r).toMatchObject({ status: "done", keywords: 1, ok: 1, failed: 0 });
    expect(r.observationsCreated + r.duplicates).toBe(3);
    const obs = await db().observation.findFirstOrThrow({ where: { source: "aliexpress", url: "https://www.aliexpress.com/item/1005001.html" }, include: { candidate: true } });
    expect(obs).toMatchObject({ accessMethod: "api", trust: "high", currency: "USD", sales: 12000 });
    expect(obs.price?.toString()).toBe("3.49");
    expect(obs.rating).toBeCloseTo(4.73, 2);
    expect(obs.candidate.titleSrc).toBe("Rosemary Hair Growth Oil 60ml");
    expect((obs.extractedJson as { trustValue: number }).trustValue).toBe(0.9);
    expect(obs.capturedAt.toISOString().slice(0, 10)).toBe(new Date().toISOString().slice(0, 10)); // تاريخ اللقطة (اليوم)
    expect(obs.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    // إعادة السحب بنفس اليوم ما بتكرر
    const again = await pullAliexpress(db(), ["rosemary oil"], { mode: "mock", ...fast });
    expect(again.observationsCreated).toBe(0);
    expect(again.duplicates).toBe(3);
    const job = await db().importJob.findFirstOrThrow({ where: { source: "aliexpress" }, orderBy: { createdAt: "desc" } });
    expect(job).toMatchObject({ rows: 1, ok: 1, failed: 0, status: "done" });
  });

  it("مصدر فاشل بيبيّن فشل (مش صفر صامت): الحالة فاشل + تنبيه + سبب بلا رابط التوقيع", async () => {
    const down = (async () => new Response("down", { status: 503 })) as typeof fetch;
    const r = await pullAliexpress(db(), ["a " + uniq(), "b " + uniq()], { mode: "mock", fetchImpl: down, ...fast });
    expect(r).toMatchObject({ status: "failed", ok: 0, failed: 2, observationsCreated: 0 });
    expect(r.errors[0].reason).toContain("HTTP 503");
    expect(JSON.stringify(r.errors)).not.toContain("sign=");
    expect(listAlerts(5).some((a) => a.type === "source_failed")).toBe(true);
    const st = (await sourceStatuses(db())).find((s) => s.id === "aliexpress")!;
    expect(st.lastRun?.status).toBe("failed");
    expect(st.failedRuns).toBeGreaterThan(0);
  });

  it("فشل جزئي: الباقي بيمشي والفاشل بيتسجّل", async () => {
    let n = 0;
    const flaky = (async (input: RequestInfo | URL) => {
      n += 1;
      if (n === 2) return new Response("x", { status: 500 });
      return (await import("../src/sources/aliexpress")).createAliMockFetch()(input);
    }) as typeof fetch;
    const r = await pullAliexpress(db(), ["rosemary oil", "bad " + uniq(), "ok " + uniq()], { mode: "mock", fetchImpl: flaky, ...fast });
    expect(r).toMatchObject({ status: "partial", ok: 2, failed: 1 });
  });

  it("الوضع الحقيقي بلا مفاتيح: وقف بلا اتصال + تنبيه (مش نجاح كاذب)", async () => {
    const r = await pullAliexpress(db(), ["rosemary oil"], { mode: "real", env: {}, ...fast });
    expect(r).toMatchObject({ status: "failed", ok: 0 });
    expect(r.errors[0].reason).toContain("ALIEXPRESS_APP_KEY");
    expect(listAlerts(5).some((a) => a.type === "source_failed")).toBe(true);
  });

  it("الوضع الحقيقي بمفاتيح: الطلب موقّع وبلا السر بالرابط", async () => {
    let seen = "";
    const f = (async (input: RequestInfo | URL) => ((seen = String(input)), Response.json({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [] } } } } }))) as typeof fetch;
    const r = await pullAliexpress(db(), ["x " + uniq()], { mode: "real", env: { ALIEXPRESS_APP_KEY: "k1", ALIEXPRESS_APP_SECRET: "super-secret-value", ALIEXPRESS_TRACKING_ID: "t1" }, fetchImpl: f, ...fast }); // scan:ok
    expect(r.status).toBe("done");
    expect(seen).toContain("sign=");
    expect(seen).toContain("app_key=k1");
    expect(seen).not.toContain("super-secret-value");
  });

  it("مكتبة إعلانات ميتا (أوروبا): ملاحظة بعدد النسخ وأقدم إعلان، والتوكن بالترويسة بس", async () => {
    let headers: Headers | null = null;
    let url = "";
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return Response.json({ data: [{ page_name: "Shop A", ad_delivery_start_time: "2026-08-20T00:00:00+0000" }, { page_name: "Shop B", ad_delivery_start_time: "2026-09-10T00:00:00+0000" }] });
    }) as typeof fetch;
    const kw = "meta kw " + uniq();
    const r = await pullMetaEu(db(), [kw], { mode: "real", env: { META_ADLIB_TOKEN: "tok-live-secret" }, fetchImpl: f, ...fast }); // scan:ok
    expect(r).toMatchObject({ status: "done", observationsCreated: 1 });
    expect((headers as Headers | null)?.get("authorization")).toBe("Bearer tok-live-secret");
    expect(url).not.toContain("tok-live-secret");
    const obs = await db().observation.findFirstOrThrow({ where: { source: "meta_eu", candidate: { titleSrc: kw } }, include: { candidate: true } });
    expect(obs).toMatchObject({ accessMethod: "api", adVersions: 2 });
    expect(obs.adStartDate?.toISOString().slice(0, 10)).toBe("2026-08-20");
    expect(obs.candidate.lane).toBe("regional_proven");
    // بلا توكن: وقف
    const none = await pullMetaEu(db(), ["x"], { mode: "real", env: {}, fetchImpl: f, ...fast });
    expect(none.status).toBe("failed");
    // رد خطأ من الواجهة بيطلع بلا التوكن
    const err = (async () => Response.json({ error: { message: "Invalid access_token=SECRET123 here" } })) as typeof fetch;
    const e = await pullMetaEu(db(), ["y"], { mode: "real", env: { META_ADLIB_TOKEN: "t" }, fetchImpl: err, ...fast });
    expect(JSON.stringify(e.errors)).not.toContain("SECRET123");
  });

  describe("استيراد ملف منصة دويين", () => {
    const tag = "t" + uniq();
    const csv = strToU8(douyinCsv(tag));

    it("المعاينة بتقترح الربط من العناوين الصينية", async () => {
      const p = await previewFile(db(), "douyin", "d.csv", csv);
      expect(p.total).toBe(4);
      expect(p.suggested).toMatchObject({ title: "商品名称", url: "链接", cumulativeSales: "累计销量", creators: "带货达人数", newCreators7d: "近7天新增达人", intentComments: "求购评论数", yellowCartShare: "挂车率", trendAgeDays: "爆款天数", problem: "类目" });
    });

    it("بيدخل بربط الأعمدة: مرشحين وملاحظات بإشارات صحيحة، والصف الغلط بيتسجّل بسببه", async () => {
      const mapping = (await previewFile(db(), "douyin", "d.csv", csv)).suggested;
      const r = await importFile(db(), { source: "douyin", fileName: "d.csv", bytes: csv, mapping, saveMapping: true, actor: "owner-1" });
      expect(r).toMatchObject({ rows: 4, ok: 3, failed: 1, candidatesCreated: 3, observationsCreated: 3, status: "partial" });
      expect(r.errors[0]).toMatchObject({ row: 4 });
      expect(r.errors[0].reason).toContain("رقمية");

      const obs = await db().observation.findFirstOrThrow({ where: { url: `https://www.douyin.com/product/${tag}-1` }, include: { candidate: { include: { problem: true } } } });
      expect(obs).toMatchObject({ accessMethod: "licensed", trust: "high", creators: 140, newCreators7d: 60, newCreatorsPrev7d: 25, intentComments: 13, cumulativeSales: 30000, engagementRate: 0.06, yellowCartShare: 0.35 });
      expect(obs.commentSample).toEqual({ size: 120 }); // العدّ بس
      expect((obs.signalsJson as { trendAgeDays: number }).trendAgeDays).toBe(12);
      expect(obs.candidate.lane).toBe("china_early");
      expect(obs.candidate.problem?.nameAr).toBe("تساقط الشعر"); // ربطها بخريطة المشاكل
      const second = await db().observation.findFirstOrThrow({ where: { url: `https://www.douyin.com/product/${tag}-2` } });
      expect(second.cumulativeSales).toBe(12000); // 1.2万
      // ولا بيانات شخصية: الإيميل انشال من العنوان
      const scrubbed = await db().candidate.findFirstOrThrow({ where: { titleSrc: { contains: `[محذوف] ${tag}` } } });
      expect(scrubbed.titleSrc).not.toContain("@");
    });

    it("الربط انحفظ للمصدر، وإعادة الاستيراد ما بتكرر", async () => {
      const saved = await savedMapping(db(), "douyin");
      expect(saved).toMatchObject({ title: "商品名称", creators: "带货达人数" });
      expect((await previewFile(db(), "douyin", "d.csv", csv)).saved).toMatchObject({ title: "商品名称" });
      const mapping = saved!;
      const r = await importFile(db(), { source: "douyin", fileName: "d.csv", bytes: csv, mapping, saveMapping: false, actor: "owner-1" });
      expect(r).toMatchObject({ ok: 3, observationsCreated: 0, duplicates: 3, candidatesCreated: 0 });
    });

    it("نفس المنتج من مصدرين = مرشح واحد وعدد المصادر 2", async () => {
      const title = "منتج مشترك " + uniq();
      const a = strToU8(`title,link\n${title},https://a.example/${encodeURIComponent(title)}`);
      const b = strToU8(`title,link\n${title},https://b.example/${encodeURIComponent(title)}`);
      const m = { title: "title", url: "link" };
      await importFile(db(), { source: "douyin", fileName: "a.csv", bytes: a, mapping: m, saveMapping: false, actor: "o" });
      await importFile(db(), { source: "ads_tool", fileName: "b.csv", bytes: b, mapping: m, saveMapping: false, actor: "o" });
      const cands = await db().candidate.findMany({ where: { titleSrc: title } });
      expect(cands).toHaveLength(1);
      expect(cands[0].sourcesCount).toBe(2);
      expect(await db().observation.count({ where: { candidateId: cands[0].id } })).toBe(2);
    });

    it("ملف كله غلط = «فشل» مع تنبيه، وملف ربطه ناقص مرفوض", async () => {
      const bad = strToU8("title,price\nx,abc\ny,def");
      const r = await importFile(db(), { source: "generic", fileName: "bad.csv", bytes: bad, mapping: { title: "title", price: "price" }, saveMapping: false, actor: "o" });
      expect(r).toMatchObject({ status: "failed", ok: 0, failed: 2 });
      expect(listAlerts(5).some((a) => a.type === "source_failed")).toBe(true);
      await expect(importFile(db(), { source: "generic", fileName: "bad.csv", bytes: bad, mapping: { price: "price" }, saveMapping: false, actor: "o" })).rejects.toThrow("العنوان أو الرابط");
    });
  });

  it("نتيجة Kimi (JSON من K1): بتدخل بإشاراتها وثقتها 0.6، وغير الصالح بيتسجّل", async () => {
    const tag = uniq();
    const item = { name_zh: `迷迭香精油${tag}`, name_ar: `زيت إكليل الجبل ${tag}`, problem: "تساقط الشعر", trend_age_days: 12, creators_total: 140, new_creators_7d: 60, new_creators_prev_7d: 25, intent_comments: 13, skeptic_comments: 4, comment_sample: 120, yellow_cart_share: 0.35, cumulative_sales: 30000, engagement_rate: 0.06, source_note: "تصدير" };
    const r = await importKimiJson(db(), "```json\n" + JSON.stringify({ items: [item, { name_zh: "ناقص" }] }) + "\n```", "owner-1");
    expect(r).toMatchObject({ rows: 2, ok: 1, failed: 1, candidatesCreated: 1, status: "partial" });
    const c = await db().candidate.findFirstOrThrow({ where: { titleSrc: item.name_zh }, include: { observations: true } });
    expect(c.titleAr).toBe(item.name_ar);
    expect(c.lane).toBe("china_early");
    expect(c.observations[0]).toMatchObject({ accessMethod: "kimi", trust: "medium", skepticComments: 4 });
    await expect(importKimiJson(db(), "مش json", "o")).rejects.toThrow("JSON");
    await expect(importKimiJson(db(), "{\"items\":[]}", "o")).rejects.toThrow("items");
  });

  it("مخطط الكلمات: كلمات مقترحة بحجم البحث، بانتظار اعتمادك (وما بتتكرر)", async () => {
    const w = "كلمة " + uniq();
    const en = "hair oil " + uniq();
    const csv = strToU8(`Keyword,Avg. monthly searches\n${w},"1,200"\n${en},880\n,5\n${w},1`);
    const r = await importKeywords(db(), "kp.csv", csv, "owner-1");
    expect(r).toMatchObject({ rows: 4, ok: 3, failed: 1 }); // الفاضية فشلت، المكررة بالملف انحسبت موجودة
    const k = await db().keyword.findUniqueOrThrow({ where: { text_lang: { text: w, lang: "ar" } } });
    expect(k).toMatchObject({ status: "proposed", source: "keyword_planner:1200" });
    expect((await db().keyword.findUniqueOrThrow({ where: { text_lang: { text: en, lang: "en" } } })).source).toBe("keyword_planner:880");
    await expect(importKeywords(db(), "x.csv", strToU8("a,b\n1,2"), "o")).rejects.toThrow("عمود الكلمة");
  });

  it("الكلمات المعتمدة بتدخل بكلمات السحب", async () => {
    const w = "approved kw " + uniq();
    await db().keyword.create({ data: { text: w, lang: "en", source: "test", status: "approved" } });
    expect(await searchKeywords(db(), "en")).toContain(w);
    expect((await searchKeywords(db(), "en")).length).toBeGreaterThan(40); // خريطة المشاكل: كلمات الإنجليزي لـ 22 مشكلة
    expect(await searchKeywords(db(), "ar")).toContain("تساقط الشعر");
  });

  it("تشغيل المصدر من الكلمات مباشرة (الوهمي)", async () => {
    const r = await runSource(db(), "meta_eu", { keyword: "rosemary oil", deps: { mode: "mock", ...fast } });
    expect(r).toMatchObject({ keywords: 1, ok: 1, failed: 0 });
  });
});
