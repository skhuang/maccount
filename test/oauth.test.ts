import { describe, it, expect } from "vitest";
import { githubAuthorizeUrl, exchangeGithubCode, fetchGithubUser } from "../src/oauth/github";
import { nycuAuthorizeUrl, exchangeNycuCode, fetchNycuUser, type NycuConfig } from "../src/oauth/nycu";
import { isAdmin } from "../src/env";

const nycuCfg: NycuConfig = {
  authorizeUrl: "https://id.nycu.edu.tw/o/authorize/",
  tokenUrl: "https://id.nycu.edu.tw/o/token/",
  userinfoUrl: "https://id.nycu.edu.tw/o/userinfo/",
  clientId: "ncid",
  clientSecret: "nsecret",
  scope: "openid profile",
};

function jsonFetcher(body: unknown, status = 200): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

describe("github oauth", () => {
  it("builds authorize url with read:user scope", () => {
    const u = new URL(githubAuthorizeUrl("cid", "https://api.example/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://github.com/login/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("scope")).toBe("read:user");
    expect(u.searchParams.get("state")).toBe("st8");
  });

  it("exchanges code for token", async () => {
    const token = await exchangeGithubCode(
      { clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://api/cb" },
      jsonFetcher({ access_token: "gh_tok" }),
    );
    expect(token).toBe("gh_tok");
  });

  it("fetches github user id + login", async () => {
    const user = await fetchGithubUser("gh_tok", jsonFetcher({ id: 42, login: "octo" }));
    expect(user).toEqual({ id: 42, login: "octo" });
  });
});

describe("nycu oauth", () => {
  it("builds authorize url", () => {
    const u = new URL(nycuAuthorizeUrl(nycuCfg, "https://api/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://id.nycu.edu.tw/o/authorize/");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile");
  });

  it("exchanges code for token", async () => {
    const token = await exchangeNycuCode(nycuCfg, "x", "https://api/cb", jsonFetcher({ access_token: "n_tok" }));
    expect(token).toBe("n_tok");
  });

  it("maps userinfo claims to id + name", async () => {
    const user = await fetchNycuUser(nycuCfg, "n_tok", jsonFetcher({ username: "0856001", name: "王小明" }));
    expect(user).toEqual({ id: "0856001", name: "王小明" });
  });
});

describe("isAdmin", () => {
  it("matches a comma-separated allowlist", () => {
    const env = { ADMIN_IDS: "0856001, admin2 " } as any;
    expect(isAdmin(env, "0856001")).toBe(true);
    expect(isAdmin(env, "admin2")).toBe(true);
    expect(isAdmin(env, "nope")).toBe(false);
  });
});
