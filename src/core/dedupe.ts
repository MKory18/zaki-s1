// قرار الدمج: بصمة الصورة + تشابه العنوان + تضمين الصورة بحدود الإعدادات (dedupe.*).
// نفس المنتج · منفصلين · رمادي (للحَكَم H02). الرمادي بيضل منفصل لو الحَكَم واقف.
export interface DedupeConfig {
  phashMax: number; // 8
  titleMin: number; // 0.80
  imageEmbMin: number; // 0.92
  greyPhash: [number, number]; // [9, 14]
  greyTitle: [number, number]; // [0.70, 0.80)
}

export const DEFAULT_DEDUPE_CONFIG: DedupeConfig = { phashMax: 8, titleMin: 0.8, imageEmbMin: 0.92, greyPhash: [9, 14], greyTitle: [0.7, 0.8] };

export function dedupeConfigFrom(raw: (k: string) => string | undefined): DedupeConfig {
  const d = DEFAULT_DEDUPE_CONFIG;
  const num = (k: string, def: number) => {
    const m = /\d+(\.\d+)?/.exec(raw(k) ?? "");
    return m ? parseFloat(m[0]) : def;
  };
  const grey = raw("dedupe.grey") ?? "";
  const gp = /بصمة\s*(\d+)\s*[–-]\s*(\d+)/.exec(grey);
  const gt = /عنوان\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)/.exec(grey);
  return {
    phashMax: num("dedupe.phash_max", d.phashMax),
    titleMin: num("dedupe.title_min", d.titleMin),
    imageEmbMin: num("dedupe.image_emb_min", d.imageEmbMin),
    greyPhash: gp ? [parseInt(gp[1], 10), parseInt(gp[2], 10)] : d.greyPhash,
    greyTitle: gt ? [parseFloat(gt[1]), parseFloat(gt[2])] : d.greyTitle,
  };
}

// تطبيع النص: أحرف صغيرة، بلا تشكيل ولا ترقيم، ودمج صيغ الحروف العربية
export function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function grams(s: string, n: number): Map<string, number> {
  const m = new Map<string, number>();
  const t = ` ${s} `;
  for (let i = 0; i <= t.length - n; i++) m.set(t.slice(i, i + n), (m.get(t.slice(i, i + n)) ?? 0) + 1);
  return m;
}

// معامل Dice على ثلاثيات الحروف (بيشتغل لعربي وإنجليزي وصيني). 0..1
export function titleSimilarity(a: string, b: string): number {
  const x = normalizeText(a);
  const y = normalizeText(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  // الصيني بلا مسافات بين الكلمات: بيغرام. غيره ثلاثيات (والنص القصير بيغرام)
  const n = /[一-鿿]/.test(x + y) || Math.min(x.length, y.length) < 4 ? 2 : 3;
  const gx = grams(x, n);
  const gy = grams(y, n);
  let inter = 0;
  for (const [k, v] of gx) inter += Math.min(v, gy.get(k) ?? 0);
  const total = [...gx.values()].reduce((s, v) => s + v, 0) + [...gy.values()].reduce((s, v) => s + v, 0);
  return total === 0 ? 0 : (2 * inter) / total;
}

export type DedupeVerdict = "same" | "different" | "grey";

export interface DedupeSignals {
  phashDistance?: number | null;
  titleSim: number;
  imageEmbSim?: number | null;
}

export function dedupeDecision(s: DedupeSignals, cfg: DedupeConfig = DEFAULT_DEDUPE_CONFIG): { verdict: DedupeVerdict; reason: string } {
  const d = s.phashDistance ?? null;
  if (typeof s.imageEmbSim === "number" && s.imageEmbSim >= cfg.imageEmbMin) return { verdict: "same", reason: `تضمين الصورة ${s.imageEmbSim.toFixed(2)} ≥ ${cfg.imageEmbMin}` };
  if (d !== null && d <= cfg.phashMax) return { verdict: "same", reason: `بصمة الصورة بمسافة ${d} ≤ ${cfg.phashMax}` };
  if (s.titleSim >= cfg.titleMin) return { verdict: "same", reason: `تشابه العنوان ${s.titleSim.toFixed(2)} ≥ ${cfg.titleMin}` };
  const greyP = d !== null && d >= cfg.greyPhash[0] && d <= cfg.greyPhash[1];
  const greyT = s.titleSim >= cfg.greyTitle[0] && s.titleSim < cfg.greyTitle[1];
  if (greyP || greyT) return { verdict: "grey", reason: greyP ? `بصمة الصورة بمسافة ${d} بالمنطقة الرمادية` : `تشابه العنوان ${s.titleSim.toFixed(2)} بالمنطقة الرمادية` };
  return { verdict: "different", reason: "الصورة والعنوان مختلفين" };
}
