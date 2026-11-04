import { beforeEach, describe, expect, it } from "vitest";
import { clampForTelegram, foreignNumbers, renderTemplate } from "../src/reports/text";
import { dateLabel, dayPeriod, monthPeriod, weekPeriod, type MonthlyData, type MorningData, type WeeklyData } from "../src/reports/data";
import { CALLBACK, morningKeyboard, parseCallback, reasonKeyboard } from "../src/telegram/keyboards";
import { mockOutbox, resetMockOutboxForTests, sendToOwner } from "../src/telegram/client";
import { routeAlert, shouldNotifyTelegram } from "../src/telegram/alerts";
import { secretOk } from "../src/telegram/webhook";

const morning: MorningData = {
  kind: "morning", period: "2026-10-27", dateLabel: "الثلاثاء 27 تشرين الأول",
  items: [
    { id: "cabc12345678901", title: "زيت إكليل الجبل", problem: "تساقط الشعر", velocity: 72, dna: 65, cpaCeiling: "6.50", decision: "بحث معمّق", reason: "السرعة 72 والحمض 65", conflict: false, link: "https://s1.example/candidates/cabc12345678901" },
    { id: "cdef12345678901", title: "جهاز تدليك", problem: null, velocity: 48, dna: null, cpaCeiling: null, decision: "راقب", reason: "", conflict: true, link: "https://s1.example/candidates/cdef12345678901" },
  ],
  newTotal: 12, newBySource: [{ source: "aliexpress", label: "علي إكسبرس", count: 8 }, { source: "manual", label: "يدوي", count: 4 }],
  alerts: ["توقف الوكيل A07: وصل سقفه اليومي"], marketChange: "صعود زيت إكليل الجبل: المؤشر من 60 إلى 72", notes: ["الاقتصاد ناقص لـ 1 مرشح"],
};

describe("قالب التقرير الصباحي", () => {
  const t = renderTemplate(morning);
  it("بيحتوي الترتيب والأرقام الثلاثة والقرار والرابط والجديد والتنبيهات والتغيير", () => {
    expect(t).toContain("تقرير الصبح — الثلاثاء 27 تشرين الأول");
    expect(t).toContain("1. زيت إكليل الجبل — تساقط الشعر");
    expect(t).toContain("سرعة 72 · حمض 65 · سقف الطلب 6.50$");
    expect(t).toContain("المقترح: بحث معمّق (السرعة 72 والحمض 65)");
    expect(t).toContain("https://s1.example/candidates/cabc12345678901");
    expect(t).toContain("الجديد: 12 ملاحظة (علي إكسبرس 8 · يدوي 4)");
    expect(t).toContain("- توقف الوكيل A07");
    expect(t).toContain("أهم تغيير بالسوق: صعود");
  });
  it("الرقم الناقص بيظهر «—» والتقرير بيطلع بملاحظة «ناقص» مش بصمت", () => {
    expect(t).toContain("سرعة 48 · حمض — · سقف الطلب —");
    expect(t).toContain("فيه تعارض مع رأي المحقق");
    expect(t).toContain("ناقص:\n- الاقتصاد ناقص لـ 1 مرشح");
  });
});

describe("قالب الأسبوعي والشهري", () => {
  it("الأسبوعي: المسار والتحويل والتكلفة والرفض والتوصيات", () => {
    const w: WeeklyData = {
      kind: "weekly", period: "2026-W44",
      funnel: [{ label: "انكشف هالأسبوع", count: 40 }, { label: "انفرز", count: 20 }],
      conversions: [{ from: "انكشف هالأسبوع", to: "انفرز", pct: "50.0" }],
      agentCosts: [{ agent: "A06", usd: "1.20" }], agentCostTotal: "1.20",
      rejectReasons: [{ code: "R03", label: "هامش ضعيف", count: 4 }], recommendations: ["الهامش ضعيف: راجع التكلفة"], notes: ["نتائج مختبر الترند: ما في بيانات لسا"],
    };
    const t = renderTemplate(w);
    expect(t).toContain("التقرير الأسبوعي — 2026-W44");
    expect(t).toContain("- انكشف هالأسبوع ← انفرز: 50.0%");
    expect(t).toContain("تكلفة الوكلاء: 1.20$");
    expect(t).toContain("- هامش ضعيف: 4");
    expect(t).toContain("ناقص:\n- نتائج مختبر الترند");
  });
  it("الشهري: نسبة النجاح الناقصة بتظهر —", () => {
    const m: MonthlyData = { kind: "monthly", period: "2026-10", successRate: null, launched: 0, failed: 0, fromIdeas: 0, dnaChange: null, bestSources: [], recommendations: ["ما في ملاحظات هالشهر: شغّل المصادر"], notes: ["نسبة نجاح المنتجات: ما في منتجات مختبرة لسا"] };
    const t = renderTemplate(m);
    expect(t).toContain("نسبة نجاح المنتجات: —");
    expect(t).toContain("ناقص:");
  });
});

