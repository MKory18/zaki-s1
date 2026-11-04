// حارس كل نقطة API: دخول ثم صلاحية صريحة. الرفض هو الافتراضي، والأخطاء بالعربي بشكل موحّد.
import { can, type Action } from "@/core/permissions";
import { recordAudit } from "@/lib/audit";
import { SESSION_COOKIE, getSecret, parseCookies, readSession } from "@/lib/session";
import { drain, ensureHydrated } from "@/lib/persist";
import { getUser, type UserRecord } from "@/lib/users";

export function apiError(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

export interface GuardContext<P> {
  req: Request;
  user: UserRecord;
  params: P;
  /** سجّل التعديل بالتدقيق (قبل وبعد). إذا ما استدعيته على طلب تعديل، الحارس بيسجّل سطر عام. */
  audit: (entity: string, entityId: string | null, before: unknown, after: unknown) => void;
}

export async function currentUserFromRequest(req: Request): Promise<UserRecord | null> {
  await ensureHydrated();
  const token = parseCookies(req.headers.get("cookie"))[SESSION_COOKIE];
  const s = readSession(token, getSecret());
  if (!s) return null;
  const u = getUser(s.sub);
  return u && u.active ? u : null;
}

type RouteCtx<P> = { params: Promise<P> };

// نقاط بدها دخول بس (مثل «مين أنا»)، بلا إجراء محدد. استعمالها نادر ومقصود.
export function guardAuthenticated(handler: (ctx: { req: Request; user: UserRecord }) => Promise<Response> | Response) {
  return async (req: Request): Promise<Response> => {
    const user = await currentUserFromRequest(req);
    if (!user) return apiError(401, "unauthenticated", "لازم تسجّل دخول أول");
    const res = await handler({ req, user });
    await drain();
    return res;
  };
}

export function guard<P = Record<string, never>>(
  action: Action,
  handler: (ctx: GuardContext<P>) => Promise<Response> | Response,
) {
  return async (req: Request, routeCtx?: RouteCtx<P>): Promise<Response> => {
    const user = await currentUserFromRequest(req);
    if (!user) return apiError(401, "unauthenticated", "لازم تسجّل دخول أول");
    if (!can(user.role, action)) return apiError(403, "forbidden", "ما عندك صلاحية لهالإجراء");

    let audited = false;
    const audit: GuardContext<P>["audit"] = (entity, entityId, before, after) => {
      audited = true;
      recordAudit({ actorId: user.sub, action, entity, entityId, before, after });
    };
    const params = (routeCtx ? await routeCtx.params : {}) as P;
    const res = await handler({ req, user, params, audit });

    const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method.toUpperCase());
    if (mutating && !audited && res.status < 400) {
      recordAudit({
        actorId: user.sub,
        action,
        entity: new URL(req.url).pathname,
        entityId: null,
        before: null,
        after: { method: req.method, status: res.status },
      });
    }
    await drain(); // الكتابات المعلّقة بالقاعدة (تدقيق ومستخدمين) لازم تخلص قبل الرد
    return res;
  };
}
