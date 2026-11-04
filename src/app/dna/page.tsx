import { SCORED_TRAITS } from "@/core/dna";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { currentModel, listReferences, listWeightSets } from "@/lib/dna";
import { DnaTools, ReferenceActions } from "./tools";

export const dynamic = "force-dynamic";

const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

export default async function DnaPage() {
  const user = await requireUser("dashboard.view");
  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>الحمض</h1>
        <p className="error" role="alert">القاعدة مش متصلة.</p>
      </main>
    );
  }
  const db = getDb();
  const { model, version } = await currentModel(db);
  const refs = await listReferences(db);
  const versions = await listWeightSets(db, 10);
  const canApprove = can(user.role, "settings.manage");
  const traitDefs = SCORED_TRAITS.map((t) => ({ id: t.id, label: t.label, values: [...t.values] }));

  return (
    <main className="shell wide">
      <h1>الحمض</h1>
      <p className="muted">الحمض بيوصي وما بيقرر. كل وزن بحجم عيّنته، وأي قيمة بأقل من 3 منتجات معلّمة «عيّنة صغيرة».{" "}
        {version ? `النسخة الفعّالة: ${version} (من ${model.products} منتج مختبر).` : "لسا ما تعلّم من أي منتج: الأوزان الافتراضية بتحكم."}
      </p>

      <h2>الأوزان</h2>
      <table>
        <thead><tr><th>الصفة</th><th>الافتراضي</th><th>المتعلَّم</th><th>الثقة</th><th>النهائي</th><th>المنتجات المعروفة</th><th>القيم (النسبة · المنتجات)</th></tr></thead>
        <tbody>
          {Object.values(model.traits).map((t) => (
            <tr key={t.id} data-trait={t.id}>
              <td>{t.label}</td>
              <td dir="ltr">{t.defaultWeight.toFixed(3)}</td>
              <td dir="ltr">{t.learnedWeight.toFixed(3)}</td>
              <td>{pct(t.confidence)}</td>
              <td dir="ltr"><strong>{t.finalWeight.toFixed(3)}</strong></td>
              <td>{t.known}</td>
              <td>
                {t.values.map((v) => (
                  <span key={v.value} style={{ marginInlineEnd: "0.75rem" }}>
                    {v.value}: {pct(v.rate)} · {v.count}{v.small ? <em className="error"> عيّنة صغيرة</em> : null}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>نسخ الأوزان</h2>
      {versions.length === 0 ? <p className="muted">ما في نسخ لسا. بتنعمل كل سبت 23:00 أو بزر «تعلّم الآن».</p> : (
        <ul>{versions.map((v) => <li key={v.version}>نسخة {v.version} — <span dir="ltr">{v.learnedAt.slice(0, 16).replace("T", " ")}</span> — {v.productsCount} منتج</li>)}</ul>
      )}

      <h2>المرجعيات</h2>
      <table>
        <thead><tr><th>المرجع</th><th>المصدر</th><th>الحالة</th><th></th></tr></thead>
        <tbody>
          {refs.map((r) => (
            <tr key={r.id} data-ref={r.name}>
              <td>{r.name}</td>
              <td>{r.origin === "oms" ? "من الـ OMS" : r.origin === "manual" ? "يدوي" : "مقترح"}</td>
              <td>{r.state === "approved" ? "مرجع معتمد" : "بانتظار الاعتماد"}</td>
              <td>{canApprove && r.state === "pending" && <ReferenceActions id={r.id} />}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <DnaTools traits={traitDefs} canLearn={canApprove} canAdd={can(user.role, "capture.create")} />
    </main>
  );
}