describe("حارس الأرقام", () => {
  it("نص نظيف (أرقام من المدخلات + ترقيم القائمة) بيمرّ", () => {
    expect(foreignNumbers(renderTemplate(morning), morning)).toEqual([]);
  });
  it("رقم مخترع بيتلقط، والأرقام العربية الهندية بتتحوّل، والروابط ما بتنحسب", () => {
    expect(foreignNumbers("المنتج الأول سرعته 91 وسقفه 6.5$", morning)).toEqual([91]);
    expect(foreignNumbers("السرعة ٩١", morning)).toEqual([91]);
    expect(foreignNumbers("افتح https://s1.example/candidates/c99887766 الآن", morning)).toEqual([]);
  });
  it("6.50 و6.5 نفس الرقم", () => {
    expect(foreignNumbers("سقف 6.5", morning)).toEqual([]);
  });
});

describe("حد تيليجرام", () => {
  it("النص الطويل بينقص وبيحط تنبيه", () => {
    const out = clampForTelegram("ب".repeat(5000));
    expect(out.length).toBeLessThan(4096);
    expect(out).toContain("كمّل على الموقع");
    expect(clampForTelegram("قصير")).toBe("قصير");
  });
});

describe("فترات التقارير بتوقيت عمّان", () => {
  it("اليوم والأسبوع والشهر", () => {
    const d = new Date("2026-10-27T05:30:00Z"); // 08:30 عمّان، الثلاثاء
    expect(dayPeriod(d)).toBe("2026-10-27");
    expect(monthPeriod(d)).toBe("2026-10");
    expect(weekPeriod(d)).toBe("2026-W44");
    expect(dateLabel(d)).toBe("الثلاثاء 27 تشرين الأول");
  });
  it("قبل منتصف الليل بتوقيت عمّان بس بعده بالتوقيت العالمي = اليوم الجاي", () => {
    expect(dayPeriod(new Date("2026-10-27T22:30:00Z"))).toBe("2026-10-28");
  });
});

describe("أزرار تيليجرام", () => {
  it("الصباحي: افتح وراقب وارفض لكل مرشح، وما في زر مالي، وcallback ≤ 64 بايت", () => {
    const kb = morningKeyboard(morning.items, "https://s1.example/reports/r1");
    expect(kb).toHaveLength(3);
    expect(kb[0].map((b) => b.text)).toEqual(["افتح 1", "راقب 1", "ارفض 1"]);
    expect(kb[2][0].text).toBe("افتح التقرير");
    const all = kb.flat();
    expect(all.some((b) => /(ادفع|اعتمد|ميزانية|صرف|حوّل)/.test(b.text))).toBe(false);
    for (const b of all) if (b.callback_data) expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
  });
  it("أسباب الرفض بلا R12 (بدها نص)", () => {
    const kb = reasonKeyboard("cabc12345678901", [{ code: "R01", label: "مشبّع" }, { code: "R02", label: "قديم" }, { code: "R12", label: "سبب تاني" }]);
    expect(kb.flat().map((b) => b.callback_data)).toEqual(["x:cabc12345678901:R01", "x:cabc12345678901:R02"]);
  });
  it("قراءة callback: صالح، وكل شي تاني unknown (بما فيها بحث معمّق)", () => {
    expect(parseCallback(CALLBACK.watch("cabc12345678901"))).toEqual({ kind: "watch", id: "cabc12345678901" });
    expect(parseCallback(CALLBACK.rejectMenu("cabc12345678901"))).toEqual({ kind: "reject_menu", id: "cabc12345678901" });
    expect(parseCallback(CALLBACK.rejectDo("cabc12345678901", "R03"))).toEqual({ kind: "reject_do", id: "cabc12345678901", code: "R03" });
    for (const bad of ["d:cabc12345678901", "x:cabc12345678901", "x:cabc12345678901:R3", "w:", "w:a b", "", undefined, "w:cabc12345678901:R01 ; drop"]) {
      expect(parseCallback(bad as string | undefined).kind, String(bad)).toBe("unknown");
    }
  });
});

