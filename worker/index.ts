// نقطة دخول العامل (الطابور والجدولة). بالـ B00 بس بيشتغل وبيعلن إنه حي.
// BullMQ والمهام المجدولة بتنضاف بمهمة B05.
const HEARTBEAT_MS = 60_000;

function log(msg: string) {
  console.log(`[worker ${new Date().toISOString()}] ${msg}`);
}

log("العامل جاهز");
setInterval(() => log("حي"), HEARTBEAT_MS);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    log("إيقاف");
    process.exit(0);
  });
}
