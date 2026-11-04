import { apiError, guard } from "@/lib/api-guard";
import { UserError, listUsers, setRole } from "@/lib/users";

export const dynamic = "force-dynamic";

export const GET = guard("users.manage", () => Response.json({ users: listUsers() }));

export const PATCH = guard("users.manage", async ({ req, audit }) => {
  const body = (await req.json().catch(() => null)) as { sub?: string; role?: string; active?: boolean } | null;
  if (!body || typeof body.sub !== "string") return apiError(400, "bad_request", "الطلب ناقص");
  try {
    const { user, before } = setRole(body.sub, body.role, typeof body.active === "boolean" ? body.active : undefined);
    audit("User", user.sub, before, { role: user.role, active: user.active });
    return Response.json({ user });
  } catch (e) {
    if (e instanceof UserError) return apiError(e.code === "not_found" ? 404 : 400, e.code, e.message);
    throw e;
  }
});
