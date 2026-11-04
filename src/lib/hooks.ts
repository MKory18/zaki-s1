// نقاط ربط التخزين الدائم. المخازن بالذاكرة بتنادي هاي الدوال بعد كل كتابة، وطبقة التخزين (persist.ts) بتركّبها.
// هيك الذاكرة ما بتعرف شي عن القاعدة، والاختبارات بلا قاعدة بتضل سريعة.
import type { AlertEntry } from "@/lib/alerts";
import type { AuditEntry } from "@/lib/audit";
import type { UserRecord } from "@/lib/users";

export interface Sinks {
  audit?: (e: AuditEntry) => void;
  alert?: (a: AlertEntry) => void;
  /** إشعار خارجي (تيليجرام) بعد التخزين، بلا انتظار. */
  notify?: (a: AlertEntry) => void;
  user?: (u: UserRecord) => void;
}

const g = globalThis as unknown as { __s1Sinks?: Sinks };
export const sinks: Sinks = (g.__s1Sinks ??= {});
