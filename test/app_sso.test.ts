import { describe, it, expect } from "vitest";
import { allowedReturn, allowedOrigin, mintAppToken, verifyAppToken } from "../src/app_sso";

const env: any = { APP_ALLOWLIST: "dsvisual=https://skhuang.github.io/dsvisual", APP_TOKEN_SECRET: "s3cret" };

describe("app_sso helpers", () => {
  it("allowedReturn only accepts the app's prefix", () => {
    expect(allowedReturn(env, "dsvisual", "https://skhuang.github.io/dsvisual/index.html")).toBe(true);
    expect(allowedReturn(env, "dsvisual", "https://evil.example/x")).toBe(false);
    expect(allowedReturn(env, "unknown", "https://skhuang.github.io/dsvisual")).toBe(false);
  });
  it("allowedOrigin matches an allowlisted return prefix's origin", () => {
    expect(allowedOrigin(env, "https://skhuang.github.io")).toBe(true);
    expect(allowedOrigin(env, "https://evil.example")).toBe(false);
  });
  it("mint/verify roundtrips and binds aud", async () => {
    const tok = await mintAppToken(env, { sub: "S123", providers: { github: true, google: false }, aud: "dsvisual" });
    const out = await verifyAppToken(env, tok);
    expect(out).toMatchObject({ sub: "S123", aud: "dsvisual", providers: { github: true, google: false } });
  });
  it("rejects a tampered token, a wrong secret, and an expired token", async () => {
    const tok = await mintAppToken(env, { sub: "S1", providers: { github: false, google: false }, aud: "dsvisual" });
    expect(await verifyAppToken(env, tok + "x")).toBeNull();
    expect(await verifyAppToken({ ...env, APP_TOKEN_SECRET: "other" }, tok)).toBeNull();
    const expired = await mintAppToken(env, { sub: "S1", providers: { github: false, google: false }, aud: "dsvisual", _iat: 0 } as any);
    expect(await verifyAppToken(env, expired)).toBeNull();
  });
});
