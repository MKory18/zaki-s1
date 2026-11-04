// قاعدة حقيقية: التقارير (بيانات · أرشفة · إرسال مرة وحدة) + أزرار تيليجرام + لوحة التنبيهات. الكاتب وتيليجرام وهميين.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../src/lib/db";
import { importSeeds } from "../src/seeds/import";
import { buildMorning } from "../src/reports/data";
import { generateReport, getReport, listReports, type AgentRunner } from "../src/reports/service";
import { handleUpdate } from "../src/telegram/webhook";
import { mockOutbox, resetMockOutboxForTests } from "../src/telegram/client";
import { ackAlert, listBoard } from "../src/lib/alerts-board";

const has = Boolean(process.env.DATABASE_URL);
const rand = (n: number) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 26)]).join("");
const PREFIX = "rep" + rand(5);
// أيام بالمستقبل البعيد: مفتاح التقرير (النوع + الفترة) فريد لكل اختبار وما بيتعارض مع تشغيلات تانية
const dayAt = (i: number) => new Date(Date.UTC(2200 + Math.floor(Math.random() * 400), 0, 1 + i * 3));
const OWNER_CHAT = "777001";
const tgEnv = { TELEGRAM_OWNER_CHAT_ID: OWNER_CHAT };

describe.skipIf(!has)("التقارير وتيليجرام على قاعدة حقيقية", () => {
  const db = () => getDb();
  const candIds: string[] = [];
  const periods: string[] = [];
  const mk = async (name: string, over: Record<string, unknown> = {}) => {
    const c = await db().candidate.create({
      data: { titleAr: `${PREFIX} ${name}`, titleSrc: `${PREFIX} ${name}`, lane: "manual", status: "verified", velocityScore: 1000, dnaScore: 66, conflictFlag: true, decisionSuggested: "deep_research", decisionReason: "deep_research: السرعة 1000 والحمض 66", ...over } as never,
    });
    candIds.push(c.id);
    return c;
  };
  const fakeWriter = (make: (data: { items: { title: string; velocity: number | null }[] }) => string): AgentRunner => async (_db, code, vars) => {
    expect(code).toBe("A17");
    return { output: make(JSON.parse(String(vars.data))) };
  };

  beforeAll(async () => {
    await importSeeds(db());
  });
  afterAll(async () => {
    await db().candidate.updateMany({ where: { id: { in: candIds } }, data: { deletedAt: new Date() } });
    await db().report.deleteMany({ where: { period: { in: periods } } });
    await db().alert.deleteMany({ where: { message: { startsWith: PREFIX } } });
    await db().$disconnect();
  });
  beforeEach(() => resetMockOutboxForTests());

  describe("بيانات الصباحي", () => {
    it("المرشحين الجاهزين مع الأرقام الثلاثة والقرار، والاقتصاد الناقص بيتعلّم بملاحظة، والمحسوب بيظهر", async () => {
      const a = await mk("أ-زيت");
      const b = await mk("ب-جهاز", { velocityScore: 999, dnaScore: null });
      await db().economicsCalc.create({ data: { candidateId: a.id, market: "SY", inputsJson: {}, lossLimit: "3", cpaCeiling: "6.5", scalingCeiling: "9", scenariosJson: [], kind: "projection" } });
      const d = await buildMorning(db(), dayAt(0));
      const ia = d.items.find((i) => i.id === a.id)!;
      const ib = d.items.find((i) => i.id === b.id)!;
      expect(ia).toMatchObject({ velocity: 1000, dna: 66, cpaCeiling: "6.50", decision: "بحث معمّق", reason: "السرعة 1000 والحمض 66", conflict: true });
      expect(ib).toMatchObject({ velocity: 999, dna: null, cpaCeiling: null });
      expect(ia.link).toContain(`/candidates/${a.id}`);
      expect(d.notes.some((n) => n.startsWith("الاقتصاد ناقص لـ"))).toBe(true);
    });
    it("المرشح غير المتحقَّق منه (new) ما بيدخل", async () => {
      const n = await mk("جديد", { status: "new" });
      const d = await buildMorning(db(), dayAt(1));
      expect(d.items.some((i) => i.id === n.id)).toBe(false);
    });
  });

  describe("التوليد والأرشفة والإرسال", () => {
    const token = { TELEGRAM_BOT_TOKEN: "1:fake-token", TELEGRAM_OWNER_CHAT_ID: OWNER_CHAT }; // scan:ok
    const spy = (status = 200) => {
      const calls: { method: string; body: Record<string, unknown> }[] = [];
      const fetchImpl = (async (url: string, init: RequestInit) => {
        calls.push({ method: url.split("/").pop()!, body: JSON.parse(String(init.body)) });
        return new Response("{}", { status });
      }) as unknown as typeof fetch;
      return { calls, deps: { fetchImpl, env: token } };
    };

    it("نص الكاتب النظيف بيتخزّن مع «ناقص»، والمفتاح (النوع + الفترة) فريد: إعادة التوليد ما بتكرّر ولا بتبعت مرتين", async () => {
      await mk("هـ-إعادة");
      const now = dayAt(2);
      const t = spy();
      const writer = fakeWriter((d) => `صباح الخير، أول منتج ${d.items[0].title} سرعته ${d.items[0].velocity}`);
      const r1 = await generateReport(db(), "morning", { now, runAgent: writer, telegram: t.deps });
      periods.push(r1.period);
      expect(r1).toMatchObject({ source: "agent", reused: false, sent: true, telegramMock: false });
      expect(r1.text).toContain("صباح الخير، أول منتج");
      expect(r1.text).toContain("ناقص:");
      expect(t.calls.map((c) => c.method)).toEqual(["sendMessage"]);
      const kb = (t.calls[0].body.reply_markup as { inline_keyboard: { text: string }[][] }).inline_keyboard;
      expect(kb.at(-1)![0].text).toBe("افتح التقرير");
      expect(JSON.stringify(t.calls[0].body)).not.toContain("fake-token");

      const r2 = await generateReport(db(), "morning", { now, runAgent: writer, telegram: t.deps });
      expect(r2).toMatchObject({ id: r1.id, reused: true, sent: true });
      expect(t.calls).toHaveLength(1); // ما انبعت مرة تانية
      expect(await db().report.count({ where: { kind: "morning", period: r1.period } })).toBe(1);

      const r3 = await generateReport(db(), "morning", { now, runAgent: writer, telegram: t.deps, force: true });
      expect(r3).toMatchObject({ id: r1.id, reused: false, sent: true });
      expect(t.calls).toHaveLength(2); // إعادة الكتابة بالقوة = إرسال جديد
    });

    it("رقم مخترع بنص الكاتب = نرجع للقالب ونسجّل السبب. رمي الخطأ = القالب كمان", async () => {
      await mk("و-حارس");
      const bad = await generateReport(db(), "morning", { now: dayAt(3), send: false, runAgent: fakeWriter(() => "السرعة 4321") });
      periods.push(bad.period);
      expect(bad.source).toBe("template");
      expect(bad.text).toContain("تقرير الصبح —");
      const saved = await getReport(db(), bad.id);
      expect((saved!.data as { _fallbackReason: string })._fallbackReason).toContain("أرقام مش من البيانات");

      const boom: AgentRunner = async () => {
        throw new Error("ما في موديل مضبوط");
      };
      const thrown = await generateReport(db(), "morning", { now: dayAt(4), send: false, runAgent: boom });
      periods.push(thrown.period);
      expect(thrown.source).toBe("template");
      const empty = await generateReport(db(), "morning", { now: dayAt(5), send: false, runAgent: async () => ({ output: "   " }) });
      periods.push(empty.period);
      expect(empty.source).toBe("template");
    });

    it("فشل الإرسال: التقرير بيتخزّن بدون sentAt، والمحاولة الجاية بتبعت بدون إعادة كتابة", async () => {
      const now = dayAt(6);
      const failing = spy(500);
      const writer = fakeWriter(() => "نص ثابت");
      const r1 = await generateReport(db(), "morning", { now, runAgent: writer, telegram: failing.deps });
      periods.push(r1.period);
      expect(r1).toMatchObject({ sent: false, sendError: "تيليجرام رد 500" });
      expect((await getReport(db(), r1.id))!.sentAt).toBeNull();
      const ok = spy();
      const r2 = await generateReport(db(), "morning", { now, runAgent: writer, telegram: ok.deps });
      expect(r2).toMatchObject({ id: r1.id, reused: true, sent: true });
      expect(ok.calls).toHaveLength(1);
      expect((await getReport(db(), r1.id))!.sentAt).not.toBeNull();
    });

    it("بلا توكن (وهمي): التقرير بيتخزّن وبيروح للصندوق الوهمي وsentAt بيضل فاضي", async () => {
      const r = await generateReport(db(), "morning", { now: dayAt(7), runAgent: fakeWriter(() => "نص"), telegram: { env: tgEnv } });
      periods.push(r.period);
      expect(r).toMatchObject({ sent: false, telegramMock: true });
      expect(mockOutbox).toHaveLength(1);
    });

    it("الأسبوعي والشهري: بيطلعوا بقسم «ناقص» عن المختبر والحمض، وبالأرشيف", async () => {
      const w = await generateReport(db(), "weekly", { now: dayAt(8), send: false, runAgent: async () => ({ output: "" }) });
      const m = await generateReport(db(), "monthly", { now: dayAt(9), send: false, runAgent: async () => ({ output: "" }) });
      periods.push(w.period, m.period);
      expect(w.period).toMatch(/^\d{4}-W\d{2}$/);
      expect(m.period).toMatch(/^\d{4}-\d{2}$/);
      expect(w.text).toContain("المسار:");
      expect(w.text).toContain("نتائج مختبر الترند");
      expect(m.text).toContain("نسبة نجاح المنتجات");
      const list = await listReports(db(), "weekly");
      expect(list.some((x) => x.id === w.id)).toBe(true);
      expect(await getReport(db(), "nope")).toBeNull();
    });
  });

  describe("أزرار تيليجرام", () => {
    const upd = (id: string, data: string, chat = OWNER_CHAT) => ({ callback_query: { id: "cb1", from: { id: Number(chat) }, message: { chat: { id: Number(chat) } }, data: `${data}${id}` } });

    it("راقب: المرشح المتحقَّق منه بيصير مراقَب، والقرار مسجّل «من تيليجرام» ومعه التدقيق", async () => {
      const c = await mk("راقب", { conflictFlag: false });
      const r = await handleUpdate(db(), upd(c.id, "w:"), { env: tgEnv });
      expect(r).toMatchObject({ handled: true, replied: "تمّ: مراقبة" });
      expect((await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("watching");
      const d = await db().decision.findFirstOrThrow({ where: { candidateId: c.id } });
      expect(d).toMatchObject({ action: "watch", actorId: "telegram:owner", fromTelegram: true });
      expect(mockOutbox.at(-1)!.text).toContain("تمّت المراقبة");
    });

    it("ارفض بسبب: قائمة الأسباب بلا R12، وبعد الاختيار بيترفض بالسبب", async () => {
      const c = await mk("ارفض", { conflictFlag: false });
      await handleUpdate(db(), upd(c.id, "r:"), { env: tgEnv });
      const kb = mockOutbox.at(-1)!.keyboard!.flat();
      const codes = kb.map((b) => b.callback_data).filter(Boolean) as string[];
      expect(codes.length).toBeGreaterThanOrEqual(11);
      expect(codes.some((x) => x.endsWith(":R12"))).toBe(false);
      expect(kb.at(-1)!.text).toBe("افتح البطاقة");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("verified"); // القائمة وحدها ما بترفض

      const r = await handleUpdate(db(), { callback_query: { id: "cb2", message: { chat: { id: Number(OWNER_CHAT) } }, data: `x:${c.id}:R03` } }, { env: tgEnv });
      expect(r).toMatchObject({ handled: true, replied: "تمّ الرفض" });
      expect(await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).toMatchObject({ status: "rejected" });
      expect(await db().decision.findFirstOrThrow({ where: { candidateId: c.id } })).toMatchObject({ action: "reject", reasonCode: "R03", fromTelegram: true });
    });

    it("مرفوض: غير المالك · بحث معمّق · سبب مش من القائمة · مرشح مش جاهز · مرشح مش موجود", async () => {
      const c = await mk("ممنوع", { conflictFlag: false });
      // غير المالك: بيتجاهل بلا أي تغيير
      expect(await handleUpdate(db(), upd(c.id, "w:", "999"), { env: tgEnv })).toMatchObject({ handled: false, reason: "not_owner" });
      // بحث معمّق من تيليجرام ممنوع: الأمر مش معروف
      expect(await handleUpdate(db(), upd(c.id, "d:"), { env: tgEnv })).toMatchObject({ handled: true, replied: "أمر مش مفهوم" });
      // سبب رفض مش موجود بالقائمة
      const bad = await handleUpdate(db(), { callback_query: { id: "c", message: { chat: { id: Number(OWNER_CHAT) } }, data: `x:${c.id}:R99` } }, { env: tgEnv });
      expect(bad.replied).toBe("اختار سبب رفض من القائمة");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("verified");
      expect(await db().decision.count({ where: { candidateId: c.id } })).toBe(0);
      // مرشح مش جاهز
      const n = await mk("لسا", { status: "new" });
      expect((await handleUpdate(db(), upd(n.id, "w:"), { env: tgEnv })).replied).toContain("مش جاهزة");
      expect((await db().candidate.findUniqueOrThrow({ where: { id: n.id } })).status).toBe("new");
      // مش موجود
      expect((await handleUpdate(db(), upd("zzzzzzzzzzzz", "w:"), { env: tgEnv })).replied).toBe("المرشح مش موجود");
      // تحديث مش ضغطة زر
      expect(await handleUpdate(db(), {}, { env: tgEnv })).toMatchObject({ handled: false });
      // بلا chat id مضبوط: كله مرفوض
      expect(await handleUpdate(db(), upd(c.id, "w:"), { env: {} })).toMatchObject({ handled: false, reason: "not_owner" });
    });
  });

  describe("لوحة التنبيهات", () => {
    it("المفتوحة والكل، و«شفت» بيسجّل مين ومتى، والتكرار آمن، ومجهول = null", async () => {
      const a = await db().alert.create({ data: { type: "budget", severity: "warning", message: `${PREFIX} وكيل وقف`, channels: ["panel", "telegram"] } });
      const open = await listBoard(db(), false, 500);
      expect(open.find((x) => x.id === a.id)).toMatchObject({ severity: "warning", channels: ["panel", "telegram"], ackAt: null });
      const first = await ackAlert(db(), a.id, "owner-1");
      expect(first).toMatchObject({ ackBy: "owner-1", already: false });
      expect((await ackAlert(db(), a.id, "someone-else"))).toMatchObject({ ackBy: "owner-1", already: true });
      expect((await listBoard(db(), false, 500)).some((x) => x.id === a.id)).toBe(false);
      expect((await listBoard(db(), true, 500)).find((x) => x.id === a.id)?.ackAt).not.toBeNull();
      expect(await ackAlert(db(), "nope", "owner-1")).toBeNull();
    });
  });
});
