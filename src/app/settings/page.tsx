import Link from "next/link";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { SETTING_TABS, listSettings, tabOf } from "@/lib/settings";
import { SettingRow } from "./setting-row";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  await requireUser("settings.manage");
  const { tab } = await searchParams;
  const active = SETTING_TABS.find((t) => t.id === tab) ?? SETTING_TABS[0];

  if (!dbConfigured()) {
    return (
      <main className="shell">
        <h1>الإعدادات</h1>
        <p className="error" role="alert">القاعدة مش متصلة، فالإعدادات مش متاحة.</p>
      </main>
    );
  }

  const rows = (await listSettings(getDb())).filter((r) => tabOf(r.key) === active.id);
  return (
    <main className="shell wide">
      <h1>الإعدادات</h1>
      <p className="muted">كل تعديل بينحفظ بنسخة وتاريخ ومين عدّل، وبتقدر ترجع لأي نسخة.</p>
      <nav className="row tabs" aria-label="تبويبات الإعدادات">
        {SETTING_TABS.map((t) => (
          <Link key={t.id} href={`/settings?tab=${t.id}`} aria-current={t.id === active.id ? "page" : undefined} className={t.id === active.id ? "tab on" : "tab"}>
            {t.label}
          </Link>
        ))}
      </nav>
      <table>
        <thead><tr><th>الإعداد</th><th>القيمة</th><th></th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const v = r.value as { label?: string };
            return <SettingRow key={r.key} settingKey={r.key} label={v?.label ?? r.key} value={r.value} version={r.version} />;
          })}
        </tbody>
      </table>
    </main>
  );
}
