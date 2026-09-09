import { describe, it, expect } from "vitest";
import { csAuthorizeUrl, exchangeCsCode, fetchCsUser, type CsConfig } from "../src/oauth/cs";

const cfg: CsConfig = {
  authorizeUrl: "https://oauth.cs.nycu.edu.tw/oauth/authorize",
  tokenUrl: "https://oauth.cs.nycu.edu.tw/oauth/token",
  userinfoUrl: "https://oauth.cs.nycu.edu.tw/oauth/userinfo",
  clientId: "cid",
  clientSecret: "csecret",
  scope: "openid profile csid email",
};

function jsonFetcher(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
}

describe("cs oauth", () => {
  it("builds an authorization-code authorize url", () => {
    const u = new URL(csAuthorizeUrl(cfg, "https://api/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://oauth.cs.nycu.edu.tw/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile csid email");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api/cb");
  });

  it("exchanges code for an access token", async () => {
    const tok = await exchangeCsCode(cfg, "x", "https://api/cb", jsonFetcher({ access_token: "cs_tok" }));
    expect(tok).toBe("cs_tok");
  });

  it("maps userinfo to sub + student_id + account + name", async () => {
    const u = await fetchCsUser(cfg, "cs_tok", jsonFetcher({ sub: "oidc-sub-1", studentId: "0856001", csid: "alice", name: "王小明" }));
    expect(u).toEqual({ sub: "oidc-sub-1", student_id: "0856001", account: "alice", name: "王小明" });
  });

  it("throws when the student id claim is missing", async () => {
    await expect(fetchCsUser(cfg, "t", jsonFetcher({ sub: "s", csid: "a" }))).rejects.toThrow();
  });
});
