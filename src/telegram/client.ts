// عميل تيليجرام (Bot API). بلا توكن = وضع وهمي: الرسائل بتتخزن بالذاكرة وما بتطلع لبرا.
// التوكن من البيئة بالاسم بس (TELEGRAM_BOT_TOKEN) وما بيطلع بلوغ أو رد.
export interface InlineButton {
  text: string;
  callback_data?: string;
  url?: string;
}
export type Keyboard = InlineButton[][];

export interface SendResult {
  ok: boolean;
  mock: boolean;
  error?: string;
}

export interface SentRecord {
  chatId: string;
  text: string;
  keyboard?: Keyboard;
}

const g = globalThis as unknown as { __s1TgOutbox?: SentRecord[] };
export const mockOutbox: SentRecord[] = (g.__s1TgOutbox ??= []);

type Env = Record<string, string | undefined>;
export const ownerChatId = (env: Env = process.env): string | null => env.TELEGRAM_OWNER_CHAT_ID?.trim() || null;
export const telegramConfigured = (env: Env = process.env): boolean => Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && ownerChatId(env));

async function call(method: string, body: object, fetchImpl: typeof fetch, env: Record<string, string | undefined>): Promise<SendResult> {
  const token = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { ok: true, mock: true };
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { ok: false, mock: false, error: `تيليجرام رد ${res.status}` };
    return { ok: true, mock: false };
  } catch (e) {
    // رسالة الخطأ ممكن تحمل الرابط بالتوكن: ما بنرجّعها
    return { ok: false, mock: false, error: (e as Error).name === "TimeoutError" ? "تيليجرام ما رد بالوقت" : "تعذّر الوصول لتيليجرام" };
  }
}

export interface Deps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
}

// بيبعت للمالك بس (chat id من البيئة). ما بيرمي خطأ: النتيجة {ok}.
export async function sendToOwner(text: string, keyboard?: Keyboard, deps: Deps = {}): Promise<SendResult> {
  const env = deps.env ?? process.env;
  const chatId = ownerChatId(env);
  if (!chatId) return { ok: false, mock: true, error: "TELEGRAM_OWNER_CHAT_ID مش مضبوط" };
  if (!env.TELEGRAM_BOT_TOKEN?.trim()) {
    mockOutbox.push({ chatId, text, keyboard });
    if (mockOutbox.length > 200) mockOutbox.shift();
    return { ok: true, mock: true };
  }
  return call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true, ...(keyboard ? { reply_markup: { inline_keyboard: keyboard } } : {}) }, deps.fetchImpl ?? fetch, env);
}

export async function answerCallback(callbackId: string, text: string, deps: Deps = {}): Promise<SendResult> {
  return call("answerCallbackQuery", { callback_query_id: callbackId, text: text.slice(0, 190) }, deps.fetchImpl ?? fetch, deps.env ?? process.env);
}

export function resetMockOutboxForTests() {
  mockOutbox.length = 0;
}
