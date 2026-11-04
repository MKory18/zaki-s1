// أدوات الوكلاء: قراءة ومسودات بس. ولا أداة إرسال خارجي ولا دفع (قاعدة CONVENTIONS).
// كل أداة بتتسجّل هون، وأي اسم فيه إرسال أو دفع أو نشر بيرمي خطأ وقت التحميل، فما بتنضاف بالغلط.
import type { PrismaClient } from "@/generated/prisma/client";
import { getSetting } from "@/lib/settings";

export type ToolKind = "read" | "draft";

export interface ToolDef {
  name: string;
  kind: ToolKind;
  description: string;
  run: (db: PrismaClient, args: Record<string, unknown>) => Promise<unknown>;
}

export const FORBIDDEN_TOOL_NAME = /(send|pay|post|transfer|purchase|email|mail|publish|charge|order|sms|whatsapp|telegram|webhook|launch|upload)/i;

const DRAFT_KINDS = ["rfq", "sample", "followup"] as const;

const defs: ToolDef[] = [
  {
    name: "read_setting",
    kind: "read",
    description: "قراءة إعداد بمفتاحه",
    run: async (db, a) => (typeof a.key === "string" ? (await getSetting(db, a.key))?.value ?? null : null),
  },
  {
    name: "read_claims",
    kind: "read",
    description: "قاموس الادعاءات: الممنوع وبديله",
    run: (db) => db.claimRule.findMany({ where: { deletedAt: null }, select: { phrase: true, reason: true, alternative: true } }),
  },
  {
    name: "read_reference_texts",
    kind: "read",
    description: "النصوص المرجعية مع حالة مراجعتها",
    run: (db) => db.referenceText.findMany({ where: { deletedAt: null }, select: { code: true, ingredient: true, text: true, source: true, reviewStatus: true } }),
  },
  {
    name: "read_ingredients",
    kind: "read",
    description: "المكونات (مسموحة · مقيّدة · محظورة)",
    run: (db, a) =>
      db.ingredient.findMany({
        where: { deletedAt: null, ...(typeof a.status === "string" ? { status: a.status as never } : {}) },
        select: { nameAr: true, nameEn: true, status: true, note: true },
      }),
  },
  {
    name: "read_reject_reasons",
    kind: "read",
    description: "أسباب الرفض الموحّدة",
    run: (db) => db.rejectReason.findMany({ select: { code: true, labelAr: true } }),
  },
  {
    name: "save_draft",
    kind: "draft",
    description: "حفظ مسودة رسالة (طلب عرض أو عيّنة أو متابعة). بتضل «مسودة»، وإنت بتبعتها من برّا النظام",
    run: async (db, a) => {
      if (!DRAFT_KINDS.includes(a.kind as never)) throw new Error("نوع المسودة غلط");
      if (typeof a.body !== "string" || !a.body.trim()) throw new Error("نص المسودة فاضي");
      return db.draftMessage.create({
        data: { kind: a.kind as never, body: a.body, supplierId: typeof a.supplierId === "string" ? a.supplierId : null, status: "draft" },
      });
    },
  },
];

for (const d of defs) {
  if (FORBIDDEN_TOOL_NAME.test(d.name)) throw new Error(`اسم أداة ممنوع: ${d.name} (الأدوات قراءة ومسودات بس)`);
}

export const TOOLS: Readonly<Record<string, ToolDef>> = Object.freeze(Object.fromEntries(defs.map((d) => [d.name, d])));

export class ToolError extends Error {}

export async function callTool(db: PrismaClient, allowed: readonly string[], name: string, args: Record<string, unknown> = {}) {
  const tool = TOOLS[name];
  if (!tool) throw new ToolError(`الأداة ${name} مش موجودة`);
  if (!allowed.includes(name)) throw new ToolError(`الأداة ${name} مش مسموحة لهالوكيل`);
  return tool.run(db, args);
}
