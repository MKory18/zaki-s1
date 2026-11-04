// Redis حقيقي (REDIS_URL): الجدولة بتوقيت عمّان والعامل بينفّذ مهمة.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Queue } from "bullmq";
import type IORedis from "ioredis";
import { QUEUE_NAME, enqueue, makeQueue, redisConnection, registerSchedulers, startWorker } from "../src/jobs/queue";
import { JOBS } from "../src/jobs/registry";

const has = Boolean(process.env.REDIS_URL);

const SETTINGS = {
  "schedule.nightly_pull": "00:00", "schedule.dedupe": "04:00", "schedule.compute": "05:00", "schedule.scanner": "05:30",
  "schedule.verifier": "06:30", "schedule.screen": "07:30", "schedule.cards": "08:30", "schedule.morning_report": "09:00",
  "schedule.dna_learning": "السبت 23:00", "schedule.weekly_report": "الأحد 10:00", "schedule.monthly_report": "يوم 1 الساعة 10:00",
  "schedule.tz": "Asia/Amman",
};

describe.skipIf(!has)("الطابور والجدولة على Redis حقيقي", () => {
  let conn: IORedis;
  let queue: Queue;

  beforeAll(async () => {
    conn = redisConnection();
    queue = makeQueue(conn);
    await queue.obliterate({ force: true });
  });
  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
    conn.disconnect();
  });

  it("بيسجّل كل المهام المجدولة (21) بتوقيت عمّان وبأوقات الخطة", async () => {
    const reg = await registerSchedulers(queue, SETTINGS);
    expect(reg.length).toBe(JOBS.filter((j) => !j.event).length);
    expect(reg.length).toBe(21);
    expect(reg.every((r) => r.tz === "Asia/Amman")).toBe(true);
    const sched = await queue.getJobSchedulers();
    expect(sched.length).toBe(21);
    const by = Object.fromEntries(sched.map((s) => [s.key, s]));
    expect(by["agent.scanner"].pattern).toBe("30 5 * * *");
    expect(by["agent.scanner"].tz).toBe("Asia/Amman");
    expect(by["report.monthly"].pattern).toBe("0 10 1 * *");
    expect(by["dna.learn"].pattern).toBe("0 23 * * 6");
  });

  it("إعادة التسجيل ما بتكرر، وتعديل الوقت بيحدّث الجدول", async () => {
    await registerSchedulers(queue, { ...SETTINGS, "schedule.scanner": "06:00" });
    const sched = await queue.getJobSchedulers();
    expect(sched.length).toBe(21);
    expect(sched.find((s) => s.key === "agent.scanner")?.pattern).toBe("0 6 * * *");
  });

  it("العامل بينفّذ مهمة بطلب، والفاشلة بتنبّه", async () => {
    const done: unknown[] = [];
    const failed: string[] = [];
    const worker = startWorker(
      conn.duplicate(),
      {
        "agent.run": async (data) => (done.push(data), { ok: true }),
        "import.process": async () => {
          throw new Error("ملف تالف");
        },
      },
      (job, err) => failed.push(`${job?.name}:${err.message}`),
    );
    try {
      await enqueue(queue, "agent.run", { code: "A06" });
      await enqueue(queue, "import.process", { file: "x" });
      for (let i = 0; i < 50 && (done.length < 1 || failed.length < 1); i++) await new Promise((r) => setTimeout(r, 100));
      expect(done).toEqual([{ code: "A06" }]);
      expect(failed).toEqual(["import.process:ملف تالف"]);
      await expect(enqueue(queue, "no.such.job")).rejects.toThrow("مهمة مجهولة");
    } finally {
      await worker.close();
    }
    expect(QUEUE_NAME).toBe("s1");
  });
});