describe("سر الويبهوك", () => {
  it("بلا سر مضبوط أو بلا هيدر أو غلط = مرفوض، وصح = مقبول", () => {
    expect(secretOk("x", {})).toBe(false);
    expect(secretOk(null, { TELEGRAM_WEBHOOK_SECRET: "abc" })).toBe(false); // scan:ok
    expect(secretOk("abd", { TELEGRAM_WEBHOOK_SECRET: "abc" })).toBe(false); // scan:ok
    expect(secretOk("abcd", { TELEGRAM_WEBHOOK_SECRET: "abc" })).toBe(false); // scan:ok
    expect(secretOk("abc", { TELEGRAM_WEBHOOK_SECRET: "abc" })).toBe(true); // scan:ok
  });
});

describe("عميل تيليجرام والتنبيهات", () => {
  beforeEach(() => resetMockOutboxForTests());
  it("بلا توكن = وهمي: الرسالة بالذاكرة وما بتطلع", async () => {
    const r = await sendToOwner("مرحبا", undefined, { env: { TELEGRAM_OWNER_CHAT_ID: "42" } });
    expect(r).toEqual({ ok: true, mock: true });
    expect(mockOutbox).toEqual([{ chatId: "42", text: "مرحبا", keyboard: undefined }]);
  });
  it("بلا chat id = ما بيبعت", async () => {
    const r = await sendToOwner("x", undefined, { env: {} });
    expect(r.ok).toBe(false);
    expect(mockOutbox).toHaveLength(0);
  });
  it("مع توكن: طلب واحد لتيليجرام بدون redirect، والتوكن ما بيطلع بخطأ الفشل", async () => {
    const calls: { url: string; body: unknown; redirect?: string }[] = [];
    const ok = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), redirect: init.redirect });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const env = { TELEGRAM_BOT_TOKEN: "123:fake-token", TELEGRAM_OWNER_CHAT_ID: "42" }; // scan:ok
    const r = await sendToOwner("مرحبا", [[{ text: "افتح", url: "https://s1.example" }]], { fetchImpl: ok, env });
    expect(r).toEqual({ ok: true, mock: false });
    expect(calls[0].url).toBe("https://api.telegram.org/bot123:fake-token/sendMessage");
    expect(calls[0].redirect).toBe("error");
    expect(calls[0].body).toMatchObject({ chat_id: "42", text: "مرحبا", reply_markup: { inline_keyboard: [[{ text: "افتح" }]] } });

    const boom = (async () => {
      throw new Error("connect ECONNREFUSED https://api.telegram.org/bot123:fake-token/sendMessage");
    }) as unknown as typeof fetch;
    const f = await sendToOwner("x", undefined, { fetchImpl: boom, env });
    expect(f.ok).toBe(false);
    expect(JSON.stringify(f)).not.toContain("fake-token");
    const http500 = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    expect((await sendToOwner("x", undefined, { fetchImpl: http500, env })).error).toBe("تيليجرام رد 500");
  });
  it("التوجيه: الحرج وأنواع محددة لتيليجرام، والباقي للوحة بس", async () => {
    expect(shouldNotifyTelegram({ type: "budget", severity: "warning" })).toBe(true);
    expect(shouldNotifyTelegram({ type: "whatever", severity: "critical" })).toBe(true);
    expect(shouldNotifyTelegram({ type: "source_failed", severity: "warning" })).toBe(false);
    expect(shouldNotifyTelegram({ type: "model_fallback", severity: "info" })).toBe(false);
    const env = { TELEGRAM_OWNER_CHAT_ID: "42", APP_URL: "https://s1.example" };
    const a = { id: 1, at: "2026-10-27T00:00:00Z", type: "budget", severity: "warning" as const, message: "توقف الوكيل A07: وصل سقفه اليومي 5$", link: null };
    expect(await routeAlert(a, { env })).toMatchObject({ sent: true });
    expect(mockOutbox[0].text).toBe("تنبيه: توقف الوكيل A07: وصل سقفه اليومي 5$");
    expect(mockOutbox[0].keyboard?.[0][0].text).toBe("افتح الوكلاء");
    expect(await routeAlert({ ...a, type: "source_failed" }, { env })).toEqual({ sent: false });
    expect(mockOutbox).toHaveLength(1);
  });
});
