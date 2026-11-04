import { dbConfigured, getDb } from "@/lib/db";
import { SECRET_HEADER, handleUpdate, secretOk } from "@/telegram/webhook";

export const dynamic = "force-dynamic";

// عام عن قصد: تيليجرام ما عنده جلسة موظف. الحماية بسر الهيدر وchat id المالك (انظر telegram/webhook.ts).
// ويبهوك تيليجرام (setWebhook مع secret_token = TELEGRAM_WEBHOOK_SECRET). بلا سر مضبوط أو بسر غلط = مرفوض.
// الردود للتحقق الناجح دايماً 200 حتى ما يعيد تيليجرام الإرسال.
export async function POST(req: Request): Promise<Response> {
  if (!process.env.TELEGRAM_WEBHOOK_SECRET) return Response.json({ error: { code: "disabled", message: "الويبهوك مش مفعّل" } }, { status: 503 });
  if (!secretOk(req.headers.get(SECRET_HEADER))) return Response.json({ error: { code: "forbidden", message: "سر الويبهوك غلط" } }, { status: 403 });
  if (!dbConfigured()) return Response.json({ error: { code: "no_db", message: "القاعدة مش متصلة" } }, { status: 503 });
  const update = await req.json().catch(() => null);
  if (!update || typeof update !== "object") return Response.json({ ok: true, ignored: true });
  try {
    const r = await handleUpdate(getDb(), update);
    return Response.json({ ok: true, handled: r.handled });
  } catch (e) {
    console.error("[telegram] خطأ بمعالجة التحديث:", e instanceof Error ? e.message : e);
    return Response.json({ ok: true, handled: false });
  }
}
