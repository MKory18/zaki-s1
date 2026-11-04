import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { timeToCron } from "../src/jobs/schedule";
import { JOBS, JOB_NAMES, resolveCron, scheduleTz } from "../src/jobs/registry";
import { HANDLERS } from "../src/jobs/handlers";

const seed = JSON.parse(readFileSync("prisma/seeds/seed-data.json", "utf8"));
const settings: Record<string, string> = Object.fromEntries(seed.settings.filter((s: { key: string }) => s.key.startsWith("schedule.")).map((s: { key: string; raw: string }) => [s.key, s.raw]));

describe("تحويل الأوقات لـ cron", () => {
  it("يومي وأسبوعي وشهري", () => {
    expect(timeToCron("00:00")).toBe("0 0 * * *");
    expect(timeToCron("05:30")).toBe("30 5 * * *");
    expect(timeToCron("السبت 23:00")).toBe("0 23 * * 6");
    expect(timeToCron("الأحد 10:00")).toBe("0 10 * * 0");
    expect(timeToCron("يوم 1 الساعة 10:00")).toBe("0 10 1 * *");
  });
  it("الإزاحة بالدقايق (وتلفّ بعد منتصف الليل)", () => {
    expect(timeToCron("00:00", 30)).toBe("30 0 * * *");
    expect(timeToCron("00:00", 60)).toBe("0 1 * * *");
    expect(timeToCron("23:50", 20)).toBe("10 0 * * *");
  });
  it("قيمة غلط = null", () => {
    for (const bad of ["25:00", "12:75", "الخميسين 10:00", "بكرة", "", "يوم 40 الساعة 10:00"]) expect(timeToCron(bad), bad).toBeNull();
  });
});

describe("سجل المهام", () => {
  const md = readFileSync("docs/02-plan.md", "utf8").split(/\r?\n/);
  const start = md.findIndex((l) => l.startsWith("## الجزء الثامن"));

  it("نفس مهام جدول الجزء الثامن بالخطة بالضبط (23)", () => {
    const rows: string[] = [];
    for (let i = start + 1; i < md.length && !md[i].startsWith("## "); i++) {
      if (md[i].startsWith("|") && !md[i].startsWith("|---")) rows.push(md[i].split("|")[1].trim());
    }
    const names = rows.filter((n) => n !== "المهمة");
    expect(names.length).toBe(23);
    expect([...names].sort()).toEqual([...JOB_NAMES].sort());
  });

  it("كل مهمة مجدولة بتطلع لها cron صالح من الإعدادات المبذورة", () => {
    for (const j of JOBS) {
      const c = resolveCron(j, settings);
      if (j.event) {
        expect(c, j.name).toBeNull();
        continue;
      }
      expect(c, j.name).toMatch(/^[\d*/]+ [\d*/]+ [\d*/]+ \* [\d*]+$|^[\d*/]+ [\d*/]+ [\d*]+ \* \*$|^[\d*/]+ [\d*/]+ \* \* \*$/);
    }
  });

  it("أوقات الخطة بالضبط", () => {
    const at = (n: string) => resolveCron(JOBS.find((j) => j.name === n)!, settings);
    expect(at("pull.aliexpress")).toBe("0 0 * * *");
    expect(at("pull.meta_eu")).toBe("30 0 * * *");
    expect(at("pull.google_trends")).toBe("0 1 * * *");
    expect(at("dedupe")).toBe("0 4 * * *");
    expect(at("compute.scores")).toBe("0 5 * * *");
    expect(at("watch.reeval")).toBe("15 5 * * *");
    expect(at("agent.scanner")).toBe("30 5 * * *");
    expect(at("agent.verifier")).toBe("30 6 * * *");
    expect(at("screen.batch")).toBe("30 7 * * *");
    expect(at("cards.assemble")).toBe("30 8 * * *");
    expect(at("report.morning")).toBe("0 9 * * *");
    expect(at("license.alerts")).toBe("0 8 * * *");
    expect(at("dna.learn")).toBe("0 23 * * 6");
    expect(at("report.weekly")).toBe("0 10 * * 0");
    expect(at("report.monthly")).toBe("0 10 1 * *");
    expect(at("trend.metrics.pull")).toBe("0 * * * *");
    expect(at("outbound.retry")).toBe("*/5 * * * *");
    expect(at("budget.reset")).toBe("0 0 * * *");
    expect(at("backup.db")).toBe("0 3 * * *");
  });

  it("المنطقة الزمنية عمّان، وتعديل وقت من الإعدادات بيغيّر الجدولة", () => {
    expect(scheduleTz(settings)).toBe("Asia/Amman");
    const j = JOBS.find((x) => x.name === "agent.scanner")!;
    expect(resolveCron(j, { ...settings, "schedule.scanner": "06:00" })).toBe("0 6 * * *");
    expect(resolveCron(j, {})).toBeNull();
  });

  it("لكل مهمة معالج", () => {
    for (const n of JOB_NAMES) expect(typeof HANDLERS[n], n).toBe("function");
    expect(typeof HANDLERS["agent.run"]).toBe("function");
  });

  it("المهام الفاشلة بتعيد حسب الخطة (السحب بعد ساعة، التقرير بعد 15 دقيقة)", () => {
    const j = (n: string) => JOBS.find((x) => x.name === n)!;
    expect(j("pull.aliexpress")).toMatchObject({ attempts: 2, backoffMs: 3_600_000 });
    expect(j("report.morning")).toMatchObject({ attempts: 2, backoffMs: 900_000 });
  });
});
