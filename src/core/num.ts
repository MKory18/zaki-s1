// حساب عشري دقيق (decimal.js): ممنوع أرقام عائمة للمال. التقريب لخانتين بنص الخانة لفوق (7.595 ← 7.60).
import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;
export const D = (v: Decimal.Value) => new Decimal(v);

export function round2(v: Decimal.Value): Decimal {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

export function text2(v: Decimal.Value): string {
  return round2(v).toFixed(2);
}

export function pct1(v: Decimal.Value): string {
  return new Decimal(v).times(100).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1);
}
