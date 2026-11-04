// الطابور والجدولة (BullMQ على Redis). الجدولة بتوقيت عمّان، وبتنبني من إعدادات الجدولة.
import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { JOBS, resolveCron, scheduleTz, type JobDef } from "./registry";

export const QUEUE_NAME = "s1";

export function redisConnection(url = process.env.REDIS_URL) {
  if (!url) throw new Error("REDIS_URL مش مضبوط");
  return new IORedis(url, { maxRetriesPerRequest: null });
}

export function makeQueue(connection: IORedis) {
  return new Queue(QUEUE_NAME, { connection });
}

// بيسجّل كل مهمة مجدولة (أو بيحدّثها إذا تغيّر وقتها)، وبيشيل أي جدول قديم مش بالسجل
export async function registerSchedulers(queue: Queue, settings: Record<string, string>) {
  const tz = scheduleTz(settings);
  const wanted = new Map<string, { pattern: string; job: JobDef }>();
  for (const job of JOBS) {
    const pattern = resolveCron(job, settings);
    if (pattern) wanted.set(job.name, { pattern, job });
  }
  for (const [name, { pattern, job }] of wanted) {
    await queue.upsertJobScheduler(
      name,
      { pattern, tz },
      { name, data: {}, opts: { attempts: job.attempts, backoff: job.backoffMs ? { type: "fixed", delay: job.backoffMs } : undefined, removeOnComplete: 200, removeOnFail: 500 } },
    );
  }
  for (const s of await queue.getJobSchedulers()) {
    if (s.key && !wanted.has(s.key)) await queue.removeJobScheduler(s.key);
  }
  return [...wanted].map(([name, v]) => ({ name, pattern: v.pattern, tz }));
}

// مهمة بطلب (أحداث أو تشغيل يدوي)
export async function enqueue(queue: Queue, name: string, data: Record<string, unknown> = {}) {
  const job = JOBS.find((j) => j.name === name);
  if (!job && name !== "agent.run") throw new Error(`مهمة مجهولة: ${name}`);
  return queue.add(name, data, { attempts: job?.attempts ?? 1, removeOnComplete: 200, removeOnFail: 500 });
}

export type Handler = (data: Record<string, unknown>, job: Job) => Promise<unknown>;

export function startWorker(connection: IORedis, handlers: Record<string, Handler>, onFail?: (job: Job | undefined, err: Error) => void) {
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const h = handlers[job.name];
      if (!h) throw new Error(`ما في معالج للمهمة ${job.name}`);
      return h(job.data ?? {}, job);
    },
    { connection, concurrency: 2 },
  );
  worker.on("failed", (job, err) => onFail?.(job, err));
  return worker;
}
