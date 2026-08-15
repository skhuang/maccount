// test/app_verify.test.ts
import { describe, it, expect } from "vitest";
import worker from "../src/index";
import { mintAppToken } from "../src/app_sso";
import { makeEnv } from "./helpers_app_sso";

const ORIGIN = "https://skhuang.github.io";

describe("/api/app/verify", () => {
  it("exchanges a valid token for identity, with CORS for the allowlisted origin", async () => {
    const env = await makeEnv();
    const tok = await mintAppToken(env, { sub: "S7", providers: { github: true, google: false }, aud: "dsvisual" });
    const r = await worker.fetch(new Request("https://x/api/app/verify",
      { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ token: tok }) }), env);
    expect(r.status).toBe(200);
    expect(r.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    expect(await r.json()).toMatchObject({ student_id: "S7", providers: { github: true, google: false } });
  });
  it("401s a garbage/expired token", async () => {
    const env = await makeEnv();
    const r = await worker.fetch(new Request("https://x/api/app/verify",
      { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ token: "nope" }) }), env);
    expect(r.status).toBe(401);
  });
  it("OPTIONS preflight returns CORS for the allowlisted origin, none for others", async () => {
    const env = await makeEnv();
    const ok = await worker.fetch(new Request("https://x/api/app/verify", { method: "OPTIONS", headers: { Origin: ORIGIN } }), env);
    expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(ORIGIN);
    const bad = await worker.fetch(new Request("https://x/api/app/verify", { method: "OPTIONS", headers: { Origin: "https://evil" } }), env);
    expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});
