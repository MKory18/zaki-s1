// أخطاء بوابة الامتثال والجودة بشكل موحّد: الحالة والرمز والرسالة العربية (+ تفاصيل للواجهة، مثل أسباب منع الإفراج).
export class ComplianceError extends Error {
  constructor(
    public status: 400 | 404 | 409,
    public code: "bad_request" | "not_found" | "conflict" | "refused",
    message: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const badRequest = (m: string) => new ComplianceError(400, "bad_request", m);
export const notFound = (m: string) => new ComplianceError(404, "not_found", m);
export const conflict = (m: string, extra?: Record<string, unknown>) => new ComplianceError(409, "conflict", m, extra);
export const refused = (m: string, extra?: Record<string, unknown>) => new ComplianceError(409, "refused", m, extra);

/** تحويل أي خطأ معروف لرد JSON موحّد، والمجهول بيطلع كما هو (500). */
export function errorResponse(e: unknown): Response {
  if (e instanceof ComplianceError) return Response.json({ error: { code: e.code, message: e.message, ...(e.extra ?? {}) } }, { status: e.status });
  throw e;
}

export function str(v: unknown, field: string, opts: { required?: boolean; max?: number } = {}): string | null {
  if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
    if (opts.required) throw badRequest(`${field} مطلوب`);
    return null;
  }
  if (typeof v !== "string") throw badRequest(`${field} لازم نص`);
  const t = v.trim();
  if (t.length > (opts.max ?? 2000)) throw badRequest(`${field} أطول من المسموح`);
  return t;
}

export function date(v: unknown, field: string): Date | null {
  if (v === undefined || v === null || v === "") return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw badRequest(`${field}: تاريخ غير صالح`);
  return d;
}

export function bool(v: unknown, field: string): boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "boolean") throw badRequest(`${field} لازم نعم أو لا`);
  return v;
}

export function int(v: unknown, field: string, opts: { min?: number; max?: number; required?: boolean } = {}): number | null {
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw badRequest(`${field} مطلوب`);
    return null;
  }
  const n = Number(v);
  if (!Number.isInteger(n) || n < (opts.min ?? Number.MIN_SAFE_INTEGER) || n > (opts.max ?? Number.MAX_SAFE_INTEGER)) throw badRequest(`${field}: رقم صحيح بين ${opts.min ?? "-∞"} و${opts.max ?? "∞"}`);
  return n;
}
