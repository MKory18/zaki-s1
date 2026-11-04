import { loadCoreConfig } from "@/core/config";
import { requireUser } from "@/lib/current-user";
import { dbConfigured, getDb } from "@/lib/db";
import { Calculator } from "./calculator";

export const dynamic = "force-dynamic";

export default async function CalcPage() {
  await requireUser("dashboard.view");
  const cfg = dbConfigured() ? await loadCoreConfig(getDb()) : null;
  return (
    <main className="shell wide">
      <h1>الحاسبة</h1>
      <p className="muted">كل الأرقام بتنحسب بالكود، وكل رقم بيفتح قاعدته بأرقامك. القيم الافتراضية من إعدادات السوق{cfg ? ` (قواعد ${cfg.rulesVersion})` : ""}.</p>
      <Calculator
        defaults={{
          fx: cfg?.market.fxJodUsd ?? 1.41,
          margin: cfg?.market.safetyMargin ?? 0.3,
          returnRate: cfg?.market.defaultReturn ?? null,
          deliveryFee: cfg?.market.deliveryFee ?? null,
          returnFee: cfg?.market.returnFee ?? 0,
        }}
      />
    </main>
  );
}
