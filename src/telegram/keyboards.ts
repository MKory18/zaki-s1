// أزرار تيليجرام. القاعدة: «افتح» دايماً، «راقب» و«ارفض» على المرشحين بس، وما في زر مالي أبداً.
// callback_data: w:<id> مراقبة · r:<id> اختيار سبب الرفض · x:<id>:<رمز السبب> تأكيد الرفض (حد تيليجرام 64 بايت).
import type { Keyboard } from "./client";

export const CALLBACK = {
  watch: (id: string) => `w:${id}`,
  rejectMenu: (id: string) => `r:${id}`,
  rejectDo: (id: string, code: string) => `x:${id}:${code}`,
} as const;

export type ParsedCallback = { kind: "watch"; id: string } | { kind: "reject_menu"; id: string } | { kind: "reject_do"; id: string; code: string } | { kind: "unknown" };

export function parseCallback(data: string | undefined): ParsedCallback {
  const m = /^(w|r|x):([A-Za-z0-9]{8,40})(?::(R\d{2}))?$/.exec(data ?? "");
  if (!m) return { kind: "unknown" };
  if (m[1] === "w") return { kind: "watch", id: m[2] };
  if (m[1] === "r") return { kind: "reject_menu", id: m[2] };
  return m[3] ? { kind: "reject_do", id: m[2], code: m[3] } : { kind: "unknown" };
}

export function morningKeyboard(items: { id: string; link: string }[], reportUrl: string): Keyboard {
  const rows: Keyboard = items.map((it, i) => [
    { text: `افتح ${i + 1}`, url: it.link },
    { text: `راقب ${i + 1}`, callback_data: CALLBACK.watch(it.id) },
    { text: `ارفض ${i + 1}`, callback_data: CALLBACK.rejectMenu(it.id) },
  ]);
  rows.push([{ text: "افتح التقرير", url: reportUrl }]);
  return rows;
}

// أسباب الرفض: ثنتين بالصف. R12 (سبب تاني) بدها نص فبتنفتح من الموقع.
export function reasonKeyboard(id: string, reasons: { code: string; label: string }[]): Keyboard {
  const usable = reasons.filter((r) => r.code !== "R12");
  const rows: Keyboard = [];
  for (let i = 0; i < usable.length; i += 2) rows.push(usable.slice(i, i + 2).map((r) => ({ text: r.label, callback_data: CALLBACK.rejectDo(id, r.code) })));
  return rows;
}

export const openButton = (text: string, url: string): Keyboard => [[{ text, url }]];
