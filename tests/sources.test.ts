import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { MAX_ROWS, parseCsv, parseTable, parseXlsx, TableError } from "../src/sources/table";
import { MappingError, RowError, rowToDraft, scrub, suggestMapping, toDate, toNumber, toRatio, validateMapping } from "../src/sources/mapping";
import { ALI_METHODS, buildQuery, createAliMockFetch, parseProducts, productToDraft, signParams, SourceCallError } from "../src/sources/aliexpress";
import { adsToDraft, buildMetaUrl, EU_COUNTRIES } from "../src/sources/metaadlib";
import { pickKeywords } from "../src/sources/run";
import { DEFAULT_TRUST, trustLevel, trustOf } from "../src/sources/trust";
import { langOf } from "../src/sources/importer";
import { dedupeHashOf } from "../src/sources/ingest";

describe("قراءة CSV", () => {
  it("اقتباس، فواصل وأسطر داخل الاقتباس، BOM، وسطور فاضية", () => {
    const rows = parseCsv('﻿اسم,سعر\r\n"زيت, اكليل",3.5\r\n\r\n"سطر\nتاني",4\r\n"قال ""مرحبا""",5\r\n');
    expect(rows).toEqual([["اسم", "سعر"], ["زيت, اكليل", "3.5"], ["سطر\nتاني", "4"], ['قال "مرحبا"', "5"]]);
  });
  it("بيخمّن الفاصل: ; و tab", () => {
    expect(parseCsv("a;b;c\n1;2;3")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
    expect(parseCsv("a\tb\n1\t2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("parseTable: عناوين وصفوف، ويرفض الصيغة والحجم والفاضي", () => {
    const t = parseTable("x.csv", strToU8("اسم,سعر\nأ,1\nب,2"));
    expect(t.headers).toEqual(["اسم", "سعر"]);
    expect(t.rows).toEqual([["أ", "1"], ["ب", "2"]]);
    expect(() => parseTable("x.pdf", strToU8("a,b\n1,2"))).toThrow("CSV أو Excel");
    expect(() => parseTable("x.csv", strToU8("a,b"))).toThrow("صف بيانات");
    expect(() => parseTable("x.csv", new Uint8Array(5 * 1024 * 1024 + 1))).toThrow("أكبر");
    const many = "a,b\n" + Array.from({ length: MAX_ROWS + 5 }, (_, i) => `${i},x`).join("\n");
    expect(() => parseCsv(many)).toThrow(TableError);
  });
  it("الصفوف الأقصر بتنكمّل، والعناوين بتنقصّ", () => {
    const t = parseTable("x.csv", strToU8(" a , b ,c\n1,2"));
    expect(t.headers).toEqual(["a", "b", "c"]);
    expect(t.rows).toEqual([["1", "2", ""]]);
  });
});

function xlsx(rows: (string | number)[][], opts: { inline?: boolean } = {}): Uint8Array {
  const shared: string[] = [];
  const cell = (v: string | number, r: number, c: number) => {
    const ref = `${String.fromCharCode(65 + c)}${r + 1}`;
    if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
    if (opts.inline) return `<c r="${ref}" t="inlineStr"><is><t>${v}</t></is></c>`;
    shared.push(v);
    return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
  };
  const sheet = `<?xml version="1.0"?><worksheet><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((v, c) => cell(v, r, c)).join("")}</row>`).join("")}</sheetData></worksheet>`;
  const ss = `<?xml version="1.0"?><sst>${shared.map((s) => `<si><t>${s.replace(/&/g, "&amp;")}</t></si>`).join("")}</sst>`;
  return zipSync({ "xl/worksheets/sheet1.xml": strToU8(sheet), "xl/sharedStrings.xml": strToU8(ss), "[Content_Types].xml": strToU8("<x/>") });
}

describe("قراءة Excel (xlsx)", () => {
  it("جمل مشتركة وأرقام، والخلايا الفاضية بالنص", () => {
    const rows = parseXlsx(xlsx([["اسم", "سعر", "ملاحظة"], ["زيت & أعشاب", 3.49, "ممتاز"], ["صابون", 2, "—"]]));
    expect(rows).toEqual([["اسم", "سعر", "ملاحظة"], ["زيت & أعشاب", "3.49", "ممتاز"], ["صابون", "2", "—"]]);
  });
  it("نصوص مباشرة (inlineStr)", () => {
    expect(parseXlsx(xlsx([["a", "b"], ["x", "y"]], { inline: true }))).toEqual([["a", "b"], ["x", "y"]]);
  });
  it("parseTable بيقبل xlsx", () => {
    const t = parseTable("بيانات.xlsx", xlsx([["الكلمة", "حجم البحث"], ["زيت للشعر", 1200]]));
    expect(t.headers).toEqual(["الكلمة", "حجم البحث"]);
    expect(t.rows).toEqual([["زيت للشعر", "1200"]]);
  });
  it("ملف مش Excel أو ملف مضغوط تالف = خطأ واضح", () => {
    expect(() => parseTable("x.xlsx", strToU8("هاد مش zip"))).toThrow("Excel");
    expect(() => parseTable("x.xlsx", zipSync({ "hello.txt": strToU8("x") }))).toThrow("ورقة");
  });
  it("قنبلة ضغط: حجم بعد فك الضغط كبير = رفض", () => {
    const bomb = zipSync({ "xl/worksheets/sheet1.xml": new Uint8Array(45 * 1024 * 1024) });
    expect(bomb.byteLength).toBeLessThan(200_000); // مضغوط صغير
    expect(() => parseXlsx(bomb)).toThrow("كبير");
  });
});

describe("ربط الأعمدة", () => {
  it("بيقترح من العناوين الصينية والعربية والإنجليزية، ولا عمود لهدفين", () => {
    const m = suggestMapping(["商品名称", "链接", "累计销量", "带货达人数", "近7天新增达人", "挂车率", "Price", "الصورة", "غير معروف"]);
    expect(m).toMatchObject({ title: "商品名称", url: "链接", cumulativeSales: "累计销量", creators: "带货达人数", newCreators7d: "近7天新增达人", yellowCartShare: "挂车率", price: "Price", imageUrl: "الصورة" });
    expect(Object.values(m)).toHaveLength(new Set(Object.values(m)).size);
  });
  it("التحقق: عمود مش موجود، هدف مجهول، وبلا عنوان ولا رابط", () => {
    expect(() => validateMapping({ title: "ما في" }, ["a"])).toThrow("مش موجود");
    expect(() => validateMapping({ nonsense: "a" } as never, ["a"])).toThrow("مجهول");
    expect(() => validateMapping({ price: "a" }, ["a"])).toThrow(MappingError);
    expect(validateMapping({ title: "a", price: "" }, ["a"])).toEqual({ title: "a" });
  });
});

describe("تحويل القيم", () => {
  it("أرقام: فواصل، K، 万، أرقام عربية، وفاضي", () => {
    expect([toNumber("1,234"), toNumber("12K"), toNumber("1.2万"), toNumber("٣٤"), toNumber("$3.5"), toNumber("2亿"), toNumber(""), toNumber("—"), toNumber("N/A")]).toEqual([1234, 12000, 12000, 34, 3.5, 200_000_000, null, null, null]);
    expect(() => toNumber("abc")).toThrow(RowError);
  });
  it("نسب: % أو كسر أو مئوية، وخارج المدى خطأ", () => {
    expect([toRatio("6%"), toRatio("0.06"), toRatio("35"), toRatio("")]).toEqual([0.06, 0.06, 0.35, null]);
    expect(() => toRatio("150%")).toThrow(RowError);
  });
  it("تواريخ", () => {
    expect([toDate("2026-10-09"), toDate("2026/1/5"), toDate("2026年10月9日"), toDate("2026-10-09T10:00:00Z"), toDate("")]).toEqual(["2026-10-09", "2026-01-05", "2026-10-09", "2026-10-09", null]);
    expect(() => toDate("2026-13-45")).toThrow(RowError);
    expect(() => toDate("بكرة")).toThrow(RowError);
  });
  it("ولا بيانات شخصية: إيميل ورقم هاتف بينشالوا", () => {
    expect(scrub("زيت - اتصل 0791234567 أو a@b.com")).toBe("زيت - اتصل [محذوف] أو [محذوف]");
    expect(scrub("سعر 25 دولار وعدد 400")).toBe("سعر 25 دولار وعدد 400");
  });
  it("صف كامل ← ملاحظة بقيم صحيحة، والأخطاء بالعربي", () => {
    const headers = ["t", "u", "p", "c", "r", "m", "s"];
    const map = { title: "t", url: "u", price: "p", currency: "c", rating: "r", market: "m", sales: "s" };
    const d = rowToDraft(headers, ["زيت 0791234567", "https://x.com/1", "3.5", "usd", "4.7", "sy", "1.2万"], map);
    expect(d).toMatchObject({ title: "زيت [محذوف]", url: "https://x.com/1", price: "3.50", currency: "USD", rating: 4.7, market: "SY", sales: 12000 });
    expect(() => rowToDraft(headers, ["", "", "", "", "", "", ""], map)).toThrow("بلا عنوان");
    expect(() => rowToDraft(headers, ["x", "ftp://x", "", "", "", "", ""], map)).toThrow("http");
    expect(() => rowToDraft(headers, ["x", "", "", "", "9", "", ""], map)).toThrow("التقييم");
    expect(() => rowToDraft(headers, ["x", "", "", "", "", "SYR", ""], map)).toThrow("حرفين");
    expect(() => rowToDraft(headers, ["x", "", "", "dollar", "", "", ""], map)).toThrow("ثلاثي");
    expect(() => rowToDraft(headers, ["x", "", "abc", "", "", "", ""], map)).toThrow("رقمية");
  });
  it("لغة الكلمة", () => expect(["زيت للشعر", "hair oil", "防脱"].map(langOf)).toEqual(["ar", "en", "zh"]));
});

describe("علي إكسبرس (الواجهة الرسمية)", () => {
  const cfg = { appKey: "key123", appSecret: "secret-xyz", trackingId: "trk" }; // scan:ok

  it("التوقيع: HMAC-SHA256 على المعاملات مرتبة مفتاح+قيمة، حروف كبيرة", () => {
    const params = { method: ALI_METHODS.search, app_key: "key123", timestamp: "1700000000000", sign_method: "sha256", keywords: "rosemary oil", sign: "ignored" };
    const base = "app_key" + "key123" + "keywords" + "rosemary oil" + "method" + ALI_METHODS.search + "sign_method" + "sha256" + "timestamp" + "1700000000000";
    const want = createHmac("sha256", "secret-xyz").update(base).digest("hex").toUpperCase();
    expect(signParams(params, "secret-xyz")).toBe(want);
    expect(signParams(params, "secret-xyz")).toMatch(/^[0-9A-F]{64}$/);
    expect(signParams({ ...params, sign: "x" }, "secret-xyz")).toBe(want); // sign نفسه ما بيدخل
  });

  it("الطلب: المعاملات والتوقيع بالرابط، والسر ما بيظهر", () => {
    const q = buildQuery(ALI_METHODS.search, { keywords: "rosemary oil" }, cfg, 1700000000000);
    expect(q.get("method")).toBe("aliexpress.affiliate.product.query");
    expect(q.get("app_key")).toBe("key123");
    expect(q.get("tracking_id")).toBe("trk");
    expect(q.get("sign")).toMatch(/^[0-9A-F]{64}$/);
    expect(q.toString()).not.toContain("secret-xyz");
  });

  it("قراءة الرد الرسمي، والأخطاء بالعربي", () => {
    const ok = { aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: { products: { product: [{ product_id: 1, product_title: "Rosemary Oil", target_sale_price: "3.49", target_sale_price_currency: "USD", evaluate_rate: "94.5%", lastest_volume: 12000, product_detail_url: "https://www.aliexpress.com/item/1.html", product_main_image_url: "https://ae01.alicdn.com/1.jpg" }] } } } } };
    const products = parseProducts(ok);
    expect(products).toHaveLength(1);
    expect(productToDraft(products[0])).toMatchObject({ title: "Rosemary Oil", price: "3.49", currency: "USD", sales: 12000, rating: 4.73, url: "https://www.aliexpress.com/item/1.html", imageUrl: "https://ae01.alicdn.com/1.jpg" });
    expect(parseProducts({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 200, result: {} } } })).toEqual([]);
    expect(() => parseProducts({ error_response: { code: 29, msg: "Invalid app Key" } })).toThrow("رفضت واجهة علي إكسبرس");
    expect(() => parseProducts({ aliexpress_affiliate_product_query_response: { resp_result: { resp_code: 400, resp_msg: "bad" } } })).toThrow(SourceCallError);
    expect(() => parseProducts("x")).toThrow(SourceCallError);
    expect(productToDraft({})).toBeNull();
  });

  it("الوهمي: «rosemary oil» بيرجّع 3 منتجات بنفس شكل الرد الرسمي", async () => {
    const f = createAliMockFetch();
    const res = await f(`https://api-sg.aliexpress.com/sync?${buildQuery(ALI_METHODS.search, { keywords: "rosemary oil" }, cfg).toString()}`);
    expect(parseProducts(await res.json())).toHaveLength(3);
    const none = await f(`https://api-sg.aliexpress.com/sync?${buildQuery(ALI_METHODS.search, { keywords: "empty results" }, cfg).toString()}`);
    expect(parseProducts(await none.json())).toEqual([]);
  });
});

