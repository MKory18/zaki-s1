// حاسبة الاقتصاد (docs/01-logic.md الجزء الرابع، قسم 7). كل رقم بقاعدته، والحساب عشري دقيق.
// ولا ضرايب ولا رسوم حكومية بأي حساب. ولا رقم من موديل. الحدود (الصرف · الهامش · 1.01 · 0.97) من القواعد.
import { D, Decimal, round2, text2, pct1, type Dec } from "./num";

export const SPEND_FACTOR = D("1.01"); // الصرف الإعلاني الفعلي = الصرف × 1.01
export const EXPENSES_FACTOR = D("0.97"); // خصم 3% للرواتب والمصاريف والتحويلات (إذا الربح موجب)
export const SCALING_SHARE = D("0.6"); // سقف التكبير = حد الخسارة × 60%

export interface Offer {
  qty: number;
  price: string | number;
  share: string | number; // نسبة العرض (0..1)
}

export interface EconomicsInput {
  /** تكلفة الوحدة بالدولار: إما مباشرة، أو بالدينار مع سعر الصرف والشحن */
  unitCostUsd?: string | number;
  unitCostJod?: string | number;
  fxJodUsd?: string | number; // افتراضي 1.41 من الإعدادات
  shippingPerUnitUsd?: string | number; // شحن وتغليف للوحدة
  offers: Offer[];
  deliveryFee: string | number; // أجرة التوصيل لكل شحنة
  returnFee?: string | number; // أجرة المرتجع (صفر إذا ما في)
  returnRate: string | number; // نسبة المرتجع المتوقعة (0..1)
  safetyMargin: string | number; // هامش الأمان (0..1)
}

export interface Line {
  key: string;
  label: string;
  value: string; // نص مقرّب (خانتين) أو نسبة
  rule: string; // القاعدة بالأرقام المعوّضة، بتنفتح من الشاشة
  raw: string; // القيمة الدقيقة
}

const L = (key: string, label: string, v: Dec, rule: string, text?: string): Line => ({ key, label, value: text ?? text2(v), rule, raw: v.toString() });

export class EconomicsError extends Error {}

function check(i: EconomicsInput) {
  if (!Array.isArray(i.offers) || i.offers.length === 0) throw new EconomicsError("لازم عرض واحد على الأقل");
  const share = i.offers.reduce((a, o) => a.plus(o.share), D(0));
  if (!share.minus(1).abs().lt("0.0001")) throw new EconomicsError(`نسب العروض لازم مجموعها 100% (الحالي ${pct1(share)}%)`);
  for (const o of i.offers) {
    if (!(o.qty > 0) || !Number.isInteger(o.qty)) throw new EconomicsError("عدد الحبات لازم رقم صحيح موجب");
    if (D(o.price).lte(0)) throw new EconomicsError("سعر العرض لازم يكون موجب");
    if (D(o.share).lt(0)) throw new EconomicsError("نسبة العرض ما بتكون سالبة");
  }
  const r = D(i.returnRate);
  if (r.lt(0) || r.gte(1)) throw new EconomicsError("نسبة المرتجع لازم بين 0 و100% (بدون 100%)");
  const m = D(i.safetyMargin);
  if (m.lt(0) || m.gte(1)) throw new EconomicsError("هامش الأمان لازم بين 0 و100%");
  if (D(i.deliveryFee).lt(0) || D(i.returnFee ?? 0).lt(0)) throw new EconomicsError("الأجور ما بتكون سالبة");
}

export function unitCostUsd(i: EconomicsInput): { value: Dec; rule: string } {
  const ship = D(i.shippingPerUnitUsd ?? 0);
  if (i.unitCostUsd !== undefined && i.unitCostUsd !== null && i.unitCostUsd !== "") {
    const v = D(i.unitCostUsd).plus(ship);
    return { value: v, rule: `تكلفة الوحدة بالدولار ${i.unitCostUsd}${ship.gt(0) ? ` + شحن وتغليف ${ship}` : ""} = ${text2(v)}` };
  }
  if (i.unitCostJod === undefined || i.unitCostJod === "") throw new EconomicsError("لازم تكلفة الوحدة (بالدولار أو بالدينار)");
  const fx = D(i.fxJodUsd ?? "1.41");
  const v = D(i.unitCostJod).times(fx).plus(ship);
  return { value: v, rule: `تكلفة الوحدة = تكلفة الدينار ${i.unitCostJod} × سعر الصرف ${fx}${ship.gt(0) ? ` + شحن وتغليف ${ship}` : ""} = ${text2(v)}$` };
}

// المتوقع لكل شحنة قبل الإعلان = (1 − ر) × (متوسط قيمة الطلب − متوسط الوحدات × ت) − ج − ر × ج م
export function shipmentExpected(aov: Dec, avgUnits: Dec, cost: Dec, returnRate: Dec, delivery: Dec, returnFee: Dec): Dec {
  return D(1).minus(returnRate).times(aov.minus(avgUnits.times(cost))).minus(delivery).minus(returnRate.times(returnFee));
}

