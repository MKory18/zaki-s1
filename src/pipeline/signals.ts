// تجميع ملاحظات المصادر لمرشح بإشارات مؤشر السرعة. الأرقام من الملاحظات، والكود هو اللي بيجمّع (مش موديل).
import type { VelocityInput } from "@/core/velocity";

export interface ObsLike {
  source: string;
  accessMethod: string;
  url: string | null;
  capturedAt: Date;
  price: { toString(): string } | null;
  currency: string | null;
  creators: number | null;
  newCreators7d: number | null;
  newCreatorsPrev7d: number | null;
  intentComments: number | null;
  skepticComments: number | null;
  commentSample: unknown;
  engagementRate: number | null;
  yellowCartShare: number | null;
  advertisersInMarket: number | null;
  cumulativeSales: number | null;
  signalsJson: unknown;
}

const MARKETPLACES = new Set(["aliexpress", "temu", "shein", "amazon", "iherb", "noon", "generic"]);

const sampleOf = (o: ObsLike): number | null => {
  const s = (o.commentSample as { size?: unknown } | null)?.size;
  return typeof s === "number" ? s : null;
};
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? null : s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

// الأحدث بياخد الأولوية للإشارات اللحظية، والتجميع للإشارات الجماعية (التعليقات). الناقص null (مش صفر).
export function aggregateSignals(obs: ObsLike[]): VelocityInput {
  const byNewest = [...obs].sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime());
  const latest = <T>(f: (o: ObsLike) => T | null | undefined): T | null => {
    for (const o of byNewest) {
      const v = f(o);
      if (v !== null && v !== undefined) return v;
    }
    return null;
  };

  const withSample = obs.filter((o) => sampleOf(o) !== null && o.intentComments !== null);
  const sample = withSample.reduce((a, o) => a + (sampleOf(o) as number), 0);
  const intent = withSample.reduce((a, o) => a + (o.intentComments as number), 0);

  // عدد البائعين المختلفين لنفس المنتج بعد الدمج: روابط مختلفة من الأسواق
  const sellers = new Set(obs.filter((o) => MARKETPLACES.has(o.source) && o.url).map((o) => o.url!.toLowerCase())).size;
  const ages = obs.map((o) => (o.signalsJson as { trendAgeDays?: number | null } | null)?.trendAgeDays).filter((n): n is number => typeof n === "number");
  const sales = obs.map((o) => o.cumulativeSales).filter((n): n is number => typeof n === "number");
  const eng = byNewest.map((o) => o.engagementRate).filter((n): n is number => typeof n === "number");

  return {
    trendAgeDays: ages.length ? Math.max(...ages) : null,
    newCreators7d: latest((o) => o.newCreators7d),
    newCreatorsPrev7d: latest((o) => o.newCreatorsPrev7d),
    intentComments: withSample.length ? intent : null,
    commentSample: withSample.length ? sample : null,
    engagementRate: median(eng),
    sellersCount: sellers > 0 ? sellers : null,
    yellowCartShare: latest((o) => o.yellowCartShare),
    advertisersInMarket: latest((o) => o.advertisersInMarket),
    cumulativeSales: sales.length ? Math.max(...sales) : null,
  };
}

export const creatorsTotal = (obs: ObsLike[]): number | null => {
  const c = obs.map((o) => o.creators).filter((n): n is number => typeof n === "number");
  return c.length ? Math.max(...c) : null;
};

// أقل سعر ظاهر بالدولار من الأسواق: تكلفة مرجعية تقريبية (تقدير، مش تكلفة المورّد)
export const minUsdPrice = (obs: ObsLike[]): number | null => {
  const p = obs.filter((o) => o.price && o.currency === "USD").map((o) => parseFloat(o.price!.toString())).filter((n) => Number.isFinite(n) && n > 0);
  return p.length ? Math.min(...p) : null;
};
