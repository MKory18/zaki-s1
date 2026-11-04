// تحويل أوقات الإعدادات المكتوبة بالعربي ("05:30" · "السبت 23:00" · "يوم 1 الساعة 10:00") لتعبير cron.
// التوقيت نفسه (Asia/Amman) بينعطى للجدولة بشكل منفصل من الإعداد schedule.tz.
const DAYS: Record<string, number> = { الأحد: 0, الاثنين: 1, الإثنين: 1, الثلاثاء: 2, الأربعاء: 3, الخميس: 4, الجمعة: 5, السبت: 6 };

export function timeToCron(raw: string, offsetMinutes = 0): string | null {
  const t = raw.trim();
  const hm = (h: string, m: string) => {
    const total = (((parseInt(h, 10) * 60 + parseInt(m, 10) + offsetMinutes) % 1440) + 1440) % 1440;
    return { h: Math.floor(total / 60), m: total % 60 };
  };
  const validHM = (h: string, m: string) => parseInt(h, 10) <= 23 && parseInt(m, 10) <= 59;

  let x = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (x && validHM(x[1], x[2])) {
    const { h, m } = hm(x[1], x[2]);
    return `${m} ${h} * * *`;
  }
  x = /^(\S+)\s+(\d{1,2}):(\d{2})$/.exec(t);
  if (x && x[1] in DAYS && validHM(x[2], x[3])) {
    const { h, m } = hm(x[2], x[3]);
    return `${m} ${h} * * ${DAYS[x[1]]}`;
  }
  x = /^يوم\s+(\d{1,2})\s+الساعة\s+(\d{1,2}):(\d{2})$/.exec(t);
  if (x && parseInt(x[1], 10) >= 1 && parseInt(x[1], 10) <= 31 && validHM(x[2], x[3])) {
    const { h, m } = hm(x[2], x[3]);
    return `${m} ${h} ${parseInt(x[1], 10)} * *`;
  }
  return null;
}
