import { ROLE_LABELS_AR } from "@/core/permissions";
import { guardAuthenticated } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export const GET = guardAuthenticated(({ user }) =>
  Response.json({ sub: user.sub, name: user.name, role: user.role, roleLabel: ROLE_LABELS_AR[user.role] }),
);
