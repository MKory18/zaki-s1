// نقطة دخول العامل: الطابور والجدولة. بلا REDIS_URL أو DATABASE_URL بيشتغل بنبض بس (تطوير بسيط).
import { dbConfigured, getDb } from "../src/lib/db";
import { listSettings } from "../src/lib/settings";
import { alertJobFailure, HANDLERS } from "../src/jobs/handlers";
import { makeQueue, redisConnection, registerSchedulers, startWorker } from "../src/jobs/queue";

const HEARTBEAT_MS = 60_000;

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

async function main() {
  log("العامل جاهز");
  setInterval(() => log("حي"), HEARTBEAT_MS);

  if (!process.env.REDIS_URL || !dbConfigured()) {
    log("الطابور مطفي: REDIS_URL أو DATABASE_URL مش مضبوط");
    return;
  }
  const connection = redisConnection();
  const queue = makeQueue(connection);
  const settings = Object.fromEntries(
    (await listSettings(getDb())).filter((s) => s.key.startsWith("schedule.")).map((s) => [s.key, String((s.value as { raw?: string }).raw ?? "")]),
  );
  const scheduled = await registerSchedulers(queue, settings);
  log(`الجدولة جاهزة: ${scheduled.length} مهمة (${scheduled[0]?.tz})`);
  startWorker(connection, HANDLERS, (job, err) => {
    log(`فشلت المهمة ${job?.name}: ${err.message}`);
    alertJobFailure(job?.name, err);
  });
  log("الطابور شغّال");
}

main().catch((e) => {
  console.error("[worker] خطأ:", e);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log("إيقاف");
    process.exit(0);
  });
}
