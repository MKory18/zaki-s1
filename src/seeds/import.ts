// استيراد البذور (برومبت B04): بيتعاد بأمان بلا تكرار، وما بيكتب فوق تعديلات المالك.
// المصدر: prisma/seeds/seed-data.json (مبني حرفياً من docs/04-seeds.md بـ tools/build_seeds.py).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/generated/prisma/client";

export interface LibraryReport {
  total: number;
  created: number;
  existing: number;
}
export type SeedReport = Record<string, LibraryReport>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SeedData = Record<string, any>;

export function loadSeedData(path = join(process.cwd(), "prisma", "seeds", "seed-data.json")): SeedData {
  return JSON.parse(readFileSync(path, "utf8"));
}

const REVIEWED_AT = new Date("2026-10-01T00:00:00Z"); // تاريخ ملف البذور = «آخر مراجعة» لقواعد الإعلانات
const dash = (s: string | null | undefined) => (!s || s === "—" ? null : s);

export function reviewStatusOf(raw: string): "pending" | "needs_specialist" {
  return raw.includes("يوقف لقرار مختص") ? "needs_specialist" : "pending";
}

export function ingredientStatusOf(raw: string): "banned" | "restricted" {
  return raw.startsWith("محظور") || raw.includes("ممنوع") ? "banned" : "restricted";
}

function rep(): LibraryReport {
  return { total: 0, created: 0, existing: 0 };
}

