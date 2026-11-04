import Link from "next/link";
import { can } from "@/core/permissions";
import { LICENSE_STATUS_LABELS, isLicenseStatus } from "@/core/quality";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { listLicenses } from "@/compliance/quality";
import { LicenseForm, LicenseRowActions } from "./form";

export const dynamic = "force-dynamic";

export default async function LicensesPage() {
  const user = await requireUser("quality.view");
  const manage = can(user.role, "quality.manage");
  if (!dbConfigured()) return <main className="shell"><h1>التراخيص</h1><p className="error" role="alert">القاعدة مش متصلة.</p></main>;
  const rows = await listLicenses(getDb());
  return (
    <main className="shell wide">
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>التراخيص</h1>
      <p className="muted">النظام بينبّهك قبل الانتهاء بـ 60 يوم (أو المدة اللي بتحددها للترخيص)، وبيبلّغ الأزمات.</p>
      {manage && <LicenseForm />}
      <p data-testid="count">العدد: {rows.length}</p>
      <table>
        <thead><tr><th>المنتج</th><th>البلد</th><th>الجهة</th><th>النوع</th><th>رقم التسجيل</th><th>الانتهاء</th><th>الباقي</th><th>الحالة</th>{manage && <th></th>}</tr></thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.id} data-alert={l.alert ?? ""}>
              <td dir="ltr">{l.productRef}</td>
              <td dir="ltr">{l.country}</td>
              <td>{l.authority}</td>
              <td>{l.type}</td>
              <td dir="ltr">{l.regNo ?? "—"}</td>
              <td dir="ltr">{l.expiresAt?.slice(0, 10) ?? "—"}</td>
              <td>{l.daysLeft === null ? "—" : l.daysLeft < 0 ? <strong className="error">منتهي من {-l.daysLeft} يوم</strong> : l.alert ? <strong className="error">{l.daysLeft} يوم</strong> : `${l.daysLeft} يوم`}</td>
              <td>{isLicenseStatus(l.status) ? LICENSE_STATUS_LABELS[l.status] : l.status}</td>
              {manage && <td><LicenseRowActions id={l.id} status={l.status} /></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
