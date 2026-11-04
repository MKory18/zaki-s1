import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "problems", label: "خريطة المشاكل" },
  { id: "texts", label: "النصوص والتراث" },
  { id: "ingredients", label: "المكونات" },
  { id: "banned", label: "المحظورات" },
  { id: "claims", label: "الادعاءات" },
  { id: "adrules", label: "قواعد الإعلانات" },
  { id: "reasons", label: "أسباب الرفض" },
  { id: "references", label: "المرجعيات والعلامات" },
] as const;

const dateOf = (d: Date) => d.toISOString().slice(0, 10);

export default async function LibrariesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser("settings.manage");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];

  let body: React.ReactNode;
  if (!dbConfigured()) {
    body = <p className="error" role="alert">القاعدة مش متصلة، فالمكتبات مش متاحة.</p>;
  } else {
    const db = getDb();
    if (active.id === "problems") {
      const rows = await db.problem.findMany({ orderBy: { nameAr: "asc" } });
      body = (
        <Table head={["المشكلة", "عربي", "English", "中文"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.nameAr}</td><td>{r.keywordsAr.join(" · ")}</td><td dir="ltr">{r.keywordsEn.join(" · ")}</td><td>{r.keywordsZh.join(" · ")}</td></tr>
          ))}
        </Table>
      );
    } else if (active.id === "texts") {
      const rows = await db.referenceText.findMany({ where: { deletedAt: null }, orderBy: { code: "asc" } });
      body = (
        <Table head={["الرمز", "النوع", "المكوّن", "النص", "المصدر", "الحالة"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td dir="ltr">{r.code}</td><td>{r.kind}</td><td>{r.ingredient}</td><td>{r.text}</td><td>{r.source}</td><td>{r.reviewStatus}</td></tr>
          ))}
        </Table>
      );
    } else if (active.id === "ingredients" || active.id === "banned") {
      const rows = await db.ingredient.findMany({
        where: { deletedAt: null, status: active.id === "ingredients" ? "allowed" : { in: ["banned", "restricted"] } },
        orderBy: { nameAr: "asc" },
      });
      body = (
        <Table head={["المكوّن", "English", "الحالة", "ملاحظة", "وين بيكتر الغش"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.nameAr}</td><td dir="ltr">{r.nameEn}</td><td>{r.status}</td><td>{r.note}</td><td>{r.adulterationRisk}</td></tr>
          ))}
        </Table>
      );
    } else if (active.id === "claims") {
      const rows = await db.claimRule.findMany({ where: { deletedAt: null }, orderBy: { createdAt: "asc" } });
      body = (
        <Table head={["الممنوع", "ليش", "البديل المسموح"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.phrase}</td><td>{r.reason}</td><td>{r.alternative}</td></tr>
          ))}
        </Table>
      );
    } else if (active.id === "adrules") {
      const rows = await db.adPolicyRule.findMany({ orderBy: { createdAt: "asc" } });
      body = (
        <Table head={["القاعدة", "غلط", "صح", "آخر مراجعة"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td>{r.rule}</td><td>{r.wrongExample}</td><td>{r.rightExample}</td><td dir="ltr">{dateOf(r.lastReviewedAt)}</td></tr>
          ))}
        </Table>
      );
    } else if (active.id === "reasons") {
      const rows = await db.rejectReason.findMany({ orderBy: { code: "asc" } });
      body = (
        <Table head={["الرمز", "السبب"]} count={rows.length}>
          {rows.map((r) => (
            <tr key={r.id}><td dir="ltr">{r.code}</td><td>{r.labelAr}</td></tr>
          ))}
        </Table>
      );
    } else {
      const refs = await db.dnaReference.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
      const brands = await db.brandRegistry.findMany({ orderBy: { name: "asc" } });
      body = (
        <>
          <h2>مرجعيات الحمض</h2>
          <Table head={["المرجع", "الأداء"]} count={refs.length}>
            {refs.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td>{JSON.stringify(r.performanceJson)}</td></tr>
            ))}
          </Table>
          <h2>علاماتك القائمة</h2>
          <Table head={["العلامة", "استخدامها بالنظام"]} count={brands.length}>
            {brands.map((r) => (
              <tr key={r.id}><td>{r.name}</td><td>{r.notes}</td></tr>
            ))}
          </Table>
        </>
      );
    }
  }

  return (
    <main className="shell wide">
      <h1>المكتبات</h1>
      <p className="muted">للقراءة هلأ. التعديل بيجي مع وحدة كل مكتبة.</p>
      <nav className="row tabs" aria-label="تبويبات المكتبات">
        {TABS.map((t) => (
          <Link key={t.id} href={`/libraries?tab=${t.id}`} aria-current={t.id === active.id ? "page" : undefined} className={t.id === active.id ? "tab on" : "tab"}>
            {t.label}
          </Link>
        ))}
      </nav>
      {body}
    </main>
  );
}

function Table({ head, count, children }: { head: string[]; count: number; children: React.ReactNode }) {
  return (
    <>
      <p data-testid="count">العدد: {count}</p>
      <table>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </>
  );
}
