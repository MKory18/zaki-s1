import { describe, expect, it } from "vitest";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { ImageError, MAX_IMAGE_BYTES, decodeImage, hamming, phash } from "../src/core/phash";
import { DEFAULT_DEDUPE_CONFIG, dedupeConfigFrom, dedupeDecision, normalizeText, titleSimilarity } from "../src/core/dedupe";
import { aggregateSignals, creatorsTotal, minUsdPrice, type ObsLike } from "../src/pipeline/signals";

// صور تجريبية بدون ملفات: PNG وJPEG بتتولّد بالكود
function png(w: number, h: number, f: (x: number, y: number) => number): Uint8Array {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.data.set([f(x, y), f(x, y), f(x, y), 255], (y * w + x) * 4);
  return new Uint8Array(PNG.sync.write(p));
}
// صور بنسيج (مش تدرّج أملس: التدرّج الأملس بلا تردّدات فبصمته مش مستقرة)
const tex = (w: number, f: (u: number, v: number) => number) => (x: number, y: number) => Math.max(0, Math.min(255, Math.round(f(x / w, y / w))));
const imgA = (u: number, v: number) => 128 + 90 * Math.sin(6 * u) * Math.cos(4 * v) + 30 * Math.sin(15 * u * v);
const imgB = (u: number, v: number) => 128 + 100 * Math.cos(11 * u + 2) * Math.sin(9 * v - 1) + 25 * Math.cos(20 * (u - v));
const imgC = (u: number, v: number) => (Math.floor(u * 6) % 2 === Math.floor(v * 6) % 2 ? 230 : 25);

