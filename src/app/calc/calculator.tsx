"use client";
import { useState } from "react";

interface Line {
  key: string;
  label: string;
  value: string;
  rule: string;
}
interface Scenario {
  key: string;
  label: string;
  returnRate: string;
  spendPerShipment: string;
  deliveredProfit: string;
  loss: boolean;
  rule: string;
}
interface Defaults {
  fx: number;
  margin: number;
  returnRate: number | null;
  deliveryFee: number | null;
  returnFee: number;
}

const field = (v: string, set: (s: string) => void, label: string, hint?: string) => (
  <label className="field">
    {label}
    <input value={v} onChange={(e) => set(e.target.value)} inputMode="decimal" dir="ltr" aria-label={label} title={hint} />
  </label>
);

function Lines({ lines }: { lines: Line[] }) {
  return (
    <table>
      <tbody>
        {lines.map((l) => (
          <tr key={l.key} data-line={l.key}>
            <td>{l.label}</td>
            <td dir="ltr"><strong>{l.value}</strong></td>
            <td><details><summary>القاعدة</summary><span dir="auto">{l.rule}</span></details></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

async function post(path: string, data: unknown) {
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  const json = await res.json().catch(() => null);
  return { ok: res.ok, json };
}

export function Calculator({ defaults }: { defaults: Defaults }) {
  const [tab, setTab] = useState<"before" | "after" | "velocity">("before");

  // قبل الاختبار
  const [cost, setCost] = useState("1.56");
  const [fx, setFx] = useState(String(defaults.fx));
  const [ship, setShip] = useState("0");
  const [o1, setO1] = useState({ price: "20", share: "1" });
  const [o2, setO2] = useState({ price: "", share: "0" });
  const [o3, setO3] = useState({ price: "", share: "0" });
  const [delivery, setDelivery] = useState(defaults.deliveryFee === null ? "" : String(defaults.deliveryFee));
  const [retFee, setRetFee] = useState(String(defaults.returnFee));
  const [ret, setRet] = useState(defaults.returnRate === null ? "25" : String(defaults.returnRate * 100));
  const [margin, setMargin] = useState(String(defaults.margin * 100));
  const [pre, setPre] = useState<{ lines: Line[]; scenarios: Scenario[] } | null>(null);

  // بعد الاختبار
  const [a, setA] = useState({ adSpend: "350", orders: "", confirmed: "60", shipped: "58", delivered: "43", returned: "15", collected: "860", deliveryFees: "145", returnFees: "0", cogsDelivered: "94.6" });
  const [post1, setPost1] = useState<{ lines: Line[]; success: boolean } | null>(null);

  // المؤشر
  const [v, setV] = useState({ age: "12", ramp7: "24", rampPrev: "10", intent: "13", sample: "120", engagement: "6", sellers: "4", yellow: "35", advertisers: "1", sales: "30000", creators: "" });
  const [lane, setLane] = useState("china_early");
  const [vel, setVel] = useState<{ score: number | null; insufficient: boolean; rule: string; warnings: string[]; signals: { key: string; label: string; raw: string; score: number | null; weight: number; measured: boolean }[]; rejects: string[] } | null>(null);
  const [err, setErr] = useState("");

  const n = (s: string) => (s.trim() === "" ? null : Number(s));

  async function runBefore() {
    setErr("");
    const offers = [o1, o2, o3].map((o, i) => ({ qty: i + 1, price: o.price, share: Number(o.share) / 1 })).filter((o) => o.price !== "" && Number(o.share) > 0);
    const { ok, json } = await post("/api/calc/economics", {
      mode: "projection",
      input: { unitCostJod: cost, fxJodUsd: fx, shippingPerUnitUsd: ship, offers, deliveryFee: delivery, returnFee: retFee, returnRate: Number(ret) / 100, safetyMargin: Number(margin) / 100 },
    });
    if (!ok) return setErr(json?.error?.message ?? "صار خطأ"), setPre(null);
    setPre({ lines: json.result.lines, scenarios: json.result.scenarios });
  }

  async function runAfter() {
    setErr("");
    const { ok, json } = await post("/api/calc/economics", {
      mode: "actual",
      input: { adSpend: a.adSpend, orders: n(a.orders) ?? undefined, confirmed: Number(a.confirmed), shipped: Number(a.shipped), delivered: Number(a.delivered), returned: Number(a.returned), collected: a.collected, deliveryFees: a.deliveryFees, returnFees: a.returnFees, cogsDelivered: a.cogsDelivered },
    });
    if (!ok) return setErr(json?.error?.message ?? "صار خطأ"), setPost1(null);
    setPost1({ lines: json.result.lines, success: json.result.success });
  }

  async function runVelocity() {
    setErr("");
    const { ok, json } = await post("/api/calc/velocity", {
      lane,
      input: {
        trendAgeDays: n(v.age), newCreators7d: n(v.ramp7), newCreatorsPrev7d: n(v.rampPrev), intentComments: n(v.intent), commentSample: n(v.sample),
        engagementRate: n(v.engagement) === null ? null : Number(v.engagement) / 100, sellersCount: n(v.sellers),
        yellowCartShare: n(v.yellow) === null ? null : Number(v.yellow) / 100, advertisersInMarket: n(v.advertisers), cumulativeSales: n(v.sales),
      },
      reject: { creators: n(v.creators) ?? undefined },
    });
    if (!ok) return setErr(json?.error?.message ?? "صار خطأ"), setVel(null);
    setVel({ ...json.velocity, rejects: json.rejectHits.map((h: { message: string }) => h.message) });
  }

  return (
    <div>
      <nav className="row tabs" aria-label="الحاسبة">
        {([["before", "اقتصاد قبل الاختبار"], ["after", "اقتصاد بعد الاختبار (من الـ OMS)"], ["velocity", "مؤشر السرعة والرفض"]] as const).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "tab on" : "tab"} onClick={() => { setTab(id); setErr(""); }}>{label}</button>
        ))}
      </nav>
      {err && <p className="error" role="alert">{err}</p>}

      {tab === "before" && (
        <section>
          <div className="grid">
            {field(cost, setCost, "تكلفة الوحدة بالدينار")}
            {field(fx, setFx, "سعر صرف الدينار")}
            {field(ship, setShip, "شحن وتغليف للوحدة ($)")}
            {field(delivery, setDelivery, "أجرة التوصيل لكل شحنة ($)")}
            {field(retFee, setRetFee, "أجرة المرتجع ($)")}
            {field(ret, setRet, "المرتجع المتوقع (%)")}
            {field(margin, setMargin, "هامش الأمان (%)")}
          </div>
          <h3>العروض (سعر ونسبة من 0 لـ 1)</h3>
          <div className="grid">
            {field(o1.price, (s) => setO1({ ...o1, price: s }), "سعر عرض حبة وحدة")}
            {field(o1.share, (s) => setO1({ ...o1, share: s }), "نسبة عرض حبة وحدة")}
            {field(o2.price, (s) => setO2({ ...o2, price: s }), "سعر عرض حبتين")}
            {field(o2.share, (s) => setO2({ ...o2, share: s }), "نسبة عرض حبتين")}
            {field(o3.price, (s) => setO3({ ...o3, price: s }), "سعر عرض تلاتة")}
            {field(o3.share, (s) => setO3({ ...o3, share: s }), "نسبة عرض تلاتة")}
          </div>
          <p><button type="button" onClick={runBefore}>احسب</button></p>
          {pre && (
            <>
              <Lines lines={pre.lines} />
              <h3>السيناريوهات الثلاثة (ربح الطلب المُسلَّم)</h3>
              <table>
                <thead><tr><th>السيناريو</th><th>المرتجع</th><th>الصرف لكل شحنة</th><th>النتيجة</th><th></th></tr></thead>
                <tbody>
                  {pre.scenarios.map((s) => (
                    <tr key={s.key} data-scenario={s.key}>
                      <td>{s.label}</td><td dir="ltr">{s.returnRate}%</td><td dir="ltr">{s.spendPerShipment}$</td>
                      <td dir="ltr"><strong>{s.loss ? `خسارة ${s.deliveredProfit.replace("-", "")}$` : `${s.deliveredProfit}$`}</strong></td>
                      <td><details><summary>القاعدة</summary><span dir="auto">{s.rule}</span></details></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {tab === "after" && (
        <section>
          <div className="grid">
            {field(a.adSpend, (s) => setA({ ...a, adSpend: s }), "الصرف الإعلاني ($)")}
            {field(a.orders, (s) => setA({ ...a, orders: s }), "الطلبات (اختياري)")}
            {field(a.confirmed, (s) => setA({ ...a, confirmed: s }), "المؤكد")}
            {field(a.shipped, (s) => setA({ ...a, shipped: s }), "الشحنات")}
            {field(a.delivered, (s) => setA({ ...a, delivered: s }), "المُسلَّم")}
            {field(a.returned, (s) => setA({ ...a, returned: s }), "المرتجع")}
            {field(a.collected, (s) => setA({ ...a, collected: s }), "المحصّل ($)")}
            {field(a.deliveryFees, (s) => setA({ ...a, deliveryFees: s }), "أجور التوصيل ($)")}
            {field(a.returnFees, (s) => setA({ ...a, returnFees: s }), "أجور المرتجع ($)")}
            {field(a.cogsDelivered, (s) => setA({ ...a, cogsDelivered: s }), "تكلفة البضاعة المُسلَّمة ($)")}
          </div>
          <p><button type="button" onClick={runAfter}>احسب</button></p>
          {post1 && (
            <>
              <p data-testid="verdict"><strong>{post1.success ? "النتيجة: ناجح" : "النتيجة: مش ناجح"}</strong></p>
              <Lines lines={post1.lines} />
            </>
          )}
        </section>
      )}

      {tab === "velocity" && (
        <section>
          <div className="grid">
            <label className="field">المسار
              <select value={lane} onChange={(e) => setLane(e.target.value)} aria-label="المسار">
                <option value="china_early">ترند صيني مبكر</option>
                <option value="regional_proven">مثبت إقليمياً</option>
                <option value="manual">فكرة يدوية</option>
              </select>
            </label>
            {field(v.age, (s) => setV({ ...v, age: s }), "عمر الترند (يوم)")}
            {field(v.ramp7, (s) => setV({ ...v, ramp7: s }), "صنّاع جدد آخر 7 أيام")}
            {field(v.rampPrev, (s) => setV({ ...v, rampPrev: s }), "صنّاع جدد بالـ 7 قبلها")}
            {field(v.intent, (s) => setV({ ...v, intent: s }), "تعليقات النية")}
            {field(v.sample, (s) => setV({ ...v, sample: s }), "حجم عيّنة التعليقات")}
            {field(v.engagement, (s) => setV({ ...v, engagement: s }), "حرارة التفاعل (%)")}
            {field(v.sellers, (s) => setV({ ...v, sellers: s }), "عدد البائعين")}
            {field(v.yellow, (s) => setV({ ...v, yellow: s }), "السلة الصفراء (%)")}
            {field(v.advertisers, (s) => setV({ ...v, advertisers: s }), "معلنين بسوقك (فاضي = غير مقاس)")}
            {field(v.sales, (s) => setV({ ...v, sales: s }), "المبيعات التراكمية")}
            {field(v.creators, (s) => setV({ ...v, creators: s }), "عدد الصنّاع الكلي (للرفض)")}
          </div>
          <p><button type="button" onClick={runVelocity}>احسب</button></p>
          {vel && (
            <>
              <p data-testid="velocity-score"><strong>{vel.insufficient ? "بيانات غير كافية" : `المؤشر: ${vel.score}`}</strong> <details><summary>القاعدة</summary><span dir="auto">{vel.rule}</span></details></p>
              {vel.warnings.map((w) => <p key={w} className="error">{w}</p>)}
              {vel.rejects.map((r) => <p key={r} className="error" data-testid="reject">ارفض تلقائياً: {r}</p>)}
              <table>
                <thead><tr><th>الإشارة</th><th>القيمة</th><th>الدرجة</th><th>الوزن</th></tr></thead>
                <tbody>
                  {vel.signals.map((s) => (
                    <tr key={s.key}><td>{s.label}</td><td>{s.raw}</td><td>{s.score ?? "—"}</td><td>{s.measured ? s.weight : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}
    </div>
  );
}
