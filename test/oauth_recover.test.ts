import { describe, it, expect, beforeAll } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { signSession, setCookie, SESSION_COOKIE } from "../src/session";
import { makeEnv } from "./helpers_app_sso";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });

const RETURN = "https://skhuang.github.io/dsvisual/";
async function cookieFor(testEnv: any, data: any): Promise<string> {
  return `${SESSION_COOKIE}=` + (setCookie(await signSession(data, testEnv.SESSION_SECRET)).match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))![1]);
}

describe("OAuth callback graceful retry on state mismatch", () => {
  // The real failure case: the chooser cookie (has app_return, no gostate) is
  // sent to /auth/google/callback -> mismatch -> bounce back to the chooser.
  it("google: session has app_return but wrong/missing gostate -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/google/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc).toContain("/auth/app/start?app=dsvisual");
    expect(loc).toContain("return=" + encodeURIComponent(RETURN));
  });

  it("github: app_return present, gstate mismatch -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, gstate: "OTHER", app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/github/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("/auth/app/start?app=dsvisual");
  });

  it("nycu: app_return present, nstate mismatch -> 302 to /auth/app/start", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, nstate: "OTHER", app_return: { app: "dsvisual", return: RETURN } });
    const r = await worker.fetch(new Request(
      "https://api/auth/nycu/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("/auth/app/start?app=dsvisual");
  });

  it("no session / no app_return -> 302 to done page with reason=login_retry, not 400", async () => {
    const testEnv = await makeEnv();
    const r = await worker.fetch(new Request("https://api/auth/google/callback?state=STALE&code=abc"), testEnv);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc).toContain("status=err");
    expect(loc).toContain("reason=login_retry");
  });

  it("app_return present but NOT allowlisted -> falls back to done page (no open redirect)", async () => {
    const testEnv = await makeEnv();
    const cookie = await cookieFor(testEnv, { exp: Date.now() + 60000, app_return: { app: "dsvisual", return: "https://evil.example/" } });
    const r = await worker.fetch(new Request(
      "https://api/auth/google/callback?state=STALE&code=abc", { headers: { Cookie: cookie } }), testEnv);
    expect(r.status).toBe(302);
    expect(r.headers.get("Location")!).toContain("reason=login_retry");
  });
});
