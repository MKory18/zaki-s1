import { beforeEach, describe, expect, it } from "vitest";
import { ensureUser, getUser, listUsers, resetUsersForTests, setRole, UserError } from "../src/lib/users";
import { listAudit, resetAuditForTests } from "../src/lib/audit";

beforeEach(() => {
  resetUsersForTests();
  resetAuditForTests();
});

describe("المستخدمين", () => {
  it("الجديد بيدخل مشاهد، والمالك برقم الهوية من .env", () => {
    expect(ensureUser("a", "أ", "boss").role).toBe("viewer");
    expect(ensureUser("boss", "المالك", "boss").role).toBe("owner");
    expect(ensureUser("", "x", "").role).toBe("viewer");
  });

  it("إنشاء المستخدم بيتسجّل بالتدقيق", () => {
    ensureUser("a", "أ", "");
    expect(listAudit(1)[0]).toMatchObject({ action: "user.create", entityId: "a" });
  });

  it("تغيير الدور بيرجع القيم القديمة", () => {
    ensureUser("boss", "م", "boss");
    ensureUser("a", "أ", "boss");
    const r = setRole("a", "researcher");
    expect(r.before).toEqual({ role: "viewer", active: true });
    expect(getUser("a")?.role).toBe("researcher");
  });

  it("ما بينشال آخر مالك (لا تنزيل دور ولا إيقاف)", () => {
    ensureUser("boss", "م", "boss");
    expect(() => setRole("boss", "viewer")).toThrow(UserError);
    expect(() => setRole("boss", "owner", false)).toThrow(UserError);
    ensureUser("b", "ب", "boss");
    setRole("b", "owner");
    expect(setRole("boss", "viewer").user.role).toBe("viewer");
  });

  it("دور غلط أو مستخدم مجهول بيرفض", () => {
    ensureUser("a", "أ", "");
    expect(() => setRole("a", "god")).toThrow(UserError);
    expect(() => setRole("zzz", "viewer")).toThrow(UserError);
    expect(listUsers().length).toBe(1);
  });
});
