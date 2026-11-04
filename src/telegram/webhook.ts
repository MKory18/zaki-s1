// استقبال ضغطات أزرار تيليجرام. مسموح: راقب · ارفض بسبب من القائمة. ممنوع من تيليجرام: أي قرار مالي،
// والبحث المعمّق (بيفتح الموقع). التحقق: سر الويبهوك بالهيدر + chat id المالك بس. أي شي تاني بيتجاهل.
import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { DecisionError, decideCandidate } from "@/pipeline/decisions";
import { s1PublicUrl } from "@/adapters/config";
import { answerCallback, ownerChatId, sendToOwner, type Deps } from "./client";
import { parseCallback, reasonKeyboard } from "./keyboards";

export const SECRET_HEADER = "x-telegram-bot-api-secret-token";

export function secretOk(header: string | null, env: Record<string, string | undefined> = process.env): boolean {
  const want = env.TELEGRAM_WEBHOOK_SECRET;
  if (!want || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(want);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Update {
  callback_query?: { id: string; from?: { id?: number }; message?: { chat?: { id?: number } }; data?: string };
}

export const TELEGRAM_ACTOR = { sub: "telegram:owner", role: "owner" } as const;

export type HandleResult = { handled: boolean; reason?: string; replied?: string };

export async function handleUpdate(db: PrismaClient, update: Update, deps: Deps = {}): Promise<HandleResult> {
  const cb = update.callback_query;
  if (!cb) return { handled: false, reason: "not_callback" };
  const env = deps.env ?? process.env;
  const owner = ownerChatId(env);
  const chat = cb.message?.chat?.id !== undefined ? String(cb.message.chat.id) : cb.from?.id !== undefined ? String(cb.from.id) : null;
  if (!owner || chat !== owner) return { handled: false, reason: "not_owner" };

  const reply = async (text: string): Promise<HandleResult> => {
    await answerCallback(cb.id, text, deps);
    return { handled: true, replied: text };
  };

  const p = parseCallback(cb.data);
  if (p.kind === "unknown") return reply("أمر مش مفهوم");

  const candidate = await db.candidate.findFirst({ where: { id: p.id, deletedAt: null }, select: { titleAr: true } });
  if (!candidate) return reply("المرشح مش موجود");

  try {
    if (p.kind === "reject_menu") {
      const reasons = await db.rejectReason.findMany({ orderBy: { code: "asc" } });
      await answerCallback(cb.id, "اختار سبب الرفض", deps);
      await sendToOwner(`سبب رفض «${candidate.titleAr}»؟ (لسبب تاني افتح البطاقة من الموقع)`, [...reasonKeyboard(p.id, reasons.map((r) => ({ code: r.code, label: r.labelAr }))), [{ text: "افتح البطاقة", url: s1PublicUrl(`/candidates/${p.id}`) }]], deps);
      return { handled: true, replied: "reject_menu" };
    }
    if (p.kind === "watch") {
      await decideCandidate(db, p.id, TELEGRAM_ACTOR, { action: "watch" }, { fromTelegram: true });
      await sendToOwner(`تمّت المراقبة: ${candidate.titleAr}`, undefined, deps);
      return reply("تمّ: مراقبة");
    }
    await decideCandidate(db, p.id, TELEGRAM_ACTOR, { action: "reject", reasonCode: p.code }, { fromTelegram: true });
    await sendToOwner(`تمّ الرفض: ${candidate.titleAr} (${p.code})`, undefined, deps);
    return reply("تمّ الرفض");
  } catch (e) {
    if (e instanceof DecisionError) return reply(e.message);
    throw e;
  }
}
