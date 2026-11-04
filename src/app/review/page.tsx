import Link from "next/link";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { inbox } from "@/compliance/service";
import { ChecksBox, TextsBox } from "./boxes";

export const dynamic = "force-dynamic";

// صناديق المراجعين: المراجع الشرعي بيشوف النصوص بس، ومراجع الامتثال الفحوصات بس، والمالك الاثنين.
export default async function ReviewPage() {
  const user = await requireUser();
  const seesTexts = can(user.role, "texts.view");
  const seesChecks = can(user.role, "claims.approve");
  if (!seesTexts && !seesChecks) return <main className="shell"><p>ما في صناديق مراجعة لدورك.</p><Link href="/">← الرئيسية</Link></main>;
  if (!dbConfigured()) return <main className="shell"><h1>المراجعة</h1><p className="error" role="alert">القاعدة مش متصلة.</p></main>;
  const db = getDb();
  const texts = seesTexts ? await inbox(db, "texts") : [];
  const checks = seesChecks ? await inbox(db, "claims") : [];
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>المراجعة</h1>
      {seesTexts && (
        <section>
          <h2>النصوص بانتظار المراجع الشرعي ({texts.length})</h2>
          <p className="muted">ولا نص بيدخل أي محتوى قبل اعتمادك. النص المختلف فيه (مثل ماء زمزم) بيحتاج أساس قرارك مكتوب.</p>
          <TextsBox items={texts as never} />
        </section>
      )}
      {seesChecks && (
        <section>
          <h2>فحوصات الامتثال بانتظار قرارك ({checks.length})</h2>
          <p className="muted">اللي انرفض بالكود ما بيظهر هون: لازم تصحيح المدخلات وإعادة الفحص من بطاقة المنتج. ما بتقدر تعتمد فحص فيه نص ما اعتمده المراجع الشرعي.</p>
          <ChecksBox items={checks as never} />
        </section>
      )}
    </main>
  );
}