describe("بصمة الصورة (pHash)", () => {
  it("نفس الصورة بمقاس مختلف وبصيغة JPEG = مسافة صغيرة (≤ 8)", () => {
    const a = png(60, 60, tex(60, imgA));
    const big = png(240, 240, tex(240, imgA));
    const j = jpeg.encode({ width: 60, height: 60, data: Buffer.from(decodeImage(a).data) }, 90).data;
    expect(hamming(phash(a), phash(big))).toBeLessThanOrEqual(8);
    expect(hamming(phash(a), phash(new Uint8Array(j)))).toBeLessThanOrEqual(8);
    expect(phash(a)).toMatch(/^[0-9a-f]{16}$/);
    expect(phash(a)).toBe(phash(a)); // ثابتة
  });
  it("صور مختلفة تماماً = مسافة كبيرة (≥ 15)", () => {
    const a = phash(png(60, 60, tex(60, imgA)));
    expect(hamming(a, phash(png(60, 60, tex(60, imgB))))).toBeGreaterThanOrEqual(15);
    expect(hamming(a, phash(png(60, 60, tex(60, imgC))))).toBeGreaterThanOrEqual(15);
  });
  it("المسافة: قيم معروفة وأخطاء", () => {
    expect(hamming("0000000000000000", "ffffffffffffffff")).toBe(64);
    expect(hamming("0000000000000000", "0000000000000001")).toBe(1);
    expect(hamming("00ff00ff00ff00ff", "00ff00ff00ff00ff")).toBe(0);
    expect(() => hamming("xyz", "0000000000000000")).toThrow(ImageError);
  });
  it("صورة تالفة أو صيغة غلط أو كبيرة = خطأ واضح", () => {
    expect(() => phash(new Uint8Array([1, 2, 3]))).toThrow("PNG أو JPEG");
    expect(() => phash(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toThrow("تالفة");
    expect(() => phash(new Uint8Array(MAX_IMAGE_BYTES + 1))).toThrow("5 ميغا");
  });
  it("الشفاف بيعتبر أبيض (لقطة منتج بخلفية مفرّغة)", () => {
    const p = new PNG({ width: 40, height: 40 });
    for (let i = 0; i < 40 * 40; i++) p.data.set([0, 0, 0, 0], i * 4);
    const white = png(40, 40, () => 255);
    expect(hamming(phash(new Uint8Array(PNG.sync.write(p))), phash(white))).toBe(0);
  });
});

describe("تشابه العناوين", () => {
  it("إنجليزي: نفس المنتج بصياغة مختلفة", () => {
    expect(titleSimilarity("Rosemary Hair Growth Oil 60ml", "rosemary hair growth oil 60 ml")).toBeGreaterThanOrEqual(0.8);
    expect(titleSimilarity("Rosemary Hair Growth Oil", "Dead Sea Mud Mask")).toBeLessThan(0.4);
  });
  it("عربي: التشكيل وصيغ الحروف ما بتأثر", () => {
    expect(normalizeText("زَيْتُ إِكْلِيلِ الجَبَلِ")).toBe(normalizeText("زيت اكليل الجبل"));
    expect(titleSimilarity("زيت إكليل الجبل للشعر", "زيت اكليل الجبل للشعر")).toBe(1);
    expect(titleSimilarity("صابون حلبي بزيت الغار", "طين البحر الميت للوجه")).toBeLessThan(0.4);
  });
  it("صيني: بيشتغل ببيغرام", () => {
    expect(titleSimilarity("迷迭香防脱精油", "迷迭香防脱精油60ml")).toBeGreaterThanOrEqual(0.7);
    expect(titleSimilarity("迷迭香防脱精油", "灰指甲修复液")).toBeLessThan(0.2);
  });
  it("فاضي = صفر، ومتطابق = 1", () => {
    expect(titleSimilarity("", "x")).toBe(0);
    expect(titleSimilarity("abc def", "ABC  def!")).toBe(1);
  });
});

describe("قرار الدمج (حدود ملف البذور)", () => {
  const d = (s: Parameters<typeof dedupeDecision>[0]) => dedupeDecision(s).verdict;
  it("بصمة الصورة: صورتين بمسافة 8 = نفس المنتج، 15 = منفصلين، بينهم الرمادي", () => {
    expect([d({ phashDistance: 0, titleSim: 0 }), d({ phashDistance: 8, titleSim: 0 })]).toEqual(["same", "same"]);
    expect([d({ phashDistance: 9, titleSim: 0 }), d({ phashDistance: 14, titleSim: 0 })]).toEqual(["grey", "grey"]);
    expect([d({ phashDistance: 15, titleSim: 0 }), d({ phashDistance: 40, titleSim: 0.3 })]).toEqual(["different", "different"]);
  });
  it("تشابه العنوان: 0.80 فأكتر نفس المنتج، 0.70–0.80 رمادي، أقل منفصل", () => {
    expect([d({ titleSim: 0.8 }), d({ titleSim: 0.95 })]).toEqual(["same", "same"]);
    expect([d({ titleSim: 0.79 }), d({ titleSim: 0.7 })]).toEqual(["grey", "grey"]);
    expect([d({ titleSim: 0.69 }), d({ titleSim: 0 })]).toEqual(["different", "different"]);
  });
  it("تضمين الصورة 0.92 فأكتر = نفس المنتج مباشرة", () => {
    expect(d({ titleSim: 0.1, imageEmbSim: 0.92 })).toBe("same");
    expect(d({ titleSim: 0.1, phashDistance: 30, imageEmbSim: 0.91 })).toBe("different");
  });
  it("بصمة مجهولة: بيعتمد على العنوان بس", () => {
    expect(d({ phashDistance: null, titleSim: 0.5 })).toBe("different");
    expect(dedupeDecision({ titleSim: 0.75 }).reason).toContain("الرمادية");
  });
  it("الحدود من الإعدادات المبذورة (نص عربي)", () => {
    const raw: Record<string, string> = { "dedupe.phash_max": "8 من 64", "dedupe.title_min": "0.80", "dedupe.image_emb_min": "0.92", "dedupe.grey": "بصمة 9–14 أو عنوان 0.70–0.80" };
    expect(dedupeConfigFrom((k) => raw[k])).toEqual(DEFAULT_DEDUPE_CONFIG);
    const cfg = dedupeConfigFrom((k) => ({ ...raw, "dedupe.phash_max": "5 من 64", "dedupe.grey": "بصمة 6–10 أو عنوان 0.6–0.8" })[k]);
    expect(cfg).toMatchObject({ phashMax: 5, greyPhash: [6, 10], greyTitle: [0.6, 0.8] });
    expect(dedupeDecision({ phashDistance: 7, titleSim: 0 }, cfg).verdict).toBe("grey");
    expect(dedupeConfigFrom(() => undefined)).toEqual(DEFAULT_DEDUPE_CONFIG);
  });
});

const obs = (o: Partial<ObsLike> & { source: string }): ObsLike => ({
  accessMethod: "api", url: null, capturedAt: new Date("2026-10-01"), price: null, currency: null, creators: null, newCreators7d: null, newCreatorsPrev7d: null, intentComments: null,
  skepticComments: null, commentSample: null, engagementRate: null, yellowCartShare: null, advertisersInMarket: null, cumulativeSales: null, signalsJson: null, ...o,
});

describe("تجميع إشارات المرشح من ملاحظاته", () => {
  const list: ObsLike[] = [
    obs({ source: "douyin", capturedAt: new Date("2026-10-01"), creators: 140, newCreators7d: 40, newCreatorsPrev7d: 20, intentComments: 8, commentSample: { size: 80 }, engagementRate: 0.04, yellowCartShare: 0.2, cumulativeSales: 20000, signalsJson: { trendAgeDays: 10 } }),
    obs({ source: "douyin", capturedAt: new Date("2026-10-05"), newCreators7d: 60, newCreatorsPrev7d: 25, intentComments: 5, commentSample: { size: 40 }, engagementRate: 0.08, yellowCartShare: 0.35, cumulativeSales: 30000, signalsJson: { trendAgeDays: 14 } }),
    obs({ source: "aliexpress", url: "https://ali.example/1", price: { toString: () => "3.49" }, currency: "USD", engagementRate: 0.06 }),
    obs({ source: "aliexpress", url: "https://ali.example/2", price: { toString: () => "2.80" }, currency: "USD" }),
    obs({ source: "aliexpress", url: "HTTPS://ALI.EXAMPLE/2", price: { toString: () => "9.99" }, currency: "JOD" }),
    obs({ source: "meta_eu", url: "https://facebook.com/ads/1", advertisersInMarket: 2, capturedAt: new Date("2026-10-06") }),
  ];
  it("الأحدث للإشارات اللحظية، والتجميع للتعليقات، والوسيط للتفاعل", () => {
    const s = aggregateSignals(list);
    expect(s).toMatchObject({
      trendAgeDays: 14, // الأقدم عمراً (الأعلى)
      newCreators7d: 60, newCreatorsPrev7d: 25, // من أحدث ملاحظة فيها قيمة
      intentComments: 13, commentSample: 120, // مجموع الملاحظات اللي فيها عيّنة
      engagementRate: 0.06, // وسيط (0.04 · 0.08 · 0.06)
      yellowCartShare: 0.35, advertisersInMarket: 2, cumulativeSales: 30000,
      sellersCount: 2, // رابطين مختلفين من الأسواق (المكرر بحروف كبيرة بينعدّ مرة)
    });
  });
  it("الناقص null مش صفر", () => {
    expect(aggregateSignals([obs({ source: "manual" })])).toMatchObject({ trendAgeDays: null, intentComments: null, commentSample: null, engagementRate: null, sellersCount: null, yellowCartShare: null, advertisersInMarket: null, cumulativeSales: null });
    expect(aggregateSignals([])).toMatchObject({ sellersCount: null });
  });
  it("عدد الصنّاع وأقل سعر بالدولار (تقدير)", () => {
    expect(creatorsTotal(list)).toBe(140);
    expect(creatorsTotal([obs({ source: "x" })])).toBeNull();
    expect(minUsdPrice(list)).toBe(2.8); // بالدولار بس
    expect(minUsdPrice([obs({ source: "x" })])).toBeNull();
  });
});