export async function importSeeds(db: PrismaClient, data: SeedData = loadSeedData()): Promise<SeedReport> {
  const report: SeedReport = {};
  const lib = (name: string) => (report[name] ??= rep());
  const mark = (name: string, created: boolean) => {
    const r = lib(name);
    r.total += 1;
    created ? (r.created += 1) : (r.existing += 1);
  };

  // إعداد بنسخة أولى فقط إذا ما كان موجود (ما نكتب فوق تعديل المالك)
  async function seedSetting(key: string, value: unknown) {
    const exists = await db.setting.findFirst({ where: { key }, select: { id: true } });
    if (!exists) await db.setting.create({ data: { key, valueJson: value as never, version: 1, updatedBy: "seed" } });
    mark("settings", !exists);
  }

  // ── المرجعيات والعلامات ──
  for (const r of data.dnaReferences) {
    const found = await db.dnaReference.findFirst({ where: { name: r.name, deletedAt: null } });
    if (!found) {
      await db.dnaReference.create({
        data: { name: r.name, origin: "manual", productRef: r.name, traitsJson: r.traits, performanceJson: { source: "oms" }, active: true },
      });
    }
    mark("dnaReferences", !found);
  }
  for (const b of data.brands) {
    const found = await db.brandRegistry.findFirst({ where: { name: b.name } });
    if (!found) await db.brandRegistry.create({ data: { name: b.name, notes: b.usage } });
    mark("brands", !found);
  }

  // ── خريطة المشاكل والكلمات ──
  for (const p of data.problems) {
    const found = await db.problem.findFirst({ where: { nameAr: p.nameAr } });
    if (!found) {
      await db.problem.create({ data: { nameAr: p.nameAr, keywordsAr: p.keywordsAr, keywordsEn: p.keywordsEn, keywordsZh: p.keywordsZh } });
    }
    mark("problems", !found);
  }
  for (const k of data.trendKeywords) {
    for (const text of k.words as string[]) {
      const found = await db.keyword.findUnique({ where: { text_lang: { text, lang: k.lang } } });
      if (!found) await db.keyword.create({ data: { text, lang: k.lang, source: "seed:trend", status: "approved" } });
      mark("trendKeywords", !found);
    }
  }

  // ── النصوص والتراث ──
  for (const t of data.referenceTexts) {
    const found = await db.referenceText.findUnique({ where: { code: t.code } });
    if (!found) {
      await db.referenceText.create({
        data: { code: t.code, kind: t.source.includes("القرآن") ? "quran" : "hadith", ingredient: t.ingredient, text: t.text, source: t.source, grading: t.grading, reviewStatus: reviewStatusOf(t.reviewRaw) },
      });
    }
    mark("referenceTexts", !found);
  }
  for (const h of data.heritage) {
    const found = await db.referenceText.findUnique({ where: { code: h.code } });
    if (!found) {
      // التراث مش ادعاء ولا نص ديني: ما بيحتاج مراجع شرعي، فبيدخل معتمد (بلا اسم مراجع)
      await db.referenceText.create({
        data: { code: h.code, kind: "heritage", ingredient: h.ingredient, text: h.angle, source: h.origin, usageRule: h.usage, reviewStatus: "approved" },
      });
    }
    mark("heritage", !found);
  }

  // ── المكونات والمحظورات ──
  for (const i of data.ingredients) {
    const found = await db.ingredient.findFirst({ where: { nameAr: i.nameAr, deletedAt: null } });
    if (!found) {
      const safety = dash(i.safetyNote);
      await db.ingredient.create({
        data: { nameAr: i.nameAr, nameEn: i.nameEn, status: "allowed", note: `الاستخدام: ${i.usage}${safety ? ` — ${safety}` : ""}` },
      });
    }
    mark("ingredients", !found);
  }
  for (const b of data.banned) {
    const found = await db.ingredient.findFirst({ where: { nameAr: b.nameAr, deletedAt: null } });
    if (!found) {
      const why = dash(b.why);
      await db.ingredient.create({
        data: { nameAr: b.nameAr, status: ingredientStatusOf(b.statusRaw), note: `${b.statusRaw}${why ? ` — ${why}` : ""}`, adulterationRisk: dash(b.fraudWhere) },
      });
    }
    mark("banned", !found);
  }

  // ── الادعاءات وقواعد الإعلانات ──
  for (const c of data.claims) {
    const found = await db.claimRule.findFirst({ where: { phrase: c.phrase, deletedAt: null } });
    if (!found) await db.claimRule.create({ data: { phrase: c.phrase, reason: c.reason, alternative: dash(c.alternative), appliesTo: "all" } });
    mark("claims", !found);
  }
  for (const a of data.adRules) {
    const found = await db.adPolicyRule.findFirst({ where: { rule: a.rule } });
    if (!found) {
      await db.adPolicyRule.create({ data: { platform: "all", rule: a.rule, wrongExample: a.wrong, rightExample: a.right, lastReviewedAt: REVIEWED_AT } });
    }
    mark("adRules", !found);
  }

  // ── أسباب الرفض والأسواق والصفحات ──
  for (const r of data.rejectReasons) {
    const found = await db.rejectReason.findUnique({ where: { code: r.code } });
    if (!found) await db.rejectReason.create({ data: { code: r.code, labelAr: r.labelAr } });
    mark("rejectReasons", !found);
  }
  for (const m of data.markets) {
    const found = await db.market.findUnique({ where: { code: m.code } });
    if (!found) await db.market.create({ data: { code: m.code, nameAr: m.nameAr, currency: m.currency, settingsJson: m.values } });
    mark("markets", !found);
  }
  for (const p of data.testPages) {
    const found = await db.testPage.findFirst({ where: { name: p.name, deletedAt: null } });
    if (!found) await db.testPage.create({ data: { name: p.name, platform: p.platform, focus: p.focus, status: "planned" } });
    mark("testPages", !found);
  }

  // ── الإعدادات بمفاتيحها المكتوبة ──
  for (const s of data.settings) await seedSetting(s.key, { label: s.label, raw: s.raw });
  await seedSetting("dna.points", { label: "نقاط الحمض الافتراضية", items: data.dnaPoints });
  await seedSetting("costs.known", { label: "تكاليف المنتجات المعروفة", items: data.knownCosts });
  for (const m of data.markets) await seedSetting(`market.${m.code}`, { label: `افتراضات سوق ${m.nameAr}`, values: m.values });
  await seedSetting("signals.intent_words", { label: "قاموس نية الشراء", items: data.intentWords });
  await seedSetting("signals.skeptic_words", { label: "قاموس التشكيك", items: data.skepticWords });
  await seedSetting("compliance.fraud_categories", { label: "فئات خطر الغش (فحص مستقل إلزامي)", items: data.fraudCategories });
  await seedSetting("agents.budgets", { label: "ميزانيات الوكلاء اليومية (سقوف)", items: data.agentBudgets });
  for (const [name, items] of Object.entries(data.templates)) await seedSetting(`template.${name}`, { label: `قالب: ${name}`, items });
  await seedSetting("launch.checklist", { label: "قائمة حزمة الإطلاق", items: data.launchChecklist });

  return report;
}

export function formatReport(r: SeedReport): string {
  return Object.entries(r)
    .map(([k, v]) => `${k}: ${v.total} (جديد ${v.created} · موجود ${v.existing})`)
    .join("\n");
}
