import { describe, it, expect } from "vitest";
import { githubAuthorizeUrl, exchangeGithubCode, fetchGithubUser } from "../src/oauth/github";
import {
  googleAuthorizeUrl, exchangeGoogleCode, fetchGoogleUser, refreshGoogleAccessToken,
  DEFAULT_GOOGLE_SCOPE,
} from "../src/oauth/google";
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

describe("google oauth", () => {
  it("builds authorize url with offline access, forced consent + the given scope", () => {
    const u = new URL(googleAuthorizeUrl("cid", "https://api.example/cb", "st8", DEFAULT_GOOGLE_SCOPE));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("client_id")).toBe("cid");
    expect(u.searchParams.get("redirect_uri")).toBe("https://api.example/cb");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe(DEFAULT_GOOGLE_SCOPE);
    expect(u.searchParams.get("scope")).toContain("drive.file");
    expect(u.searchParams.get("state")).toBe("st8");
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent select_account");
  });

  it("login mode (offline:false) skips access_type/consent, keeps account chooser", () => {
    const u = new URL(googleAuthorizeUrl("cid", "https://api.example/cb", "st8", "openid email", { offline: false }));
    expect(u.searchParams.get("scope")).toBe("openid email");
    expect(u.searchParams.get("access_type")).toBe(null);
    expect(u.searchParams.get("prompt")).toBe("select_account");
  });

  it("exchanges code for access + refresh token", async () => {
    const tokens = await exchangeGoogleCode(
      { clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://api/cb" },
      jsonFetcher({ access_token: "g_tok", refresh_token: "r_tok", scope: "openid email", expires_in: 3599 }),
    );
    expect(tokens).toEqual({ accessToken: "g_tok", refreshToken: "r_tok", scope: "openid email", expiresIn: 3599 });
  });

  it("tolerates a token response with no refresh token", async () => {
    const tokens = await exchangeGoogleCode(
      { clientId: "c", clientSecret: "s", code: "x", redirectUri: "https://api/cb" },
      jsonFetcher({ access_token: "g_tok" }),
    );
    expect(tokens.accessToken).toBe("g_tok");
    expect(tokens.refreshToken).toBe(null);
  });

  it("refreshes an access token from a refresh token", async () => {
    const got = await refreshGoogleAccessToken(
      { clientId: "c", clientSecret: "s", refreshToken: "r_tok" },
      jsonFetcher({ access_token: "fresh_tok", expires_in: 3599 }),
    );
    expect(got).toEqual({ accessToken: "fresh_tok", expiresIn: 3599 });
  });

  it("fetches google sub + email", async () => {
    const user = await fetchGoogleUser("g_tok", jsonFetcher({ sub: "108x", email: "a@gmail.com" }));
    expect(user).toEqual({ sub: "108x", email: "a@gmail.com" });
  });

  it("throws when userinfo lacks sub/email", async () => {
    await expect(fetchGoogleUser("g_tok", jsonFetcher({ sub: "108x" }))).rejects.toThrow(/missing/);
  });
});

describe("nycu oauth", () => {
  it("builds authorize url", () => {
    const u = new URL(nycuAuthorizeUrl(nycuCfg, "https://api/cb", "st8"));
    expect(u.origin + u.pathname).toBe("https://id.nycu.edu.tw/o/authorize/");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("scope")).toBe("openid profile");
    expect(u.searchParams.get("prompt")).toBe(null); // normal login: SSO, no re-prompt
  });

  it("forceLogin adds prompt=login (logout→switch account)", () => {
    const u = new URL(nycuAuthorizeUrl(nycuCfg, "https://api/cb", "st8", true));
    expect(u.searchParams.get("prompt")).toBe("login");
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
