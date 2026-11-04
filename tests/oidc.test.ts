import { describe, expect, it } from "vitest";
import { buildAuthUrl, configFromEnv, exchangeCode } from "../src/lib/oidc";

const cfg = { issuer: "https://id.example", clientId: "cid", clientSecret: "csecret", redirectUri: "https://s1.example/api/auth/callback" };

function fakeFetch(calls: { url: string; init?: RequestInit }[] = [], tokenOk = true): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/.well-known/openid-configuration")) {
      return Response.json({
        authorization_endpoint: "https://id.example/auth",
        token_endpoint: "https://id.example/token",
        userinfo_endpoint: "https://id.example/userinfo",
      });
    }
    if (url.endsWith("/token")) return tokenOk ? Response.json({ access_token: "tok" }) : new Response("no", { status: 400 });
    if (url.endsWith("/userinfo")) return Response.json({ sub: "abc", name: "أحمد" });
    return new Response("?", { status: 404 });
  }) as typeof fetch;
}

describe("الهوية المشتركة (OIDC)", () => {
  it("الإعدادات من .env، وناقصة = ما في دخول", () => {
    expect(configFromEnv({ AUTH_OIDC_ISSUER: "https://i/", AUTH_OIDC_CLIENT_ID: "a", AUTH_OIDC_CLIENT_SECRET: "b", APP_URL: "https://s1/" } as never)).toMatchObject({
      issuer: "https://i",
      redirectUri: "https://s1/api/auth/callback",
    });
    expect(configFromEnv({} as never)).toBeNull();
  });

  it("رابط الدخول فيه state وPKCE", async () => {
    const { url, state } = await buildAuthUrl(cfg, fakeFetch());
    const u = new URL(url);
    expect(u.searchParams.get("state")).toBe(state.state);
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBeTruthy();
    expect(u.searchParams.get("client_secret")).toBeNull();
  });

  it("تبادل الرمز بيرجع الهوية، والسر ما بيطلع للمتصفح", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const saved = { state: "s", verifier: "v" };
    const who = await exchangeCode(cfg, saved, { code: "c", state: "s" }, fakeFetch(calls));
    expect(who).toEqual({ sub: "abc", name: "أحمد" });
    expect(String(calls.find((c) => c.url.endsWith("/token"))?.init?.body)).toContain("code_verifier=v");
  });

  it("state غلط أو رمز مرفوض = فشل", async () => {
    await expect(exchangeCode(cfg, { state: "s", verifier: "v" }, { code: "c", state: "other" }, fakeFetch())).rejects.toThrow();
    await expect(exchangeCode(cfg, { state: "s", verifier: "v" }, { code: "c", state: "s" }, fakeFetch([], false))).rejects.toThrow();
    await expect(exchangeCode(cfg, { state: "s", verifier: "v" }, { code: "", state: "s" }, fakeFetch())).rejects.toThrow();
  });
});