// ربح الطلب المُسلَّم عند صرف (ص) لكل شحنة: (المتوقع − ص×1.01) × 0.97 إذا موجب (وإلا كما هو) ÷ (1 − ر)
export function deliveredProfit(expected: Dec, spendPerShipment: Dec, returnRate: Dec): Dec {
  const net = expected.minus(spendPerShipment.times(SPEND_FACTOR));
  const afterExpenses = net.gt(0) ? net.times(EXPENSES_FACTOR) : net;
  return afterExpenses.div(D(1).minus(returnRate));
}

export interface Scenario {
  key: "pessimistic" | "expected" | "optimistic";
  label: string;
  returnRate: string;
  spendPerShipment: string;
  deliveredProfit: string; // نص (سالب = خسارة)
  loss: boolean;
  rule: string;
}

export interface Projection {
  lines: Line[];
  scenarios: Scenario[];
  lossLimit: string;
  cpaCeiling: string;
  scalingCeiling: string;
  expectedPerShipment: string;
  rawLossLimit: Dec;
}

export function projectEconomics(i: EconomicsInput): Projection {
  check(i);
  const cost = unitCostUsd(i);
  const aov = i.offers.reduce((a, o) => a.plus(D(o.price).times(o.share)), D(0));
  const avgUnits = i.offers.reduce((a, o) => a.plus(D(o.qty).times(o.share)), D(0));
  const r = D(i.returnRate);
  const delivery = D(i.deliveryFee);
  const rf = D(i.returnFee ?? 0);
  const margin = D(i.safetyMargin);

  const expected = shipmentExpected(aov, avgUnits, cost.value, r, delivery, rf);
  const lossLimit = expected; // حد الخسارة = المتوقع لكل شحنة قبل الإعلان (أعلى صرف قبل ما تخسر)
  const cpa = lossLimit.times(D(1).minus(margin));
  const scaling = lossLimit.times(SCALING_SHARE);

  const lines: Line[] = [
    L("unit_cost", "تكلفة الوحدة بالدولار", cost.value, cost.rule),
    L("aov", "متوسط قيمة الطلب", aov, `مجموع (سعر العرض × نسبته) = ${i.offers.map((o) => `${o.price}×${o.share}`).join(" + ")} = ${text2(aov)}`),
    L("avg_units", "متوسط الوحدات بالطلب", avgUnits, `مجموع (عدد الحبات × نسبة العرض) = ${i.offers.map((o) => `${o.qty}×${o.share}`).join(" + ")} = ${avgUnits.toDecimalPlaces(2)}`, avgUnits.toDecimalPlaces(2).toString()),
    L("loss_limit", "حد الخسارة لكل شحنة", lossLimit, `(1 − ${r}) × (${text2(aov)} − ${avgUnits.toDecimalPlaces(2)} × ${text2(cost.value)}) − ${delivery}${rf.gt(0) ? ` − ${r} × ${rf}` : ""} = ${text2(lossLimit)}`),
    L("cpa_ceiling", "سقف تكلفة الطلب", cpa, `حد الخسارة ${text2(lossLimit)} × (1 − هامش الأمان ${margin}) = ${text2(cpa)}`),
    L("scaling_ceiling", "سقف التكبير", scaling, `حد الخسارة ${text2(lossLimit)} × 60% = ${text2(scaling)}`),
  ];

  const mk = (key: Scenario["key"], label: string, rr: Dec, spendShare: string): Scenario => {
    const exp = shipmentExpected(aov, avgUnits, cost.value, rr, delivery, rf);
    const spend = lossLimit.times(spendShare);
    const dp = deliveredProfit(exp, spend, rr);
    return {
      key,
      label,
      returnRate: pct1(rr),
      spendPerShipment: text2(spend),
      deliveredProfit: text2(dp),
      loss: dp.lt(0),
      rule: `مرتجع ${pct1(rr)}% · صرف ${text2(spend)}$ لكل شحنة (${D(spendShare).times(100)}% من حد الخسارة) · (المتوقع ${text2(exp)} − ${text2(spend)} × 1.01)${exp.minus(spend.times(SPEND_FACTOR)).gt(0) ? " × 0.97" : ""} ÷ (1 − ${rr}) = ${text2(dp)}`,
    };
  };
  const scenarios = [
    mk("pessimistic", "متشائم", r.plus("0.08"), "0.9"),
    mk("expected", "متوقع", r, "0.6"),
    mk("optimistic", "متفائل", Decimal.max(r.minus("0.05"), D(0)), "0.4"),
  ];
  return { lines, scenarios, lossLimit: text2(lossLimit), cpaCeiling: text2(cpa), scalingCeiling: text2(scaling), expectedPerShipment: text2(expected), rawLossLimit: lossLimit };
}

// ───── بعد الاختبار: من أرقام الـ OMS ─────
export interface ActualInput {
  adSpend: string | number;
  orders?: number;
  confirmed: number;
  shipped: number;
  delivered: number;
  returned: number;
  collected: string | number;
  deliveryFees: string | number;
  returnFees: string | number;
  cogsDelivered: string | number;
}

