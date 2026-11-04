import { beforeEach, describe, expect, it } from "vitest";
import { guard } from "../src/lib/api-guard";
import { listAudit, resetAuditForTests } from "../src/lib/audit";
import { SESSION_COOKIE, createSession } from "../src/lib/session";
import { ensureUser, resetUsersForTests, setRole } from "../src/lib/users";

const SECRET = "s".repeat(40);

function req(method: string, sub?: string, body?: unknown) {
  const headers = new Headers({ "content-type": "application/json" });
  if (sub) headers.set("cookie", `${SESSION_COOKIE}=${encodeURIComponent(createSession(sub, sub, SECRET))}`);
  return new Request("http://localhost/api/x", { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

beforeEach(() => {
  process.env.AUTH_SECRET = SECRET;
  resetUsersForTests();
  resetAuditForTests();
  ensureUser("boss", "المالك", "boss");
  ensureUser("view", "مشاهد");
  ensureUser("sharia1", "شرعي");
  setRole("sharia1", "sharia");
});

const handler = guard("research.start", async () => Response.json({ ok: true }));
const decide = guard("candidate.watch_reject", async ({ audit }) => {
  audit("Candidate", "c1", { status: "scanned" }, { status: "rejected", apiToken: "SECRET-VALUE" });
  return Response.json({ ok: true });
});

describe("حارس الـ API", () => {
  it("بلا دخول: 401 بالعربي", async () => {
    const res = await handler(req("POST"));
    expect(res.status).toBe(401);
    expect((await res.json()).error.message).toContain("تسجّل دخول");
  });

  it("«مشاهد» ما بيقدر يقرّر: 403", async () => {
    expect((await handler(req("POST", "view"))).status).toBe(403);
    expect((await decide(req("POST", "view"))).status).toBe(403);
  });

  it("المراجع الشرعي ما بيبدأ بحث ولا بيرفض مرشح", async () => {
    expect((await handler(req("POST", "sharia1"))).status).toBe(403);
    expect((await decide(req("POST", "sharia1"))).status).toBe(403);
  });

  it("المالك بيمرّ", async () => {
    expect((await handler(req("POST", "boss"))).status).toBe(200);
  });

  it("مستخدم موقوف أو رمز مزوّر: 401", async () => {
    setRole("view", "viewer", false);
    expect((await handler(req("POST", "view"))).status).toBe(401);
    const bad = new Request("http://localhost/api/x", { headers: { cookie: `${SESSION_COOKIE}=garbage` } });
    expect((await handler(bad)).status).toBe(401);
  });

  it("كل تعديل بيظهر بالتدقيق، والأسرار محجوبة", async () => {
    await decide(req("POST", "boss"));
    const [e] = listAudit(1);
    expect(e).toMatchObject({ actorId: "boss", entity: "Candidate", entityId: "c1" });
    expect(JSON.stringify(e.after)).not.toContain("SECRET-VALUE");
    expect(e.before).toEqual({ status: "scanned" });
  });

  it("طلب تعديل بلا تسجيل صريح بيترك سطر عام، والقراءة لا", async () => {
    await handler(req("POST", "boss"));
    expect(listAudit(1)[0]).toMatchObject({ actorId: "boss", action: "research.start" });
    const before = listAudit(100).length;
    await handler(req("GET", "boss"));
    expect(listAudit(100).length).toBe(before);
  });

  it("الرفض ما بيسجّل تدقيق", async () => {
    const before = listAudit(100).length;
    await handler(req("POST", "view"));
    expect(listAudit(100).length).toBe(before);
  });
});
