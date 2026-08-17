import { describe, it, expect, beforeAll } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { verifyAppToken } from "../src/app_sso";
import { verifySession } from "../src/session";
import { makeEnv, loggedInCookie } from "./helpers_app_sso";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("/auth/app/start", () => {
  it("400s a non-allowlisted return", async () => {
    const env = await makeEnv();
    const r = await worker.fetch(new Request("https://x/auth/app/start?app=dsvisual&return=https://evil/x"), env);
    expect(r.status).toBe(400);
  });
  it("logged in -> 302 to <return>#mtoken with a verifiable token", async () => {
    const env = await makeEnv();
    const cookie = await loggedInCookie(env, "S123");
    const r = await worker.fetch(new Request(
      "https://x/auth/app/start?app=dsvisual&return=https://skhuang.github.io/dsvisual/index.html",
      { headers: { Cookie: cookie } }), env);
    expect(r.status).toBe(302);
    const loc = r.headers.get("Location")!;
    expect(loc.startsWith("https://skhuang.github.io/dsvisual/index.html#mtoken=")).toBe(true);
    const tok = decodeURIComponent(loc.split("#mtoken=")[1]);
    expect(await verifyAppToken(env, tok)).toMatchObject({ sub: "S123", aud: "dsvisual" });
  });
  it("not logged in -> renders the login chooser and stashes app_return", async () => {
    const env = await makeEnv();
    const r = await worker.fetch(new Request(
      "https://x/auth/app/start?app=dsvisual&return=https://skhuang.github.io/dsvisual/"), env);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain('href="/auth/nycu/start');
    expect(body).toContain('href="/auth/github/login');
    expect(body).toContain('href="/auth/google/login');
    const sc = r.headers.get("Set-Cookie")!;
    expect(sc).toContain("maccount_session");
    // the stashed pre-login session carries app_return
    const m = sc.match(/maccount_session=([^;]+)/)!;
    const s = await verifySession(m[1], env.SESSION_SECRET, Date.now());
    expect(s?.app_return).toMatchObject({ app: "dsvisual" });
  });
});