export interface Actual {
  lines: Line[];
  netCollected: string;
  lossLimit: string | null;
  scalingCeiling: string | null;
  profit: string;
  profitPerDelivered: string | null;
  costPerConfirmed: string | null;
  costPerDelivered: string | null;
  returnRate: string | null;
  deliveryRate: string | null;
  confirmRate: string | null;
  success: boolean; // ربح الطلب المُسلَّم أكبر من صفر
}

export function actualEconomics(a: ActualInput): Actual {
  const net = D(a.collected).minus(a.deliveryFees).minus(a.returnFees);
  const spend = D(a.adSpend).times(SPEND_FACTOR);
  const cogs = D(a.cogsDelivered);
  const lossLimit = a.shipped > 0 ? net.minus(cogs).div(a.shipped) : null;
  const scaling = lossLimit ? lossLimit.times(SCALING_SHARE) : null;
  const raw = net.minus(cogs).minus(spend);
  const profit = raw.gt(0) ? raw.times(EXPENSES_FACTOR) : raw;
  const perDelivered = a.delivered > 0 ? profit.div(a.delivered) : null;
  const perConfirmed = a.confirmed > 0 ? spend.div(a.confirmed) : null;
  const perDeliveredCost = a.delivered > 0 ? spend.div(a.delivered) : null;
  const returnRate = a.shipped > 0 ? D(a.returned).div(a.shipped) : null;
  const deliveryRate = a.shipped > 0 ? D(a.delivered).div(a.shipped) : null;
  const confirmRate = a.orders && a.orders > 0 ? D(a.confirmed).div(a.orders) : null;

  const lines: Line[] = [
    L("net_collected", "الصافي المحصّل", net, `المحصّل ${a.collected} − أجور التوصيل ${a.deliveryFees} − أجور المرتجع ${a.returnFees} = ${text2(net)}`),
    L("actual_ad_spend", "الصرف الإعلاني الفعلي", spend, `الصرف ${a.adSpend} × 1.01 = ${text2(spend)}`),
    ...(lossLimit ? [L("actual_loss_limit", "حد الخسارة الفعلي لكل شحنة", lossLimit, `(${text2(net)} − تكلفة البضاعة المُسلَّمة ${a.cogsDelivered}) ÷ ${a.shipped} شحنة = ${text2(lossLimit)}`)] : []),
    ...(scaling ? [L("actual_scaling", "سقف التكبير الفعلي", scaling, `حد الخسارة الفعلي ${text2(lossLimit!)} × 60% = ${text2(scaling)}`)] : []),
    L("profit", "الربح بعد المصاريف", profit, `(${text2(net)} − ${a.cogsDelivered} − ${text2(spend)})${raw.gt(0) ? " × 0.97" : " (سالب: بلا خصم)"} = ${text2(profit)}`),
    ...(perDelivered ? [L("profit_per_delivered", "ربح الطلب المُسلَّم", perDelivered, `${text2(profit)} ÷ ${a.delivered} طلب مُسلَّم = ${text2(perDelivered)}`)] : []),
    ...(perConfirmed ? [L("cost_per_confirmed", "تكلفة الطلب المؤكد", perConfirmed, `${text2(spend)} ÷ ${a.confirmed} طلب مؤكد = ${text2(perConfirmed)}`)] : []),
    ...(perDeliveredCost ? [L("cost_per_delivered", "تكلفة الطلب المُسلَّم", perDeliveredCost, `${text2(spend)} ÷ ${a.delivered} طلب مُسلَّم = ${text2(perDeliveredCost)}`)] : []),
    ...(returnRate ? [L("return_rate", "نسبة المرتجع", returnRate, `${a.returned} ÷ ${a.shipped} شحنة = ${pct1(returnRate)}%`, `${pct1(returnRate)}%`)] : []),
    ...(deliveryRate ? [L("delivery_rate", "نسبة التسليم", deliveryRate, `${a.delivered} ÷ ${a.shipped} = ${pct1(deliveryRate)}%`, `${pct1(deliveryRate)}%`)] : []),
    ...(confirmRate ? [L("confirm_rate", "نسبة التأكيد", confirmRate, `${a.confirmed} ÷ ${a.orders} = ${pct1(confirmRate)}%`, `${pct1(confirmRate)}%`)] : []),
  ];
  return {
    lines,
    netCollected: text2(net),
    lossLimit: lossLimit ? text2(lossLimit) : null,
    scalingCeiling: scaling ? text2(scaling) : null,
    profit: text2(profit),
    profitPerDelivered: perDelivered ? text2(perDelivered) : null,
    costPerConfirmed: perConfirmed ? text2(perConfirmed) : null,
    costPerDelivered: perDeliveredCost ? text2(perDeliveredCost) : null,
    returnRate: returnRate ? `${pct1(returnRate)}%` : null,
    deliveryRate: deliveryRate ? `${pct1(deliveryRate)}%` : null,
    confirmRate: confirmRate ? `${pct1(confirmRate)}%` : null,
    // المنتج الناجح: ربح الطلب المُسلَّم أكبر من صفر (من أرقام الـ OMS، مش من اللايكات)
    success: perDelivered !== null && perDelivered.gt(0),
  };
}

export { round2 };
