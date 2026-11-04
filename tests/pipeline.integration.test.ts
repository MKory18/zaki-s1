// قاعدة حقيقية: الموحّد · الدمج · الماسح · المحقق (أعلى 30) · الفحص المبدئي (أعلى 15) · البطاقة · القرارات. الوكلاء وهمية بمخرجات ثابتة.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Prisma } from "../src/generated/prisma/client";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { assembleCards, candRef, runCompute, runDedupe, runNormalize, runScanner, runScreen, runVerifier, type AgentFn } from "../src/pipeline/stages";
import { MergeError, mergeCandidates, splitCandidate } from "../src/pipeline/merge";
import { buildCard } from "../src/pipeline/card";
import { DecisionError, decideCandidate } from "../src/pipeline/decisions";
import { ingestDrafts, type DraftEx } from "../src/sources/ingest";
import { listAudit } from "../src/lib/audit";

const has = Boolean(process.env.DATABASE_URL);
const rand = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const PREFIX = "pipe" + rand(5); // بادئة فريدة لكل تشغيل: بنعزل مرشحينا عن اختبارات تانية
const title = (...words: string[]) => `${PREFIX} ${words.join(" ")}`;
const T = () => `${rand(8)} ${rand(8)} ${rand(8)}`;

const draft = (t: string, over: Partial<DraftEx> = {}): DraftEx => ({
  title: t, url: `https://example.com/${encodeURIComponent(t)}`, market: null, capturedAt: "2026-10-01", price: null, currency: null, sales: null, reviews: null, rating: null, listingAgeDays: null,
  trendAgeDays: null, adStartDate: null, adVersions: null, advertisersInMarket: null, creators: null, newCreators7d: null, newCreatorsPrev7d: null, intentComments: null, skepticComments: null,
  commentSample: null, engagementRate: null, yellowCartShare: null, cumulativeSales: null, imageUrl: null, problem: null, ...over,
});

const OWNER = { sub: "owner-1", role: "owner" };

