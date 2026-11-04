// عرض المبالغ: الوحدة الصغيرة (جزء من مليون دولار) لدولار بأربع خانات. للعرض بس، الحساب كله بأعداد صحيحة.
export function formatUsd(micro: number): string {
  return `$${(micro / 1_000_000).toFixed(4)}`;
}
