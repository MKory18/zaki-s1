// تشغيل: npm run db:seed (آمن للتكرار). العامل بيشغّله بعد الترحيل.
import { getDb } from "../src/lib/db";
import { formatReport, importSeeds } from "../src/seeds/import";

const db = getDb();
importSeeds(db)
  .then((r) => console.log("البذور:\n" + formatReport(r)))
  .catch((e) => {
    console.error("فشل استيراد البذور:", e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
