import Link from "next/link";
import { can } from "@/core/permissions";
import { BATCH_CATEGORY_LABELS, isBatchCategory } from "@/core/quality";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { listBatches } from "@/compliance/quality";
import { BatchForm, BatchRowActions } from "./form";

export const dynamic = "force-dynamic";

const STATUS_AR = { pending: "معلّقة", released: "مفروجة", blocked: "موقوفة" } as const;
const yn = (v: boolean | null) => (v === null ? "—" : v ? "نعم" : "لا");

export default async function BatchesPage() {
  const user = await requireUser("quality.view");
  const manage = can(user.role, "quality.manage");
  if (!dbConfigured()) return <main className="shell"><h1>الدفعات</h1><p className="error" role="alert">القاعدة مش متصلة.</p></main>;
  const rows = await listBatches(getDb());
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>الدفعات والجودة</h1>
      <p className="muted">دفعة بلا شهادة تحليل ما بتنفرج. أول دفعة من أي مورّد ولفئات خطر الغش لازم فحص مخبري مستقل. منتجات العين لازم معقّمة. الكحل لازم تحليل معادن ثقيلة.</p>
      {manage && <BatchForm />}
      <p data-testid="count">العدد: {rows.length}</p>
      <table>
        <thead><tr><th>المنتج</th><th>الدفعة</th><th>الكمية</th><th>الفئة</th><th>شهادة التحليل</th><th>فحص مستقل</th><th>معقّمة</th><th>معادن ثقيلة</th><th>الانتهاء</th><th>الحالة</th>{manage && <th></th>}</tr></thead>
        <tbody>
          {rows.map((b) => (
            <tr key={b.id} data-status={b.status}>
              <td dir="ltr">{b.productRef}</td>
              <td dir="ltr">{b.batchNo}</td>
              <td>{b.qty}</td>
              <td>{isBatchCategory(b.category) ? BATCH_CATEGORY_LABELS[b.category] : b.category}</td>
              <td>{b.coaKey ? "موجودة" : <strong className="error">ناقصة</strong>}</td>
              <td>{b.independentTestKey ? "موجود" : "—"}</td>
              <td>{yn(b.sterile)}</td>
              <td>{yn(b.heavyMetalsTested)}</td>
              <td dir="ltr">{b.expiresAt?.slice(0, 10) ?? "—"}</td>
              <td>{STATUS_AR[b.status]}{b.blockReason ? ` — ${b.blockReason}` : ""}</td>
              {manage && <td><BatchRowActions id={b.id} status={b.status} coaKey={b.coaKey} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
