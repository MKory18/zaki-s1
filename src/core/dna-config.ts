// إعدادات الحمض من الإعدادات المبذورة: النقاط الافتراضية (dna.points) والأوزان (dna.w.*) والثوابت.
import type { PrismaClient } from "@/generated/prisma/client";
import { listSettings } from "@/lib/settings";
import { SCORED_TRAITS, type DnaConfig, type TraitId } from "./dna";
import { parseNumber, parseNumberList, rawOf } from "./settings-parse";

export function buildDnaConfig(values: Map<string, unknown>): DnaConfig {
  const raw = (k: string) => rawOf(values.get(k));
  const pointsItems = ((values.get("dna.points") as { items?: { attr: string; options: { value: string; points: number }[] }[] } | undefined)?.items ?? []);
  const points = {} as DnaConfig["points"];
  const weights = {} as DnaConfig["weights"];
  for (const t of SCORED_TRAITS) {
    const item = pointsItems.find((p) => p.attr === t.attr);
    if (!item) throw new Error(`نقاط الحمض الافتراضية ناقصة لصفة ${t.label}`);
    points[t.id as TraitId] = Object.fromEntries(item.options.map((o) => [o.value, o.points]));
    const w = parseNumber(raw(`dna.w.${t.id}`));
    if (w === null) throw new Error(`وزن الحمض الافتراضي ناقص لصفة ${t.label} (dna.w.${t.id})`);
    weights[t.id as TraitId] = w;
  }
  const sim = parseNumberList(raw("dna.sim.weights"));
  return {
    points,
    weights,
    confidenceK: parseNumber(raw("dna.confidence_k")) ?? 10,
    blendK: parseNumber(raw("dna.blend_k")) ?? 10,
    smallSample: parseNumber(raw("dna.small_sample")) ?? 3,
    simWeights: sim && sim.length === 3 ? [sim[0], sim[1], sim[2]] : [0.5, 0.3, 0.2],
  };
}

export async function loadDnaConfig(db: PrismaClient): Promise<DnaConfig> {
  const all = await listSettings(db);
  return buildDnaConfig(new Map(all.map((s) => [s.key, s.value])));
}
