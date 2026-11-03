// نقطة الصحة: بتجاوب إذا التطبيق نفسه شغّال. فحص القاعدة والطابور بينضاف مع وحداتهم.
export function healthPayload(now: Date = new Date()) {
  return { status: "ok" as const, service: "zaki-s1", time: now.toISOString() };
}
