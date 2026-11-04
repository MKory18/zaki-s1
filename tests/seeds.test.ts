import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ingredientStatusOf, loadSeedData, reviewStatusOf } from "../src/seeds/import";

const md = readFileSync("docs/04-seeds.md", "utf8").split(/\r?\n/);

// عدّاد مستقل: كم صف بجدول رقم n تحت أول عنوان بيحتوي النص
function tableRows(heading: string, n = 0): string[][] {
  const start = md.findIndex((l) => /^#{2,4}\s/.test(l) && l.includes(heading));
  if (start < 0) throw new Error("ما لقيت: " + heading);
  let i = start + 1;
  let t = -1;
  while (i < md.length && !/^#{2,4}\s/.test(md[i])) {
    if (md[i].startsWith("|")) {
      t += 1;
      const block: string[] = [];
      while (i < md.length && md[i].startsWith("|")) block.push(md[i++]);
      if (t === n) return block.slice(2).map((r) => r.split("|").slice(1, -1).map((c) => c.trim()));
      continue;
    }
    i += 1;
  }
  throw new Error(`القسم ${heading} ما فيه جدول رقم ${n}`);
}

const data = loadSeedData();

describe("البذور: العدد مطابق لصفوف الجداول بالملف", () => {
  const cases: [string, string, number, number][] = [
    ["problems", "خريطة المشاكل بكلمات البحث", 0, 22],
    ["referenceTexts", "مكتبة النصوص المرجعية", 0, 9],
    ["heritage", "مكتبة التراث", 0, 13],
    ["ingredients", "مكتبة المكونات الطبيعية", 0, 25],
    ["banned", "المواد المحظورة والمقيّدة", 0, 11],
    ["fraudCategories", "فئات خطر الغش", 0, 5],
    ["claims", "قاموس الادعاءات", 0, 16],
    ["adRules", "قواعد صياغة الإعلانات", 0, 10],
    ["rejectReasons", "أسباب الرفض الموحّدة", 0, 12],
    ["brands", "علاماتك القائمة", 0, 6],
    ["knownCosts", "تكاليف المنتجات المعروفة", 0, 6],
    ["dnaPoints", "الحمض — الأوزان والنقاط الافتراضية", 1, 10],
    ["agentBudgets", "ميزانيات الوكلاء اليومية", 0, 19],
    ["testPages", "مصفوفة الصفحات", 0, 3],
  ];
  for (const [key, heading, n, expected] of cases) {
    it(`${key}: ${expected}`, () => {
      expect(tableRows(heading, n).length).toBe(expected);
      expect(data[key].length).toBe(expected);
    });
  }

  it("الإعدادات: كل صف من جداول المفاتيح الثمانية", () => {
    const total =
      tableRows("مؤشر سرعة الترند").length +
      tableRows("قواعد الرفض الصارمة").length +
      tableRows("الحمض — الأوزان والنقاط الافتراضية", 0).length +
      tableRows("الحمض — الأوزان والنقاط الافتراضية", 2).length +
      tableRows("الدمج").length +
      tableRows("القرار والقوائم").length +
      tableRows("درجة الترند والصعود").length +
      tableRows("الجدولة").length;
    expect(total).toBe(63);
    expect(data.settings.length).toBe(total);
  });

  it("القوالب والأسواق والقواميس", () => {
    expect(Object.fromEntries(Object.entries(data.templates).map(([k, v]) => [k, (v as unknown[]).length]))).toEqual({
      supplier_score: 6, sample_criteria: 6, brand_brief: 12, label_text: 11, batch_record: 8, license_record: 7,
    });
    expect(data.markets.map((m: { code: string }) => m.code)).toEqual(["SY", "JO"]);
    expect(Object.keys(data.markets[0].values).length).toBe(13);
    expect(data.intentWords.length).toBe(3);
    expect(data.skepticWords.length).toBe(3);
    expect(data.launchChecklist.length).toBe(9);
  });
});

describe("البذور: القيم حرفياً", () => {
  it("مفاتيح الإعدادات ثابتة بقيمها", () => {
    const by = Object.fromEntries(data.settings.map((s: { key: string; raw: string }) => [s.key, s.raw]));
    expect(by["reject.max_creators"]).toBe("400");
    expect(by["reject.max_trend_age_days"]).toBe("45");
    expect(by["reject.max_cumulative_sales"]).toBe("100000");
    expect(by["velocity.w.intent"]).toBe("20");
    expect(by["velocity.min_comment_sample"]).toBe("50");
    expect(by["dna.w.problem_clarity"]).toBe("0.20");
    expect(by["dna.sim.weights"]).toBe("0.5 · 0.3 · 0.2");
    expect(by["dedupe.phash_max"]).toBe("8 من 64");
    expect(by["decision.deep.min_velocity"]).toBe("65");
    expect(by["trend.graduate.min_score"]).toBe("70 بلقطة 3 أيام");
    expect(by["schedule.tz"]).toBe("Asia/Amman");
    expect(by["schedule.dna_learning"]).toBe("السبت 23:00");
  });

  it("المفاتيح كلها فريدة وبصيغة صحيحة", () => {
    const keys = data.settings.map((s: { key: string }) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const k of keys) expect(k).toMatch(/^[a-z][a-z0-9_]*(\.[A-Za-z0-9_]+)+$/);
  });

  it("نقاط الحمض: قيم ونقاط بنفس العدد", () => {
    const clarity = data.dnaPoints.find((p: { attr: string }) => p.attr === "وضوح المشكلة");
    expect(clarity.options).toEqual([
      { value: "عالي", points: 1.0 }, { value: "متوسط", points: 0.6 }, { value: "ضعيف", points: 0.2 },
    ]);
  });

  it("المرجعيات الثلاثة بصفاتها، والأسواق بقيمها («تعبّيها» تضل زي ما هي)", () => {
    const kumaa = data.dnaReferences[0];
    expect(kumaa.name).toBe("ماء الكمأة");
    expect(kumaa.traits["تكلفة الوحدة"]).toBe("1.56 دينار = 2.20$");
    expect(data.dnaReferences.map((r: { name: string }) => r.name)).toEqual(["ماء الكمأة", "بديل الليزر", "طنين الأذن"]);
    const sy = data.markets[0].values;
    const jo = data.markets[1].values;
    expect(sy["market.default_return"].raw).toBe("25%");
    expect(jo["market.default_return"].raw).toBe("تعبّيها");
    expect(sy["fx.jod_usd"].raw).toBe("1.41");
    expect(sy["market.safety_margin"].raw).toBe("30%");
  });

  it("النصوص: كلها بانتظار المراجع إلا زمزم بيوقف لقرار مختص", () => {
    for (const t of data.referenceTexts) {
      expect(reviewStatusOf(t.reviewRaw)).toBe(t.code === "REF-09" ? "needs_specialist" : "pending");
    }
    expect(data.referenceTexts[8].ingredient).toBe("ماء زمزم");
  });

  it("المحظورات: تصنيف محظور/مقيّد من نص الحالة", () => {
    const by = Object.fromEntries(data.banned.map((b: { nameAr: string; statusRaw: string }) => [b.nameAr, ingredientStatusOf(b.statusRaw)]));
    expect(by["الزئبق ومركباته"]).toBe("banned");
    expect(by["الفورمالدهيد"]).toBe("restricted");
    expect(by["حمض الكوجيك"]).toBe("restricted");
    expect(by["بارافينيلين ديامين (PPD) على الجلد"]).toBe("banned");
    expect(by["المخدّر الموضعي (ليدوكايين · بنزوكايين)"]).toBe("restricted");
  });

  it("قاموس الادعاءات: كل ممنوع إله سبب وبديل", () => {
    for (const c of data.claims) {
      expect(c.phrase.length).toBeGreaterThan(0);
      expect(c.reason.length).toBeGreaterThan(0);
    }
    expect(data.claims.find((c: { phrase: string }) => c.phrase.startsWith("يشفي"))?.alternative).toBe("بيساعد على · بيحسّن مظهر");
  });

  it("ولا بيانات شخصية ولا أسرار بملف البذور", () => {
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{20,}/);
  });
});
