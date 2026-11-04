// قاعدة حقيقية: بوابة الامتثال (الفحص والمراجعة والأحداث) + المكتبات بالتعديل + الدفعات والتراخيص والتنبيهات. الوكيل وهمي.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { AgentRunError } from "../src/agents/runner";
import { listAlerts, resetAlertsForTests } from "../src/lib/alerts";
import { buildCompliance } from "../src/adapters/product-compliance";
import { createLibraryRow, deleteLibraryRow, listLibrary, reviewText, updateLibraryRow } from "../src/compliance/library";
import { ComplianceError } from "../src/compliance/errors";
import { listEvents } from "../src/compliance/events";
import { blockBatch, createBatch, createLicense, listLicenses, releaseBatch, sweepBatches, sweepLicenses, sweepPolicies, updateBatch } from "../src/compliance/quality";
import { inbox, latestCheck, listChecks, reviewCheck, runCompliance, screenCandidate, type AgentRunner } from "../src/compliance/service";
import { buildCard } from "../src/pipeline/card";

const has = Boolean(process.env.DATABASE_URL);
const rand = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const PREFIX = "cmp" + rand(5);
const DAY = 86_400_000;
const T0 = new Date(Date.now() - 2000); // أحداث هالاختبار بس (الجدول بيكبر بين التشغيلات)
const SINCE = T0.toISOString();

const agentSays = (out: unknown): AgentRunner => async () => ({ output: out });
const agentDown: AgentRunner = async () => {
  throw new AgentRunError("no_tier", "ما في موديل مضبوط");
};
const passOpinion = { classification: "cosmetic", classification_reason: "تجميلي", claims: [], references: [], ingredients: [], organic_ok: null, eye_product: false, license_needed: [], ad_rules: [], verdict: "pass", reasons: [] };

async function expectRefused(p: Promise<unknown>, status: number, re?: RegExp) {
  const e = await p.then(() => null, (x) => x);
  expect(e).toBeInstanceOf(ComplianceError);
  expect((e as ComplianceError).status).toBe(status);
  if (re) expect((e as ComplianceError).message).toMatch(re);
  return e as ComplianceError;
}

