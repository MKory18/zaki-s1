import Link from "next/link";
import { can } from "@/core/permissions";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { listLibrary } from "@/compliance/library";
import { LibraryEditor, type Col } from "./editor";

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

const TEXT_COLS: Col[] = [
  { key: "code", label: "الرمز", ltr: true },
  { key: "kind", label: "النوع", type: "select", options: [{ value: "hadith", label: "حديث" }, { value: "quran", label: "قرآن" }, { value: "heritage", label: "تراث" }] },
  { key: "ingredient", label: "المكوّن" },
  { key: "text", label: "النص" },
  { key: "source", label: "المصدر" },
  { key: "number", label: "الرقم" },
  { key: "grading", label: "الدرجة" },
  { key: "reviewStatus", label: "الحالة", type: "readonly", options: [{ value: "pending", label: "بانتظار المراجع" }, { value: "approved", label: "معتمد" }, { value: "rejected", label: "مرفوض" }, { value: "needs_specialist", label: "يوقف لقرار مختص" }] },
];
const ING_STATUS = [{ value: "allowed", label: "سليم" }, { value: "restricted", label: "مقيّد" }, { value: "banned", label: "محظور" }];
const ING_COLS: Col[] = [
  { key: "nameAr", label: "المكوّن" },
  { key: "nameEn", label: "English", ltr: true },
  { key: "status", label: "الحالة", type: "select", options: ING_STATUS },
  { key: "note", label: "ملاحظة" },
  { key: "adulterationRisk", label: "وين بيكتر الغش" },
];
const CLAIM_COLS: Col[] = [
  { key: "phrase", label: "الممنوع" },
  { key: "reason", label: "ليش" },
  { key: "alternative", label: "البديل المسموح" },
  { key: "appliesTo", label: "ينطبق على", type: "select", options: [{ value: "all", label: "الكل" }, { value: "cosmetic", label: "تجميلي" }, { value: "therapeutic", label: "علاجي" }] },
  { key: "country", label: "البلد", ltr: true },
];
const RULE_COLS: Col[] = [
  { key: "platform", label: "المنصة" },
  { key: "rule", label: "القاعدة" },
  { key: "wrongExample", label: "غلط" },
  { key: "rightExample", label: "صح" },
  { key: "lastReviewedAt", label: "آخر مراجعة", type: "readonly", ltr: true },
];

export default async function LibrariesPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser("dashboard.view");
  const { tab } = await searchParams;
  const active = TABS.find((t) => t.id === tab) ?? TABS[0];
  const canClaims = can(user.role, "claims.approve");

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
      if (!can(user.role, "texts.view")) {
        body = <p className="muted">النصوص المرجعية بيشوفها المالك والمراجع الشرعي بس.</p>;
      } else {
        const rows = await listLibrary(db, "references");
        body = (
          <>
            <p data-testid="count">العدد: {rows.length}</p>
            <p className="muted">الاعتماد من صفحة <Link href="/review">المراجعة</Link>. تعديل نص معتمد بيلغي اعتماده.</p>
            <LibraryEditor api="/api/compliance/references" cols={TEXT_COLS} rows={rows as never} canEdit={can(user.role, "settings.manage")} />
          </>
        );
      }
    } else if (active.id === "ingredients" || active.id === "banned") {
      const all = await listLibrary(db, "ingredients");
      const rows = all.filter((r) => (active.id === "ingredients" ? r.status === "allowed" : r.status !== "allowed"));
      body = (
        <>
          <p data-testid="count">العدد: {rows.length}</p>
          <LibraryEditor api="/api/compliance/ingredients" cols={ING_COLS} rows={rows as never} canEdit={canClaims} />
        </>
      );
    } else if (active.id === "claims") {
      const rows = await listLibrary(db, "claims");
      body = (
        <>
          <p data-testid="count">العدد: {rows.length}</p>
          <p className="muted">العبارات بتنفصل بـ «·». البوابة بترفض الادعاء وبتعرض البديل، وما بتصحح بصمت.</p>
          <LibraryEditor api="/api/compliance/claims" cols={CLAIM_COLS} rows={rows as never} canEdit={canClaims} />
        </>
      );
    } else if (active.id === "adrules") {
      const rows = await listLibrary(db, "ad-rules");
      body = (
        <>
          <p data-testid="count">العدد: {rows.length}</p>
          <p className="muted">سياسات المنصات بتتغيّر: القاعدة اللي ما انراجعت من 90 يوم بينبّهك عليها النظام. بعد ما تراجع السياسة اضغط «راجعتها اليوم».</p>
          <LibraryEditor api="/api/compliance/ad-rules" cols={RULE_COLS} rows={rows as never} canEdit={canClaims} reviewButton />
        </>
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
      <p><Link href="/">← الرئيسية</Link></p>
      <h1>المكتبات</h1>
      <p className="muted">{canClaims ? "مكتبات الامتثال بتتعدّل من هون (كل تعديل بينقل قواعد المنتج للأنظمة التانية)." : "للقراءة."}</p>
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
