import { describe, it, expect, beforeAll, afterEach, vi } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { verifySession, SESSION_COOKIE } from "../src/session";
import { verifyAppToken } from "../src/app_sso";
import { makeEnv } from "./helpers_app_sso";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// Pulls the maccount_session cookie's token value out of a Set-Cookie header,
// e.g. "maccount_session=<token>; HttpOnly; ..." -> "<token>".
function cookieToken(setCookieHeader: string): string {
  const m = setCookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!m) throw new Error(`no ${SESSION_COOKIE} in Set-Cookie: ${setCookieHeader}`);
  return m[1];
}

function cookieHeader(token: string): HeadersInit {
  return { Cookie: `${SESSION_COOKIE}=${token}` };
}

// Regression test for the bug where /auth/app/start's stashed `app_return` was
// dropped by startNycu (it built a brand-new session instead of reading the
// existing pre-login cookie), so a fresh (not-logged-in) SSO login never made
// it back to the relying app. Walks the real, un-authenticated path end to end:
//   /auth/app/start (no session) -> login chooser -> /auth/nycu/start -> /auth/nycu/callback
describe("full not-logged-in SSO flow: /auth/app/start -> nycu login -> back to app", () => {
  it("carries app_return through startNycu and delivers an mtoken on the NYCU callback", async () => {
    const testEnv = await makeEnv();
    const RETURN = "https://skhuang.github.io/dsvisual/index.html";

    // Step 1: GET /auth/app/start with no session at all -> the login chooser
    // (NYCU / GitHub / Google), not an immediate redirect to NYCU.
    const r1 = await worker.fetch(
      new Request(`https://api.example/auth/app/start?app=dsvisual&return=${encodeURIComponent(RETURN)}`),
      testEnv,
    );
    expect(r1.status).toBe(200);
    const chooserBody = await r1.text();
    expect(chooserBody).toContain('href="/auth/nycu/start');
    expect(chooserBody).toContain('href="/auth/github/login');
    expect(chooserBody).toContain('href="/auth/google/login');
    const preLoginSetCookie = r1.headers.get("Set-Cookie");
    expect(preLoginSetCookie).toContain(SESSION_COOKIE);
    const preLoginToken = cookieToken(preLoginSetCookie!);
    // Sanity: the pre-login session really does carry app_return.
    const preLoginSession = await verifySession(preLoginToken, testEnv.SESSION_SECRET, Date.now());
    expect(preLoginSession?.app_return).toEqual({ app: "dsvisual", return: RETURN });

    // Step 2: follow the chooser's NYCU button (the pre-login cookie rides
    // along). Before the original fix, this built a brand-new session and
    // silently dropped app_return.
    const r2 = await worker.fetch(
      new Request("https://api.example/auth/nycu/start", { headers: cookieHeader(preLoginToken) }),
      testEnv,
    );
    expect(r2.status).toBe(302);
    expect(r2.headers.get("Location")).toContain("id.nycu.edu.tw/o/authorize/");
    const nycuStateSetCookie = r2.headers.get("Set-Cookie");
    expect(nycuStateSetCookie).toContain(SESSION_COOKIE);
    const nycuStateToken = cookieToken(nycuStateSetCookie!);
    const nycuStateSession = await verifySession(nycuStateToken, testEnv.SESSION_SECRET, Date.now());
    // The regression assertion: app_return must have survived startNycu.
    expect(nycuStateSession?.app_return).toEqual({ app: "dsvisual", return: RETURN });
    expect(nycuStateSession?.nstate).toBeTruthy();

    // Step 3: simulate NYCU's redirect back to /auth/nycu/callback (stub the
    // token + userinfo exchange the way test/worker.test.ts does).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("token"))
          return new Response(JSON.stringify({ access_token: "n_tok" }), {
            headers: { "Content-Type": "application/json" },
          });
        return new Response(JSON.stringify({ username: "S123", name: "師" }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const r3 = await worker.fetch(
      new Request(
        `https://api.example/auth/nycu/callback?code=abc&state=${nycuStateSession!.nstate}`,
        { headers: cookieHeader(nycuStateToken) },
      ),
      testEnv,
    );
    expect(r3.status).toBe(302);
    const loc = r3.headers.get("Location")!;
    expect(loc.startsWith(`${RETURN}#mtoken=`)).toBe(true);
    const mtoken = decodeURIComponent(loc.split("#mtoken=")[1]);
    const claims = await verifyAppToken(testEnv, mtoken);
    expect(claims).toMatchObject({ sub: "S123", aud: "dsvisual" });
  });
});

// Same flow as above, but via the GitHub alternate-login button on the
// chooser instead of NYCU. Google shares the exact same startOAuthLogin +
// login-branch callback path (see githubCallback's `if (!session.nycu)`
// branch, mirrored by googleCallback), so this one GitHub walk exercises both.
describe("full not-logged-in SSO flow: /auth/app/start -> GitHub login -> back to app", () => {
  it("carries app_return through startOAuthLogin and delivers an mtoken on the GitHub callback", async () => {
    const testEnv = await makeEnv();
    const RETURN = "https://skhuang.github.io/dsvisual/index.html";

    // Seed a binding so the reverse GitHub-id lookup on the callback resolves.
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('S123','師',999,'octo','t','t')",
    ).run();

    // Step 1: GET /auth/app/start with no session -> the login chooser.
    const r1 = await worker.fetch(
      new Request(`https://api.example/auth/app/start?app=dsvisual&return=${encodeURIComponent(RETURN)}`),
      testEnv,
    );
    expect(r1.status).toBe(200);
    const preLoginSetCookie = r1.headers.get("Set-Cookie");
    expect(preLoginSetCookie).toContain(SESSION_COOKIE);
    const preLoginToken = cookieToken(preLoginSetCookie!);

    // Step 2: follow the chooser's GitHub button (the pre-login cookie, and
    // its app_return, ride along).
    const r2 = await worker.fetch(
      new Request("https://api.example/auth/github/login", { headers: cookieHeader(preLoginToken) }),
      testEnv,
    );
    expect(r2.status).toBe(302);
    expect(r2.headers.get("Location")).toContain("github.com/login/oauth/authorize");
    const ghStateSetCookie = r2.headers.get("Set-Cookie");
    expect(ghStateSetCookie).toContain(SESSION_COOKIE);
    const ghStateToken = cookieToken(ghStateSetCookie!);
    const ghStateSession = await verifySession(ghStateToken, testEnv.SESSION_SECRET, Date.now());
    // app_return must have survived the alternate-login leg too.
    expect(ghStateSession?.app_return).toEqual({ app: "dsvisual", return: RETURN });
    expect(ghStateSession?.gstate).toBeTruthy();
    expect(ghStateSession?.nycu).toBeUndefined(); // login mode, not bind mode

    // Step 3: simulate GitHub's redirect back to /auth/github/callback (stub
    // the token + user API exchange the way test/worker.test.ts does).
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes("access_token"))
          return new Response(JSON.stringify({ access_token: "gh_tok" }), {
            headers: { "Content-Type": "application/json" },
          });
        return new Response(JSON.stringify({ id: 999, login: "octo" }), {
          headers: { "Content-Type": "application/json" },
        });
      }),
    );
    const r3 = await worker.fetch(
      new Request(
        `https://api.example/auth/github/callback?code=abc&state=${ghStateSession!.gstate}`,
        { headers: cookieHeader(ghStateToken) },
      ),
      testEnv,
    );
    expect(r3.status).toBe(302);
    const loc = r3.headers.get("Location")!;
    expect(loc.startsWith(`${RETURN}#mtoken=`)).toBe(true);
    const mtoken = decodeURIComponent(loc.split("#mtoken=")[1]);
    const claims = await verifyAppToken(testEnv, mtoken);
    expect(claims).toMatchObject({ sub: "S123", aud: "dsvisual" });
  });
});