describe("مكتبة إعلانات ميتا (أوروبا)", () => {
  it("الرابط بالكلمة ودول أوروبا بس، بلا توكن", () => {
    const u = new URL(buildMetaUrl("rosemary oil"));
    expect(u.searchParams.get("search_terms")).toBe("rosemary oil");
    expect(JSON.parse(u.searchParams.get("ad_reached_countries")!)).toEqual(EU_COUNTRIES);
    expect(EU_COUNTRIES).not.toContain("JO");
    expect(EU_COUNTRIES).not.toContain("SY");
    expect(u.search).not.toMatch(/access_token/i);
  });
  it("إشارات الكلمة: عدد النسخ، أقدم إعلان، وعدد الصفحات", () => {
    const d = adsToDraft("rosemary oil", [
      { page_name: "Shop A", ad_delivery_start_time: "2026-09-25T00:00:00+0000", ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=3" },
      { page_name: "Shop B", ad_delivery_start_time: "2026-08-20T00:00:00+0000" },
      { page_name: "Shop A", ad_delivery_start_time: "2026-09-10T00:00:00+0000" },
    ])!;
    expect(d).toMatchObject({ title: "rosemary oil", adVersions: 3, adStartDate: "2026-08-20", advertisersInMarket: null });
    expect(d.sourceNote).toContain("2 صفحة");
    expect(d.url).toContain("facebook.com");
    expect(adsToDraft("x", [])).toBeNull();
  });
});

describe("كلمات البحث والثقة", () => {
  it("بتتدوّر يومياً وبحد أقصى، وبلا تكرار", () => {
    const all = Array.from({ length: 100 }, (_, i) => `k${String(i).padStart(3, "0")}`);
    const d0 = pickKeywords(all, 40, 0);
    const d1 = pickKeywords(all, 40, 1);
    expect(d0).toHaveLength(40);
    expect(d1[0]).not.toBe(d0[0]);
    expect(new Set([...pickKeywords(all, 40, 0), ...pickKeywords(all, 40, 1), ...pickKeywords(all, 40, 2)]).size).toBe(100); // 3 أيام بتغطّي الكل
    expect(pickKeywords(["a", "a", " b "], 40)).toEqual(["a", "b"]);
  });
  it("الثقة من ملف المنطق", () => {
    expect(DEFAULT_TRUST).toEqual({ api: 0.9, licensed: 0.8, import: 0.8, extension: 0.7, kimi: 0.6, manual: 0.5, oms: 1.0 });
    expect([0.9, 0.8, 0.7, 0.6, 0.5].map(trustLevel)).toEqual(["high", "high", "medium", "medium", "low"]);
    expect(trustOf("api", { api: 0.5 })).toBe(0.5);
    expect(trustOf("api", { api: 7 as never })).toBe(0.9); // قيمة غلط = الافتراضي
  });
  it("بصمة منع التكرار ثابتة وبتتأثر بالمصدر والرابط والتاريخ", () => {
    const a = dedupeHashOf("douyin", { url: "https://x/1", title: "t", capturedAt: "2026-10-09" });
    expect(a).toBe(dedupeHashOf("douyin", { url: "HTTPS://X/1", title: "other", capturedAt: "2026-10-09" }));
    expect(a).not.toBe(dedupeHashOf("ads_tool", { url: "https://x/1", title: "t", capturedAt: "2026-10-09" }));
    expect(a).not.toBe(dedupeHashOf("douyin", { url: "https://x/1", title: "t", capturedAt: "2026-10-10" }));
  });
});
