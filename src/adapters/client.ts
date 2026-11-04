// عميل HTTP للأنظمة. وهمي: بيحكي مع الخادم الوهمي (نفس العقد). حقيقي: العنوان والتوكن من .env، بلا تحويلات، ومهلة.
// التوكن بيروح بالترويسة Authorization بس، وما بينكتب بأي سجل ولا رسالة خطأ.
import { randomBytes } from "node:crypto";
import { baseUrlEnv, tokenEnv, validBaseUrl, type Mode } from "./config";
import { NETWORK_FAILURE, type ApiErrorBody } from "./errors";
import { waitForSlot } from "./limiter";
import { createMockFetch, MOCK_TOKEN } from "./mock";
import type { SystemId } from "./contracts";

export interface CallResult {
  status: number;
  body: unknown;
  requestId: string;
  retryAfterS?: number;
}

export interface CallOptions {
  system: SystemId;
  mode: Mode;
  method: "GET" | "POST";
  path: string; // /api/v1/...
  body?: unknown;
  idempotencyKey?: string;
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export class ConfigProblem extends Error {}

export const newRequestId = () => `req_${randomBytes(5).toString("hex")}`;

export async function callSystem(o: CallOptions): Promise<CallResult> {
  const env = o.env ?? process.env;
  const requestId = newRequestId();
  let base: string;
  let token: string;
  let f: typeof fetch;

  if (o.mode === "mock") {
    base = `http://mock.${o.system}.local`;
    token = MOCK_TOKEN(o.system);
    f = o.fetchImpl ?? createMockFetch(o.system);
  } else {
    const url = validBaseUrl(env[baseUrlEnv(o.system)]);
    if (!url) throw new ConfigProblem(`عنوان ${o.system} مش مضبوط أو مش آمن (لازم https)`);
    const tok = env[tokenEnv(o.system)];
    if (!tok) throw new ConfigProblem(`توكن ${o.system} ناقص`);
    base = url;
    token = tok;
    f = o.fetchImpl ?? fetch;
  }

  await waitForSlot(`out:${o.system}`, undefined, o.sleep);
  const headers: Record<string, string> = {
    authorization: `Bearer ${token}`,
    "x-request-id": requestId,
    accept: "application/json",
  };
  if (o.body !== undefined) headers["content-type"] = "application/json; charset=utf-8";
  if (o.idempotencyKey) headers["idempotency-key"] = o.idempotencyKey;

  try {
    const res = await f(`${base}${o.path}`, {
      method: o.method,
      headers,
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      redirect: "manual", // ما بنتبع تحويلات: ما بدنا التوكن يروح لمكان تاني
      signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
    });
    const text = await res.text();
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { error: { message: "رد مش JSON" } } satisfies ApiErrorBody;
    }
    const ra = Number(res.headers.get("retry-after"));
    return { status: res.status, body, requestId: res.headers.get("x-request-id") ?? requestId, retryAfterS: Number.isFinite(ra) && ra > 0 ? ra : undefined };
  } catch {
    return { status: NETWORK_FAILURE, body: null, requestId };
  }
}