describe.skipIf(!has)("بوابة الامتثال على قاعدة حقيقية", () => {
  const db = () => getDb();
  const candIds: string[] = [];
  const pfIds: string[] = [];
  const codes: string[] = [];
  const batchIds: string[] = [];
  const licIds: string[] = [];
  const claimIds: string[] = [];
  const ruleIds: string[] = [];
  const mk = async (name: string, over: Record<string, unknown> = {}) => {
    const c = await db().candidate.create({ data: { titleAr: `${PREFIX} ${name}`, titleSrc: `${PREFIX} ${name}`, lane: "manual", status: "verified", ...over } as never });
    candIds.push(c.id);
    return c;
  };
  const pf = async (candidateId: string) => {
    const p = await db().productFile.create({ data: { candidateId, path: "ready_made", status: "draft", ownerId: "t" } });
    pfIds.push(p.id);
    return p;
  };

  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().complianceCheck.deleteMany({ where: { candidateId: { in: candIds } } });
    await db().batch.deleteMany({ where: { productRef: { in: [...pfIds, ...candIds] } } });
    await db().license.deleteMany({ where: { productRef: { in: [...pfIds, ...candIds] } } });
    await db().productFile.deleteMany({ where: { id: { in: pfIds } } });
    await db().candidate.updateMany({ where: { id: { in: candIds } }, data: { deletedAt: new Date() } });
    await db().referenceText.deleteMany({ where: { code: { in: codes } } });
    await db().claimRule.deleteMany({ where: { id: { in: claimIds } } });
    await db().adPolicyRule.deleteMany({ where: { id: { in: ruleIds } } });
    await db().outboundEvent.deleteMany({ where: { createdAt: { gte: T0 } } });
    await db().$disconnect();
  });
  beforeEach(() => resetAlertsForTests());

  describe("الفحص", () => {
    it("«بيعالج الفطريات» على تجميلي بينرفض مع بديله، والوكيل ما بيخفّف، والنتيجة بتنحفظ وبيطلع حدث", async () => {
      const c = await mk("كريم للقدم");
      const r = await runCompliance(db(), c.id, { stage: "full", claims: ["بيعالج الفطريات"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(r.verdict).toBe("fail");
      expect(r.result.agent.used).toBe(true);
      const claim = r.result.claims.find((x) => x.text === "بيعالج الفطريات")!;
      expect(claim).toMatchObject({ status: "banned", source: "code" });
      expect(claim.alternative).toBeTruthy();
      const saved = await latestCheck(db(), c.id);
      expect(saved).toMatchObject({ id: r.id, stage: "full", verdict: "fail", effective: "fail", classification: "therapeutic" });
      expect(saved!.reasons.join(" ")).toContain("بيعالج الفطريات");
      const ev = (await listEvents(db(), { since: SINCE, type: "compliance.updated", limit: 500 })).filter((e) => e.data.candidate_id === c.id);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ targets: ["الإنتاج", "الميديا باير", "الكليبر", "الردود"], data: { verdict: "fail", reason: "check" } });
    });

    it("نفس الحكم مرتين: ما في حدث ثاني. تغيّر الحكم: حدث جديد", async () => {
      const c = await mk("زيت شعر");
      const first = await runCompliance(db(), c.id, { stage: "full", claims: ["بيرطّب الشعر"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(first).toMatchObject({ verdict: "pass", changed: true });
      const again = await runCompliance(db(), c.id, { stage: "full", claims: ["بيرطّب الشعر"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(again.changed).toBe(false);
      const bad = await runCompliance(db(), c.id, { stage: "full", claims: ["بيشفي الشعر"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(bad).toMatchObject({ verdict: "fail", changed: true });
      const ev = (await listEvents(db(), { since: SINCE, type: "compliance.updated", limit: 500 })).filter((e) => e.data.candidate_id === c.id);
      expect(ev).toHaveLength(2);
      expect((await listChecks(db(), c.id)).map((x) => x.verdict)).toEqual(["fail", "pass", "pass"]);
    });

    it("الوكيل متوقف: المبدئي بالكود لحاله، والكامل بيوقف لقرار مختص", async () => {
      const c = await mk("صابون");
      const screen = await runCompliance(db(), c.id, { stage: "screen", claims: ["بينظّف البشرة"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentDown });
      expect(screen.verdict).toBe("pass");
      expect(screen.result.agent).toMatchObject({ used: false });
      const full = await runCompliance(db(), c.id, { stage: "full", claims: ["بينظّف البشرة"], ingredients: ["زيت الزيتون"], declaredClass: "cosmetic" }, { runAgent: agentDown });
      expect(full.verdict).toBe("needs_specialist");
    });

    it("رد وكيل مش بالشكل: بيتعامل معه كوكيل متوقف", async () => {
      const c = await mk("معجون");
      const r = await runCompliance(db(), c.id, { stage: "screen", claims: ["بينظّف الأسنان"], declaredClass: "cosmetic" }, { runAgent: agentSays({ nonsense: true }) });
      expect(r.result.agent.used).toBe(false);
    });

    it("مرشح مش موجود = 404، ومرحلة غلط = 400", async () => {
      await expectRefused(runCompliance(db(), "nope", { stage: "full" }, { runAgent: agentDown }), 404);
      await expectRefused(runCompliance(db(), "x", { stage: "other" as never }, { runAgent: agentDown }), 400);
    });

    it("الفحص المبدئي: ما بيعيد فحص مرشح ما تغيّرت المكتبات من آخر فحص إله، وبيعيد بعد تعديل مكتبة", async () => {
      const c = await mk("زيت العود");
      const first = await screenCandidate(db(), c.id, { runAgent: agentDown });
      expect(first).not.toBeNull();
      // نكتب تعديل مكتبة بعد الفحص: بيصير الفحص قديم
      const claim = await createLibraryRow(db(), "claims", { phrase: `${PREFIX} عبارة ممنوعة`, reason: "اختبار", appliesTo: "all" });
      claimIds.push(String(claim.id));
      const second = await screenCandidate(db(), c.id, { runAgent: agentDown });
      expect(second).not.toBeNull();
      const third = await screenCandidate(db(), c.id, { runAgent: agentDown });
      expect(third).toBeNull();
    });

    it("منتج العين: بيوقف بدون دفعة معقّمة مفروجة، وبيتحدّث بعد الإفراج", async () => {
      const c = await mk("قطرة ماء الكمأة للعين");
      const p = await pf(c.id);
      const opts = { stage: "full" as const, claims: ["مستوحى من الكمأة"], ingredients: [] as string[], declaredClass: "therapeutic" as const, markets: ["JO"] };
      const before = await runCompliance(db(), c.id, opts, { runAgent: agentSays({ ...passOpinion, classification: "therapeutic" }) });
      expect(before.result.eye).toBe(true);
      expect(before.result.checks.find((x) => x.key === "eye")!.status).toBe("specialist");
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-E1`, qty: 100, coaKey: "coa/e1.pdf", independentTestKey: "lab/e1.pdf", sterile: true, category: "eye" });
      batchIds.push(b.id);
      await releaseBatch(db(), b.id, "owner");
      const after = await runCompliance(db(), c.id, opts, { runAgent: agentSays({ ...passOpinion, classification: "therapeutic" }) });
      expect(after.result.checks.find((x) => x.key === "eye")!.status).toBe("ok");
    });
  });

  describe("نص زمزم وقرار المراجعين", () => {
    it("نص مختلف فيه بيوقف، ما بينعتمد الفحص قبل المراجع الشرعي، وبعده بيمرّ وبيطلع بنقطة القواعد", async () => {
      const code = `T-${rand(5)}`.toUpperCase();
      codes.push(code);
      const text = await createLibraryRow(db(), "references", { code, kind: "hadith", ingredient: "ماء زمزم", text: "«ماء زمزم لما شُرب له»", source: "ابن ماجه", grading: "مختلف في تصحيحه" });
      expect(text.reviewStatus).toBe("needs_specialist"); // المختلف فيه بيوقف من أول لحظة
      const c = await mk("منتج زمزم");
      const pfile = await pf(c.id);

      const run = await runCompliance(db(), c.id, { stage: "full", claims: ["بيرطّب البشرة"], ingredients: ["زيت الزيتون"], references: [{ code, usage: "عن المادة" }], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(run.verdict).toBe("needs_specialist");

      // مراجع الامتثال ما بيقدر يعتمد وفي نص ما اعتمده المراجع الشرعي
      const e1 = await expectRefused(reviewCheck(db(), run.id, "compliance-1", { verdict: "pass", note: "تمام" }), 409, new RegExp(code));
      expect(e1.code).toBe("refused");

      // صندوق المراجع الشرعي بيشوف النص
      expect((await inbox(db(), "texts")).map((t) => t.code)).toContain(code);
      // اعتماد نص مختلف فيه بلا أساس = مرفوض، وبأساس = مقبول
      await expectRefused(reviewText(db(), String(text.id), "sharia-1", { decision: "approve" }), 409);
      await expectRefused(reviewText(db(), String(text.id), "sharia-1", { decision: "reject" }), 400, /السبب/);
      const ok = await reviewText(db(), String(text.id), "sharia-1", { decision: "approve", note: "اعتمدته الجهة المختصة بالصيغة المذكورة" });
      expect(ok).toMatchObject({ reviewStatus: "approved", reviewerId: "sharia-1" });

      // الفحص القديم ما اتغيّر (بيضل بحكمه)، لكن المراجع هلأ بيقدر يعتمد لأن النص انعتمد
      expect((await inbox(db(), "claims")).map((x) => x.id)).toContain(run.id);
      const rev = await reviewCheck(db(), run.id, "compliance-1", { verdict: "pass", note: "النص معتمد شرعياً وعن المادة" });
      expect(rev).toMatchObject({ humanVerdict: "pass", effective: "pass" });
      expect((await inbox(db(), "claims")).map((x) => x.id)).not.toContain(run.id);

      // نقطة القواعد للأنظمة التانية: الحكم الفعلي = قرار المراجع، والنصوص المعتمدة بس
      const view = (await buildCompliance(db(), pfile.id))!;
      expect(view.verdict).toBe("pass");
      expect(view.classification).toBe("cosmetic");
      // النص ما اتصنّف approved_ok بالفحص (كان موقوف)، فما بيطلع بقائمة المراجع قبل إعادة الفحص
      expect(view.references.map((r) => r.code)).not.toContain(code);

      const rerun = await runCompliance(db(), c.id, { stage: "full", claims: ["بيرطّب البشرة"], ingredients: ["زيت الزيتون"], references: [{ code, usage: "عن المادة" }], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(rerun.verdict).toBe("pass");
      expect((await buildCompliance(db(), pfile.id))!.references).toEqual([expect.objectContaining({ code, source: "ابن ماجه", grading: "مختلف في تصحيحه", usage: "عن المادة" })]);
    });

    it("الرفض بالكود ما بينقلب بقرار مراجع", async () => {
      const c = await mk("كريم تفتيح");
      const run = await runCompliance(db(), c.id, { stage: "full", claims: ["كريم عضوي"], ingredients: ["زئبق"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(run.verdict).toBe("fail");
      await expectRefused(reviewCheck(db(), run.id, "compliance-1", { verdict: "pass", note: "اعتمدته" }), 409, /انرفض بالكود/);
      await expectRefused(reviewCheck(db(), run.id, "compliance-1", { verdict: "pass" }), 400, /السبب/);
      await expectRefused(reviewCheck(db(), run.id, "compliance-1", { verdict: "ممتاز", note: "x" }), 400);
      await expectRefused(reviewCheck(db(), "nope", "compliance-1", { verdict: "fail", note: "x" }), 404);
      expect(await reviewCheck(db(), run.id, "compliance-1", { verdict: "fail", note: "أؤكد الرفض" })).toMatchObject({ effective: "fail" });
    });

    it("بطاقة المرشح بتعرض الحكم الفعلي والأسباب", async () => {
      const c = await mk("كريم للقدم 2", { status: "verified" });
      const run = await runCompliance(db(), c.id, { stage: "screen", claims: ["بيعالج الفطريات"], declaredClass: "cosmetic" }, { runAgent: agentDown });
      const card = (await buildCard(db(), c.id))!;
      expect(card.compliance).toMatchObject({ status: "fail", checkId: run.id, stage: "screen" });
      expect(card.compliance.reasons.join(" ")).toContain("بيعالج الفطريات");
    });

    it("منتج ما انفحص امتثاله: بنقطة القواعد «يحتاج مراجعة» (الأمان أولاً)", async () => {
      const c = await mk("بلا فحص");
      const p = await pf(c.id);
      expect(await buildCompliance(db(), p.id)).toMatchObject({ verdict: "needs_specialist", classification: "needs_review", allowed_claims: [] });
    });
  });

  describe("المكتبات بالتعديل", () => {
    it("ادعاء: إضافة وتعديل وحذف، وكل تغيير بيطلق compliance.updated", async () => {
      const row = await createLibraryRow(db(), "claims", { phrase: `${PREFIX} يزيل التجاعيد نهائياً`, reason: "مبالغة", alternative: "بيحسّن مظهر البشرة", appliesTo: "cosmetic", country: "jo" });
      claimIds.push(String(row.id));
      expect(row).toMatchObject({ appliesTo: "cosmetic", country: "JO" });
      const upd = await updateLibraryRow(db(), "claims", String(row.id), { reason: "وعد ممنوع" });
      expect(upd.reason).toBe("وعد ممنوع");
      await deleteLibraryRow(db(), "claims", String(row.id));
      expect((await listLibrary(db(), "claims")).some((r) => r.id === row.id)).toBe(false);
      const ev = (await listEvents(db(), { since: SINCE, type: "compliance.updated", limit: 500 })).filter((e) => e.data.id === row.id);
      expect(ev.map((e) => e.data.action)).toEqual(["create", "update", "delete"]);
      await expectRefused(createLibraryRow(db(), "claims", { phrase: "x" }), 400, /السبب/);
      await expectRefused(createLibraryRow(db(), "claims", { phrase: "x", reason: "y", appliesTo: "nope" }), 400);
      await expectRefused(updateLibraryRow(db(), "claims", "nope", { reason: "x" }), 404);
    });

    it("مكوّن محظور جديد بيمنع الفحص التالي فوراً", async () => {
      const ing = await createLibraryRow(db(), "ingredients", { nameAr: `${PREFIX}ماكس`, status: "banned", note: "اختبار" });
      const c = await mk("بخاخ");
      const r = await runCompliance(db(), c.id, { stage: "full", ingredients: [`${PREFIX}ماكس`], claims: ["بينظّف"], declaredClass: "cosmetic" }, { runAgent: agentSays(passOpinion) });
      expect(r.result.checks.find((x) => x.key === "ingredients")!.status).toBe("fail");
      await deleteLibraryRow(db(), "ingredients", String(ing.id));
      await expectRefused(createLibraryRow(db(), "ingredients", { nameAr: "س", status: "weird" }), 400);
    });

    it("نص مرجعي: الرمز فريد، وتعديل المحتوى بيلغي الاعتماد", async () => {
      const code = `T-${rand(5)}`.toUpperCase();
      codes.push(code);
      const t = await createLibraryRow(db(), "references", { code, kind: "hadith", text: "«الحبة السوداء فيها شفاء»", source: "البخاري ومسلم", grading: "متفق عليه" });
      expect(t.reviewStatus).toBe("pending");
      await expectRefused(createLibraryRow(db(), "references", { code, kind: "hadith", text: "x", source: "y" }), 409);
      await expectRefused(createLibraryRow(db(), "references", { code: "bad code!", kind: "hadith", text: "x", source: "y" }), 400);
      await reviewText(db(), String(t.id), "sharia-1", { decision: "approve" });
      expect((await listLibrary(db(), "references")).find((r) => r.id === t.id)!.reviewStatus).toBe("approved");
      const edited = await updateLibraryRow(db(), "references", String(t.id), { text: "«نص مختلف»" });
      expect(edited).toMatchObject({ reviewStatus: "pending", reviewerId: null });
      // تعديل ما بيمس المحتوى (قاعدة الاستخدام) ما بيلغي
      await reviewText(db(), String(t.id), "sharia-1", { decision: "approve" });
      expect((await updateLibraryRow(db(), "references", String(t.id), { usageRule: "عن المادة" })).reviewStatus).toBe("approved");
      // درجة ضعيفة بترجّعه موقوف لقرار مختص
      expect((await updateLibraryRow(db(), "references", String(t.id), { grading: "ضعيف" })).reviewStatus).toBe("needs_specialist");
      await expectRefused(reviewText(db(), String(t.id), "sharia-1", { decision: "approve" }), 409);
      await expectRefused(reviewText(db(), String(t.id), "sharia-1", { decision: "bogus" }), 400);
      await expectRefused(reviewText(db(), "nope", "sharia-1", { decision: "approve" }), 404);
      const rej = await reviewText(db(), String(t.id), "sharia-1", { decision: "reject", note: "ضعيف السند" });
      expect(rej).toMatchObject({ reviewStatus: "rejected", reviewNote: "ضعيف السند" });
    });

    it("قواعد الإعلانات: تاريخ آخر مراجعة، و«راجعتها اليوم»، والتنبيه على القديم مرة وحدة", async () => {
      const old = new Date(Date.now() - 120 * DAY);
      const rule = await createLibraryRow(db(), "ad-rules", { platform: "ميتا", rule: `${PREFIX} قاعدة قديمة`, wrongExample: "غلط", rightExample: "صح", lastReviewedAt: old.toISOString() });
      ruleIds.push(String(rule.id));
      expect(rule.staleDays).toBeGreaterThanOrEqual(120);
      const first = await sweepPolicies(db());
      expect(first.alerts).toBe(1);
      expect(listAlerts().filter((a) => a.type === "policy_stale")).toHaveLength(1);
      const fixed = await updateLibraryRow(db(), "ad-rules", String(rule.id), { reviewed: true });
      expect(fixed.staleDays).toBe(0);
      await expectRefused(createLibraryRow(db(), "ad-rules", { platform: "ميتا" }), 400);
    });
  });

  describe("الدفعات", () => {
    it("دفعة بلا شهادة ما بتنفرج + تنبيه، وبعد الشهادة بتنفرج، ومرتين بتبقى نفس النتيجة", async () => {
      const c = await mk("زيت سلامة");
      const p = await pf(c.id);
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-A1`, qty: 500 });
      batchIds.push(b.id);
      const e = await expectRefused(releaseBatch(db(), b.id, "owner"), 409, /ما بتنفرج/);
      expect((e.extra as { blockers: string[] }).blockers).toContain("ما في شهادة تحليل (COA) للدفعة");
      expect(listAlerts().some((a) => a.type === "batch_no_certificate")).toBe(true);

      await updateBatch(db(), b.id, { coaKey: "coa/a1.pdf" });
      // أول دفعة من المورّد: الفحص المستقل إلزامي
      const e2 = await expectRefused(releaseBatch(db(), b.id, "owner"), 409);
      expect((e2.extra as { blockers: string[] }).blockers.join(" ")).toContain("أول دفعة");
      await updateBatch(db(), b.id, { independentTestKey: "lab/a1.pdf" });
      const rel = await releaseBatch(db(), b.id, "owner");
      expect(rel).toMatchObject({ status: "released", releasedBy: "owner" });
      expect((await releaseBatch(db(), b.id, "owner")).status).toBe("released");
      // سجل المفروجة ثابت
      await expectRefused(updateBatch(db(), b.id, { qty: 1 }), 409);

      // الدفعة الثانية من نفس المنتج: ما بتحتاج فحص مستقل (عادي)، لكن بتحتاج شهادة
      const b2 = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-A2`, qty: 10, coaKey: "coa/a2.pdf" });
      batchIds.push(b2.id);
      expect((await releaseBatch(db(), b2.id, "owner")).status).toBe("released");
    });

    it("كحل بلا تحليل معادن ثقيلة ما بينفرج حتى بشهادة وفحص مستقل", async () => {
      const c = await mk("كحل عربي");
      const p = await pf(c.id);
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-K1`, qty: 40, coaKey: "coa/k.pdf", independentTestKey: "lab/k.pdf", category: "kohl" });
      batchIds.push(b.id);
      const e = await expectRefused(releaseBatch(db(), b.id, "owner"), 409);
      expect((e.extra as { blockers: string[] }).blockers.join(" ")).toContain("معادن ثقيلة");
      await updateBatch(db(), b.id, { heavyMetalsTested: true });
      expect((await releaseBatch(db(), b.id, "owner")).status).toBe("released");
    });

    it("فحص الامتثال بيقول عين: بيطبّق شروط العين حتى لو الفئة «عادي»", async () => {
      const c = await mk("قطرة للعين");
      const p = await pf(c.id);
      await runCompliance(db(), c.id, { stage: "screen", declaredClass: "therapeutic", claims: [] }, { runAgent: agentDown });
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-G1`, qty: 40, coaKey: "coa/g.pdf", independentTestKey: "lab/g.pdf" });
      batchIds.push(b.id);
      const e = await expectRefused(releaseBatch(db(), b.id, "owner"), 409);
      expect((e.extra as { blockers: string[] }).blockers.join(" ")).toContain("التصنيع المعقّم");
    });

    it("إيقاف دفعة: بسبب إلزامي، بيطلق batch.blocked وتنبيه حرج، وما بترجع تنفرج", async () => {
      const c = await mk("زيت موقوف");
      const p = await pf(c.id);
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-B1`, qty: 5, coaKey: "coa/b1.pdf", independentTestKey: "lab/b1.pdf" });
      batchIds.push(b.id);
      await expectRefused(blockBatch(db(), b.id, "owner", {}), 400, /سبب/);
      const blocked = await blockBatch(db(), b.id, "owner", { reason: "شكاوى من تحسس" });
      expect(blocked).toMatchObject({ status: "blocked", blockReason: "شكاوى من تحسس" });
      expect(listAlerts().find((a) => a.type === "batch_blocked")).toMatchObject({ severity: "critical" });
      const ev = (await listEvents(db(), { since: SINCE, type: "batch.blocked", limit: 500 })).filter((x) => x.data.batch_id === b.id);
      expect(ev).toHaveLength(1);
      expect(ev[0].targets).toEqual(["الـ OMS", "الأزمات"]);
      await expectRefused(releaseBatch(db(), b.id, "owner"), 409, /موقوفة/);
      expect((await blockBatch(db(), b.id, "owner", { reason: "تاني" })).status).toBe("blocked"); // نفس الطلب مرتين
      expect((await listEvents(db(), { since: SINCE, type: "batch.blocked", limit: 500 })).filter((x) => x.data.batch_id === b.id)).toHaveLength(1);
    });

    it("تحقق المدخلات: رقم مكرر لنفس المنتج 409، كمية صفر 400، فئة غلط 400، مورّد مجهول 400", async () => {
      const c = await mk("منتج للتحقق");
      const p = await pf(c.id);
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-V1`, qty: 1 });
      batchIds.push(b.id);
      await expectRefused(createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-V1`, qty: 1 }), 409);
      await expectRefused(createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-V2`, qty: 0 }), 400);
      await expectRefused(createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-V3`, qty: 1, category: "weird" }), 400);
      await expectRefused(createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-V4`, qty: 1, supplierId: "nope" }), 400);
      await expectRefused(createBatch(db(), { batchNo: "x", qty: 1 }), 400);
    });

    it("تنبيه دفعات معلّقة بلا شهادة من أكتر من يوم، مرة وحدة", async () => {
      const c = await mk("منتج تنبيه");
      const p = await pf(c.id);
      const b = await createBatch(db(), { productRef: p.id, batchNo: `${PREFIX}-S1`, qty: 1 });
      batchIds.push(b.id);
      expect((await sweepBatches(db(), new Date(Date.now() + 2 * DAY))).alerts).toBeGreaterThanOrEqual(1);
      expect(listAlerts().some((a) => a.type === "batch_no_certificate" && a.message.includes(`${PREFIX}-S1`))).toBe(true);
      // الدفعة الجديدة (أقل من يوم) ما بتنذكر
      resetAlertsForTests();
      await sweepBatches(db());
      expect(listAlerts().some((a) => a.message.includes(`${PREFIX}-S1`))).toBe(false);
    });
  });

  describe("التراخيص", () => {
    it("تنبيه قبل 60 يوم مرة وحدة + حدث license.expiring، والمنتهي حرج، والبعيد ولا شي", async () => {
      const c = await mk("منتج ترخيص");
      const p = await pf(c.id);
      const soon = await createLicense(db(), { productRef: p.id, country: "jo", authority: "المؤسسة العامة للغذاء والدواء", type: "تسجيل مستحضر تجميل", regNo: "J-1", status: "active", expiresAt: new Date(Date.now() + 30 * DAY).toISOString() });
      const gone = await createLicense(db(), { productRef: p.id, country: "SY", authority: "وزارة الصحة", type: "تسجيل", status: "active", expiresAt: new Date(Date.now() - 3 * DAY).toISOString() });
      const far = await createLicense(db(), { productRef: p.id, country: "SA", authority: "هيئة الغذاء والدواء", type: "إشعار", status: "active", expiresAt: new Date(Date.now() + 200 * DAY).toISOString() });
      licIds.push(soon.id, gone.id, far.id);
      expect(soon).toMatchObject({ country: "JO", alert: "expiring" });
      expect(gone.alert).toBe("expired");
      expect(far.alert).toBeNull();

      const run1 = await sweepLicenses(db());
      expect(run1.alerts).toBeGreaterThanOrEqual(2);
      const mine = listAlerts().filter((a) => a.message.includes(p.id));
      expect(mine).toHaveLength(2);
      expect(mine.find((a) => a.message.includes("انتهى"))!.severity).toBe("critical");
      expect(mine.find((a) => a.message.includes("بينتهي"))!.severity).toBe("warning");
      const ev = (await listEvents(db(), { since: SINCE, type: "license.expiring", limit: 500 })).filter((e) => e.data.product_ref === p.id);
      expect(ev.map((e) => e.data.country).sort()).toEqual(["JO", "SY"]);
      expect(ev[0].targets).toEqual(["الأزمات"]);
    });

    it("الترخيص الفعّال بيغيّر نتيجة الفحص: «مطلوب» ← «موجود»", async () => {
      const c = await mk("قطرة أذن للطنين");
      const p = await pf(c.id);
      const opts = { stage: "screen" as const, claims: [] as string[], declaredClass: "therapeutic" as const, markets: ["JO"] };
      const a = await runCompliance(db(), c.id, opts, { runAgent: agentDown });
      expect(a.result.licenses).toEqual([{ country: "JO", state: "required" }]);
      const lic = await createLicense(db(), { productRef: p.id, country: "JO", authority: "ج", type: "ت", status: "active", expiresAt: new Date(Date.now() + 400 * DAY).toISOString() });
      licIds.push(lic.id);
      const b = await runCompliance(db(), c.id, opts, { runAgent: agentDown });
      expect(b.result.licenses).toEqual([{ country: "JO", state: "exists" }]);
      expect((await listLicenses(db(), { productRef: p.id })).map((l) => l.id)).toEqual([lic.id]);
    });

    it("تحقق المدخلات: حالة غلط وتاريخ غلط وأيام تنبيه خارج المدى", async () => {
      await expectRefused(createLicense(db(), { productRef: "x", country: "JO", authority: "ج", type: "ت", status: "weird" }), 400);
      await expectRefused(createLicense(db(), { productRef: "x", country: "JO", authority: "ج", type: "ت", expiresAt: "ليس تاريخ" }), 400);
      await expectRefused(createLicense(db(), { productRef: "x", country: "JO", authority: "ج", type: "ت", alertDays: 0 }), 400);
      await expectRefused(createLicense(db(), { productRef: "x", country: "JO", type: "ت" }), 400);
    });
  });

  describe("الأحداث الصادرة", () => {
    it("السحب بـsince وtype، والنوع الغلط بيرفض", async () => {
      const t0 = new Date().toISOString();
      const c = await mk("حدث");
      await runCompliance(db(), c.id, { stage: "screen", claims: ["بيعالج"], declaredClass: "cosmetic" }, { runAgent: agentDown });
      const all = await listEvents(db(), { since: t0 });
      expect(all.some((e) => e.data.candidate_id === c.id)).toBe(true);
      expect(all.every((e) => new Date(e.occurred_at) > new Date(t0))).toBe(true);
      expect((await listEvents(db(), { since: t0, type: "batch.blocked" })).every((e) => e.type === "batch.blocked")).toBe(true);
      await expect(listEvents(db(), { type: "nope" })).rejects.toThrow(/نوع الحدث/);
      await expect(listEvents(db(), { since: "غلط" })).rejects.toThrow(/since/);
    });
  });
});
