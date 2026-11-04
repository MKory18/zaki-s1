import { describe, expect, it } from "vitest";
import { createSession, parseCookies, readSession, sign, verify } from "../src/lib/session";

const SECRET = "x".repeat(40);

describe("الجلسة", () => {
  it("بتنكتب وبتنقرا", () => {
    const t = createSession("u1", "أحمد", SECRET, 1000);
    expect(readSession(t, SECRET, 1001)).toMatchObject({ sub: "u1", name: "أحمد" });
  });

  it("بتنرفض لما تنتهي", () => {
    const t = createSession("u1", "أحمد", SECRET, 1000);
    expect(readSession(t, SECRET, 1000 + 60 * 60 * 13)).toBeNull();
  });

  it("بتنرفض لو اتعدّلت أو بسر ثاني", () => {
    const t = createSession("u1", "أحمد", SECRET, 1000);
    const [body, mac] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "owner", name: "x", exp: 99999999999 })).toString("base64url");
    expect(readSession(`${forged}.${mac}`, SECRET, 1001)).toBeNull();
    expect(readSession(t, "y".repeat(40), 1001)).toBeNull();
    expect(verify(`${body}.${mac}.extra`, SECRET)).toBeNull();
    expect(verify("", SECRET)).toBeNull();
    expect(verify(sign({ a: 1 }, SECRET), SECRET)).toEqual({ a: 1 });
  });

  it("بيقرا الكوكيات", () => {
    expect(parseCookies("a=1; s1_session=abc%3D; b=2")).toEqual({ a: "1", s1_session: "abc=", b: "2" });
    expect(parseCookies(null)).toEqual({});
  });
});
