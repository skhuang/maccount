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
//   /auth/app/start (no session) -> /auth/nycu/start -> /auth/nycu/callback
describe("full not-logged-in SSO flow: /auth/app/start -> nycu login -> back to app", () => {
  it("carries app_return through startNycu and delivers an mtoken on the NYCU callback", async () => {
    const testEnv = await makeEnv();
    const RETURN = "https://skhuang.github.io/dsvisual/index.html";

    // Step 1: GET /auth/app/start with no session at all.
    const r1 = await worker.fetch(
      new Request(`https://api.example/auth/app/start?app=dsvisual&return=${encodeURIComponent(RETURN)}`),
      testEnv,
    );
    expect(r1.status).toBe(302);
    expect(r1.headers.get("Location")).toBe("/auth/nycu/start");
    const preLoginSetCookie = r1.headers.get("Set-Cookie");
    expect(preLoginSetCookie).toContain(SESSION_COOKIE);
    const preLoginToken = cookieToken(preLoginSetCookie!);
    // Sanity: the pre-login session really does carry app_return.
    const preLoginSession = await verifySession(preLoginToken, testEnv.SESSION_SECRET, Date.now());
    expect(preLoginSession?.app_return).toEqual({ app: "dsvisual", return: RETURN });

    // Step 2: feed that cookie into /auth/nycu/start. Before the fix, this
    // built a brand-new session and silently dropped app_return.
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