describe.skipIf(!has)("خط التقييم على قاعدة حقيقية", () => {
  const db = () => getDb();
  const mk = async (t: string, over: Partial<DraftEx> = {}, access: "licensed" | "manual" = "licensed") => {
    await ingestDrafts(db(), [draft(t, over)], { source: access === "manual" ? "manual" : "douyin", access, lane: "china_early" });
    return db().candidate.findFirstOrThrow({ where: { titleSrc: t, deletedAt: null } });
  };
  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().candidate.updateMany({ where: { titleSrc: { startsWith: PREFIX } }, data: { deletedAt: new Date() } });
    await db().$disconnect();
  });
  beforeEach(() => void 0);

  describe("الموحّد H01", () => {
    it("عنوان عربي وربط بالمشكلة من الخريطة، وغير الصالح بيصير null، وفشل الوكيل بيخلّيه بعنوانه", async () => {
      const problem = await db().problem.findFirstOrThrow({ where: { nameAr: "تساقط الشعر" } });
      const a = await mk(title("rosemary", T()));
      const b = await mk(title("bad", T()));
      const c = await mk(title("down", T()));
      const agent: AgentFn = async (code, vars, ref) => {
        expect(code).toBe("H01");
        if (ref === candRef(a.id)) return { title_ar: "زيت إكليل الجبل", problem_id: problem.id, form: "زيت", category: "عناية الشعر", keywords_ar: [] };
        if (ref === candRef(b.id)) return { title_ar: "منتج", problem_id: "not-in-map", form: null, category: null, keywords_ar: [] };
        if (ref === candRef(c.id)) return null;
        return null; // مرشحين اختبارات تانية: ما منلمسهم
      };
      const r = await runNormalize(db(), agent, 5000);
      expect(r.processed).toBe(2);
      const [na, nb, nc] = await Promise.all([a, b, c].map((x) => db().candidate.findUniqueOrThrow({ where: { id: x.id } })));
      expect(na).toMatchObject({ titleAr: "زيت إكليل الجبل", problemId: problem.id, category: "عناية الشعر" });
      expect(nb).toMatchObject({ problemId: null, category: "غير مصنّف" }); // المشكلة من الخريطة بس
      expect(nc.category).toBeNull(); // بيضل بعنوانه الأصلي وبينفحص بالجولة الجاية
      expect(nc.titleAr).toBe(nc.titleSrc);
    });
  });

  describe("الدمج", () => {
    it("نفس المنتج بصياغتين (تشابه ≥ 0.80) = مرشح واحد: الملاحظات انتقلت للأقدم والمدموج محذوف ناعم والتدقيق مسجّل", async () => {
      const base = T();
      const older = await mk(`${base} oil 60ml`);
      await new Promise((r) => setTimeout(r, 15));
      const newer = await mk(`${base} oil 60 ml`);
      const r = await runDedupe(db(), async () => null);
      expect(r.details.merged).toBeGreaterThanOrEqual(1);
      const after = await db().candidate.findUniqueOrThrow({ where: { id: newer.id } });
      expect(after.deletedAt).not.toBeNull();
      const keep = await db().candidate.findUniqueOrThrow({ where: { id: older.id }, include: { observations: true } });
      expect(keep.observations).toHaveLength(2);
      expect(keep.sourcesCount).toBe(1);
      const e = listAudit(300).find((x) => x.action === "candidate.merge" && x.entityId === older.id);
      expect(e).toBeTruthy();
      expect((e!.before as { fromId: string }).fromId).toBe(newer.id);
    });

    it("المنطقة الرمادية للحَكَم H02: «نفس المنتج» بثقة = دمج، «لأ» أو الحَكَم واقف = منفصلين", async () => {
      const base = T();
      const { titleSimilarity } = await import("../src/core/dedupe");
      // بنبني عنوانين تشابههم بالمنطقة الرمادية 0.70–0.80 (بنغيّر آخر k حرف لحد ما يوقع بالمدى)
      const first = `${base} ${rand(10)}`;
      let second = first;
      for (let k = 1; k < first.length; k++) {
        const cand = first.slice(0, first.length - k) + rand(k);
        const sim0 = titleSimilarity(first, cand);
        if (sim0 >= 0.72 && sim0 <= 0.78) {
          second = cand;
          break;
        }
      }
      expect(second).not.toBe(first);
      const a = await mk(first);
      await new Promise((r) => setTimeout(r, 15));
      const b = await mk(second);
      const sim = titleSimilarity(a.titleSrc, b.titleSrc);
      expect(sim).toBeGreaterThanOrEqual(0.7);
      expect(sim).toBeLessThan(0.8);

      let calls = 0;
      const no: AgentFn = async (code) => (code === "H02" ? (calls++, { same: false, confidence: "high", reason: "حجم مختلف" }) : null);
      const r1 = await runDedupe(db(), no);
      expect(calls).toBeGreaterThanOrEqual(1);
      expect(r1.details.kept_separate).toBeGreaterThanOrEqual(1);
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).toBeNull();

      const down = await runDedupe(db(), async () => null);
      expect(down.details.judge_unavailable).toBeGreaterThanOrEqual(1);
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).toBeNull(); // الرمادي بيضل منفصل

      const low: AgentFn = async () => ({ same: true, confidence: "low", reason: "مش متأكد" });
      await runDedupe(db(), low);
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).toBeNull();

      const yes: AgentFn = async () => ({ same: true, confidence: "high", reason: "نفس المنتج" });
      const r2 = await runDedupe(db(), yes);
      expect(r2.details.merged_by_judge).toBeGreaterThanOrEqual(1);
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).not.toBeNull();
    });

    it("منتجات مختلفة ما بتندمج، ودمج يدوي وفك يدوي", async () => {
      const a = await mk(T());
      const b = await mk(T());
      await runDedupe(db(), async () => null);
      expect((await db().candidate.findUniqueOrThrow({ where: { id: a.id } })).deletedAt).toBeNull();
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).toBeNull();

      await mergeCandidates(db(), b.id, a.id, "owner-1", "دمج يدوي");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: b.id } })).deletedAt).not.toBeNull();
      const merged = await db().candidate.findUniqueOrThrow({ where: { id: a.id }, include: { observations: true } });
      expect(merged.observations).toHaveLength(2);
      // فك: ملاحظة وحدة بتطلع لمرشح جديد
      const moved = merged.observations[0];
      const sp = await splitCandidate(db(), a.id, [moved.id], "owner-1");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: sp.newCandidateId }, include: { observations: true } })).observations).toHaveLength(1);
      expect(await db().observation.count({ where: { candidateId: a.id } })).toBe(1);
      await expect(splitCandidate(db(), a.id, [(await db().observation.findFirstOrThrow({ where: { candidateId: a.id } })).id], "o")).rejects.toBeInstanceOf(MergeError); // لازم تبقى ملاحظة
      await expect(mergeCandidates(db(), a.id, a.id, "o", "x")).rejects.toBeInstanceOf(MergeError);
      await expect(splitCandidate(db(), a.id, [], "o")).rejects.toBeInstanceOf(MergeError);
    });
  });

  describe("الماسح A06 (يكمل · يستنى · يوقف)", () => {
    it("كل قرار بينقل المرشح بالانتقال المسموح، والفشل بيضل مرشح بمرحلته", async () => {
      const a = await mk(T(), { problem: "تساقط الشعر" });
      const b = await mk(T());
      const c = await mk(T());
      const d = await mk(T());
      const mine = new Set([a, b, c, d].map((x) => candRef(x.id)));
      const agent: AgentFn = async (code, vars, ref) => {
        expect(code).toBe("A06");
        if (mine.has(ref)) expect(vars.intent_ratio).toBe("غير مقاس"); // عيّنة تعليقات ما في
        if (ref === candRef(a.id)) return { verdict: "continue", reason: "ممتاز" };
        if (ref === candRef(b.id)) return { verdict: "hold", reason: "إشارات ضعيفة" };
        if (ref === candRef(c.id)) return { verdict: "stop", reason: "برّا التركيز" };
        return null; // فشل الوكيل (d) أو مرشحين اختبارات تانية: ما منلمسهم
      };
      await runScanner(db(), agent);
      const get = (x: { id: string }) => db().candidate.findUniqueOrThrow({ where: { id: x.id } });
      expect((await get(a)).status).toBe("shortlisted");
      expect(await get(b)).toMatchObject({ status: "held", decisionReason: "الماسح: يستنى — إشارات ضعيفة" });
      expect(await get(c)).toMatchObject({ status: "held", decisionReason: "الماسح: يوقف — برّا التركيز" }); // «يوقف» مش رفض نهائي
      expect((await get(d)).status).toBe("new"); // فشل الوكيل: بيضل ويرجع ينفحص
    });
    it("نسبة النية بتنبعت للماسح لما العيّنة 50 فأكتر", async () => {
      const x = await mk(T(), { intentComments: 12, commentSample: 100 });
      let seen: unknown;
      await runScanner(db(), async (_code, vars, ref) => (ref === candRef(x.id) ? ((seen = vars.intent_ratio), { verdict: "hold", reason: "x" }) : null));
      expect(seen).toBe(0.12);
    });
  });

  describe("المحقق A07 (أعلى N من القائمة القصيرة بس) والفحص المبدئي", () => {
    async function shortlist(n: number, velocityStart: number) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const c = await mk(T());
        out.push(await db().candidate.update({ where: { id: c.id }, data: { status: "shortlisted", velocityScore: velocityStart - i * 0.01 } }));
      }
      return out;
    }

    it("المحقق ما بيشتغل على أكتر من 30 (من الإعدادات)، وبيعبّي صفات الحمض بقيم مسموحة بس", async () => {
      const cands = await shortlist(35, 100);
      const called: string[] = [];
      let first = true;
      const agent: AgentFn = async (code, vars, ref) => {
        expect(code).toBe("A07");
        called.push(ref);
        if (first) {
          first = false;
          return { consistency: "high", stage: "early", market_gap: "x", traits_filled: [{ trait: "result_speed", value: "أسابيع", why: "x" }, { trait: "problem_clarity", value: "ممتاز جداً", why: "قيمة غلط" }, { trait: "unknown_trait", value: "x", why: "x" }], risks: [], opinion: "deep_research", reason: "x", evidence: [] };
        }
        return { consistency: "low", stage: "unknown", market_gap: "x", traits_filled: [], risks: [], opinion: "watch", reason: "x", evidence: [] };
      };
      const r = await runVerifier(db(), agent);
      expect(called).toHaveLength(30); // الحد 30 بالضبط
      expect(r.processed).toBe(30);
      expect(r.details.limit).toBe(30);
      const firstId = called[0].replace("cand:", "");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: firstId } })).status).toBe("verified");
      const profile = await db().dnaProfile.findUniqueOrThrow({ where: { ownerType_ownerId: { ownerType: "candidate", ownerId: firstId } } });
      expect(profile.traitsJson).toEqual({ result_speed: "أسابيع" }); // الغلط والمجهول اتجاهلوا
      expect(r.details.ignored_trait).toBe(2);
      expect(profile.filledBy).toBe("A07");
      // اللي طلع برّا الـ 30 (الأقل سرعة) ضل بالقائمة القصيرة
      const left = await db().candidate.count({ where: { id: { in: cands.map((c) => c.id) }, status: "shortlisted" } });
      expect(left).toBeGreaterThanOrEqual(5);
    });

    it("المحقق بيستلم الأرقام محسوبة بالكود، ورأيه بيظهر بالبطاقة «تقدير» جنب قرار القواعد", async () => {
      const c = await mk(T(), { trendAgeDays: 12, newCreators7d: 24, newCreatorsPrev7d: 10, intentComments: 13, commentSample: 120, engagementRate: 0.06, yellowCartShare: 0.35, advertisersInMarket: 1, cumulativeSales: 30000 });
      await db().candidate.update({ where: { id: c.id }, data: { status: "shortlisted", velocityScore: 200 } });
      let vars: Record<string, unknown> = {};
      await runVerifier(db(), async (_code, v, ref) => {
        if (ref === candRef(c.id)) vars = v;
        return { consistency: "high", stage: "early", market_gap: "x", traits_filled: [], risks: ["خطر"], opinion: "reject", reason: "ما بيناسب", evidence: [] };
      });
      // نفس إشارات مثال ملف المنطق بس بلا «تعدد البائعين» (المصدر منصة بيانات مش سوق): الإشارة بتنشال وبيتوزّع وزنها
      expect((vars.velocity as { score: number }).score).toBe(67);
      expect((vars.observations as unknown[]).length).toBe(1);
      // سجّل رأيه كأنو ضرب بالنظام (AgentRun) لأن الوكيل الوهمي ما بيسجّل
      await db().agentRun.create({ data: { agentCode: "A07", inputRef: candRef(c.id), model: "x", costUsd: new Prisma.Decimal(0), status: "ok", outputJson: { opinion: "reject", reason: "ما بيناسب", risks: ["خطر"] } } });
      const card = (await buildCard(db(), c.id))!;
      expect(card.numbers.velocity.score).toBe(67);
      expect(card.decision.investigator).toMatchObject({ opinion: "reject" });
      expect(card.decision.ready).toBe(true);
      expect(card.header.statusLabel).toContain("متحقق");
      expect(card.compliance.status).toBe("pending");
    });

    it("الفحص المبدئي: أعلى 15 من المتحقَّق منهم بس", async () => {
      const made = [];
      for (let i = 0; i < 18; i++) {
        const c = await mk(T());
        made.push(await db().candidate.update({ where: { id: c.id }, data: { status: "verified", velocityScore: 300 - i * 0.01 } }));
      }
      const seen = new Set<string>();
      const agent: AgentFn = async (code, _v, ref) => {
        seen.add(ref);
        return code === "A10" ? { market: "SY", verdict: "ready", conditions: [], cultural_fit: "x", reason: "x" } : null;
      };
      const r = await runScreen(db(), agent);
      expect(r.processed).toBe(15);
      expect(seen.size).toBe(15);
    });
  });

  describe("الحساب والبطاقة وقرار القواعد", () => {
    it("runCompute بيحسب مؤشر السرعة ويحفظه، والبيانات الناقصة ما بتكتب درجة", async () => {
      const full = await mk(T(), { trendAgeDays: 12, newCreators7d: 24, newCreatorsPrev7d: 10, intentComments: 13, commentSample: 120, engagementRate: 0.06, yellowCartShare: 0.35, advertisersInMarket: 1, cumulativeSales: 30000 });
      const thin = await mk(T());
      await runCompute(db());
      expect((await db().candidate.findUniqueOrThrow({ where: { id: full.id } })).velocityScore).toBe(67); // بلا إشارة البائعين (المصدر مش سوق)
      expect((await db().candidate.findUniqueOrThrow({ where: { id: thin.id } })).velocityScore).toBeNull();
      const snap = await db().scoreSnapshot.findFirstOrThrow({ where: { candidateId: full.id }, orderBy: { createdAt: "desc" } });
      expect(snap.rulesVersion).toMatch(/^2026-/);
    });

    it("تجميع البطاقات: 401 صانع = ارفض تلقائياً، وبلا اقتصاد ما في بحث معمّق، والتعارض بيتعلّم", async () => {
      const crowded = await mk(T(), { creators: 450, trendAgeDays: 10, newCreators7d: 30, newCreatorsPrev7d: 10, intentComments: 20, commentSample: 100, engagementRate: 0.09, yellowCartShare: 0.6, advertisersInMarket: 0, cumulativeSales: 1000 });
      const noEcon = await mk(T(), { trendAgeDays: 10, newCreators7d: 30, newCreatorsPrev7d: 10, intentComments: 20, commentSample: 100, engagementRate: 0.09, yellowCartShare: 0.6, advertisersInMarket: 0, cumulativeSales: 1000 });
      for (const c of [crowded, noEcon]) await db().candidate.update({ where: { id: c.id }, data: { status: "verified" } });
      await db().agentRun.create({ data: { agentCode: "A07", inputRef: candRef(noEcon.id), model: "x", costUsd: new Prisma.Decimal(0), status: "ok", outputJson: { opinion: "deep_research", reason: "ممتاز", risks: [] } } });

      await assembleCards(db());
      const a = await db().candidate.findUniqueOrThrow({ where: { id: crowded.id } });
      expect(a.decisionSuggested).toBe("reject");
      expect(a.decisionReason).toContain("reject_auto");
      expect(a.decisionReason).toContain("450");
      const b = await db().candidate.findUniqueOrThrow({ where: { id: noEcon.id } });
      expect(b.velocityScore).not.toBeNull();
      expect(b.decisionSuggested).toBe("reject"); // المؤشر عالي بس بلا اقتصاد معروف: الشروط ما اكتملت
      expect(b.decisionReason).toContain("سقف تكلفة الطلب");
      expect(b.conflictFlag).toBe(true); // القواعد «ارفض» والمحقق «بحث معمّق»
    });
  });

  describe("أزرار القرار على البطاقة", () => {
    async function verified() {
      const c = await mk(T());
      return db().candidate.update({ where: { id: c.id }, data: { status: "verified" } });
    }
    it("بحث معمّق للمالك، ومراقبة، ورفض بسبب من القائمة، والكل بسجل القرارات والتدقيق", async () => {
      const a = await verified();
      expect(await decideCandidate(db(), a.id, OWNER, { action: "deep_research" })).toMatchObject({ status: "deep_research" });
      const b = await verified();
      expect(await decideCandidate(db(), b.id, { sub: "r1", role: "researcher" }, { action: "watch" })).toMatchObject({ status: "watching" });
      const c = await verified();
      await decideCandidate(db(), c.id, OWNER, { action: "reject", reasonCode: "R02" });
      expect(await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "rejected" });
      expect(await db().decision.findFirstOrThrow({ where: { candidateId: c.id } })).toMatchObject({ action: "reject", reasonCode: "R02", actorId: "owner-1" });
      expect(listAudit(300).some((e) => e.action === "candidate.reject" && e.entityId === c.id)).toBe(true);
    });
    it("بحث معمّق للمالك والنائب بس (الباحث لأ)، والمشاهد ما بيقرّر", async () => {
      const a = await verified();
      await expect(decideCandidate(db(), a.id, { sub: "r1", role: "researcher" }, { action: "deep_research" })).rejects.toMatchObject({ code: "forbidden" });
      await expect(decideCandidate(db(), a.id, { sub: "v1", role: "viewer" }, { action: "watch" })).rejects.toMatchObject({ code: "forbidden" });
      expect((await db().candidate.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("verified");
      expect(await decideCandidate(db(), a.id, { sub: "d1", role: "deputy" }, { action: "deep_research" })).toMatchObject({ status: "deep_research" });
    });
    it("سبب الرفض لازم من القائمة، و«سبب تاني» لازم نص", async () => {
      const a = await verified();
      await expect(decideCandidate(db(), a.id, OWNER, { action: "reject" })).rejects.toMatchObject({ code: "bad_request" });
      await expect(decideCandidate(db(), a.id, OWNER, { action: "reject", reasonCode: "R99" })).rejects.toMatchObject({ code: "bad_request" });
      await expect(decideCandidate(db(), a.id, OWNER, { action: "reject", reasonCode: "R12" })).rejects.toMatchObject({ code: "bad_request" });
      await decideCandidate(db(), a.id, OWNER, { action: "reject", reasonCode: "R12", reasonText: "ما بيناسب الجمهور بهالموسم" });
      expect(await db().decision.findFirstOrThrow({ where: { candidateId: a.id } })).toMatchObject({ reasonCode: "R12", reasonText: "ما بيناسب الجمهور بهالموسم" });
    });
    it("البطاقة غير المتحقَّق منها ما بتنقرّر، والإجراء المجهول مرفوض، والمرشح المجهول 404", async () => {
      const c = await mk(T());
      await expect(decideCandidate(db(), c.id, OWNER, { action: "watch" })).rejects.toMatchObject({ code: "not_ready" });
      await expect(decideCandidate(db(), c.id, OWNER, { action: "launch" })).rejects.toBeInstanceOf(DecisionError);
      await expect(decideCandidate(db(), "nope", OWNER, { action: "watch" })).rejects.toMatchObject({ code: "not_found" });
      expect((await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("new");
    });
  });

  it("إدخال يدوي: ثقة «يدوي» 0.5 (منخفضة) وبنفس المسار", async () => {
    const c = await mk(T(), {}, "manual");
    const o = await db().observation.findFirstOrThrow({ where: { candidateId: c.id } });
    expect(o).toMatchObject({ accessMethod: "manual", trust: "low", source: "manual" });
    expect((o.extractedJson as { trustValue: number }).trustValue).toBe(0.5);
  });
});
