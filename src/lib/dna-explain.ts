// شرح التعلّم بـ A05 (اختياري): شو تغيّر بالأوزان وليش. فشله ما بيوقف التعلّم.
import type { PrismaClient } from "@/generated/prisma/client";
import { runAgent } from "@/agents/service";
import type { DnaModel } from "@/core/dna";

export function makeExplainer(db: PrismaClient) {
  return async (model: DnaModel, prev: DnaModel | null): Promise<string | null> => {
    const brief = (m: DnaModel | null) => (m ? Object.fromEntries(Object.values(m.traits).map((t) => [t.id, Number(t.finalWeight.toFixed(4))])) : null);
    const r = await runAgent(
      db,
      "A05",
      {
        weights_new: brief(model),
        weights_old: brief(prev),
        samples: Object.fromEntries(Object.values(model.traits).map((t) => [t.id, t.known])),
        performance: { products: model.products },
        references: [],
      },
      { inputRef: "dna.learn" },
    );
    const out = r.output as { summary?: string } | null;
    return typeof out?.summary === "string" ? out.summary : null;
  };
}
