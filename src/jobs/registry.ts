// المهام المجدولة (docs/02-plan.md الجزء الثامن). الأوقات من الإعدادات (schedule.*) إلا الثابت منها.
// handler "pending" = الوحدة لسا ما انبنت، بتتسجّل «متخطّاة» بلا فشل.
import { timeToCron } from "./schedule";

export interface JobDef {
  name: string;
  description: string;
  /** مفتاح الإعداد اللي فيه وقت التشغيل */
  settingKey?: string;
  offsetMinutes?: number;
  /** وقت ثابت بصيغة الإعدادات، أو cron جاهز */
  fixed?: string;
  cron?: string;
  /** مهمة أحداث (بتنضاف للطابور مباشرة، بلا جدول) */
  event?: boolean;
  onFail: string;
  attempts: number;
  backoffMs: number;
}

const HOUR = 3_600_000;

export const JOBS: readonly JobDef[] = [
  { name: "pull.aliexpress", description: "سحب المنتجات الرائجة والبحث بكلمات الخريطة", settingKey: "schedule.nightly_pull", onFail: "تنبيه «مصدر فشل» + إعادة بعد ساعة", attempts: 2, backoffMs: HOUR },
  { name: "pull.meta_eu", description: "سحب إعلانات أوروبا بكلمات البحث", settingKey: "schedule.nightly_pull", offsetMinutes: 30, onFail: "نفس الشي", attempts: 2, backoffMs: HOUR },
  { name: "pull.google_trends", description: "الواجهة الرسمية إذا متاحة", settingKey: "schedule.nightly_pull", offsetMinutes: 60, onFail: "تذكير بالاستيراد اليدوي", attempts: 1, backoffMs: HOUR },
  { name: "capture.process", description: "استخراج لقطة الإضافة", event: true, onFail: "اللقطة بتنعلّم «فشل استخراج»", attempts: 1, backoffMs: 0 },
  { name: "import.process", description: "قراءة ملف الاستيراد بربط الأعمدة", event: true, onFail: "تقرير بالصفوف الفاشلة", attempts: 1, backoffMs: 0 },
  { name: "normalize", description: "الموحّد والمترجم (H01)", settingKey: "schedule.dedupe", onFail: "المرشح بيضل بعنوانه الأصلي", attempts: 1, backoffMs: 0 },
  { name: "dedupe", description: "الدمج + حَكَم المكرر (H02) للرمادي", settingKey: "schedule.dedupe", onFail: "الرمادي بيضل منفصل", attempts: 1, backoffMs: 0 },
  { name: "compute.scores", description: "المؤشر · الحمض · الاقتصاد · قواعد الرفض", settingKey: "schedule.compute", onFail: "تنبيه + ولا تقرير بأرقام ناقصة", attempts: 1, backoffMs: 0 },
  { name: "watch.reeval", description: "إعادة حساب المراقبين", settingKey: "schedule.compute", offsetMinutes: 15, onFail: "—", attempts: 1, backoffMs: 0 },
  { name: "agent.scanner", description: "الماسح على الجديد", settingKey: "schedule.scanner", onFail: "الوكيل بيوقف عند سقفه", attempts: 1, backoffMs: 0 },
  { name: "agent.verifier", description: "المحقق على أعلى 30", settingKey: "schedule.verifier", onFail: "نفس الشي", attempts: 1, backoffMs: 0 },
  { name: "screen.batch", description: "الحمض والاقتصاد والجاهزية والامتثال المبدئي على أعلى 15", settingKey: "schedule.screen", onFail: "نفس الشي", attempts: 1, backoffMs: 0 },
  { name: "cards.assemble", description: "البطاقات وقواعد القرار وعلامات التعارض", settingKey: "schedule.cards", onFail: "—", attempts: 1, backoffMs: 0 },
  { name: "report.morning", description: "التقرير الصباحي", settingKey: "schedule.morning_report", onFail: "إعادة بعد 15 دقيقة، وبعدها تنبيه", attempts: 2, backoffMs: 15 * 60_000 },
  { name: "license.alerts", description: "التراخيص القريبة من الانتهاء", fixed: "08:00", onFail: "—", attempts: 1, backoffMs: 0 },
  { name: "dna.learn", description: "سحب أداء الـ OMS وتعلّم الأوزان (A05)", settingKey: "schedule.dna_learning", onFail: "النسخة القديمة بتضل فعّالة", attempts: 1, backoffMs: 0 },
  { name: "report.weekly", description: "التقرير الأسبوعي", settingKey: "schedule.weekly_report", onFail: "إعادة", attempts: 2, backoffMs: 15 * 60_000 },
  { name: "report.monthly", description: "التقرير الشهري", settingKey: "schedule.monthly_report", onFail: "إعادة", attempts: 2, backoffMs: 15 * 60_000 },
  { name: "policy.staleness", description: "قواعد الإعلانات اللي ما انراجعت من 90 يوم", fixed: "الأحد 09:00", onFail: "تنبيه", attempts: 1, backoffMs: 0 },
  { name: "trend.metrics.pull", description: "سحب المقاييس إذا ما وصلت بالأحداث", cron: "0 * * * *", onFail: "—", attempts: 1, backoffMs: 0 },
  { name: "outbound.retry", description: "إعادة الطلبات الصادرة الفاشلة", cron: "*/5 * * * *", onFail: "بعد 5 محاولات: «ميت» + تنبيه", attempts: 1, backoffMs: 0 },
  { name: "budget.reset", description: "تصفير عدادات الميزانية اليومية", fixed: "00:00", onFail: "—", attempts: 1, backoffMs: 0 },
  { name: "backup.db", description: "نسخة قاعدة البيانات والملفات", fixed: "03:00", onFail: "تنبيه فوري", attempts: 1, backoffMs: 0 },
];

export const JOB_NAMES = JOBS.map((j) => j.name);

// بيحسب cron المهمة من إعدادات الجدولة الحالية (raw). ما بيحسب شي لمهام الأحداث.
export function resolveCron(job: JobDef, settings: Record<string, string>): string | null {
  if (job.event) return null;
  if (job.cron) return job.cron;
  const raw = job.fixed ?? (job.settingKey ? settings[job.settingKey] : undefined);
  if (!raw) return null;
  return timeToCron(raw, job.offsetMinutes ?? 0);
}

export function scheduleTz(settings: Record<string, string>): string {
  return settings["schedule.tz"] || "Asia/Amman";
}
