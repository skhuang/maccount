import { describe, it, expect } from "vitest";
import { allowedReturn, allowedOrigin, mintAppToken, verifyAppToken } from "../src/app_sso";

const env: any = { APP_ALLOWLIST: "dsvisual=https://skhuang.github.io/dsvisual", APP_TOKEN_SECRET: "s3cret" };

describe("app_sso helpers", () => {
  it("allowedReturn only accepts the app's prefix", () => {
    expect(allowedReturn(env, "dsvisual", "https://skhuang.github.io/dsvisual/index.html")).toBe(true);
    expect(allowedReturn(env, "dsvisual", "https://evil.example/x")).toBe(false);
    expect(allowedReturn(env, "unknown", "https://skhuang.github.io/dsvisual")).toBe(false);
  });
  it("allowedReturn requires an exact match or a '/' boundary (not just a string prefix)", () => {
    // A sibling path that merely starts with the same characters must NOT match.
    expect(allowedReturn(env, "dsvisual", "https://skhuang.github.io/dsvisual-evil/x")).toBe(false);
    // The exact prefix, and any path under it, still match.
    expect(allowedReturn(env, "dsvisual", "https://skhuang.github.io/dsvisual")).toBe(true);
    expect(allowedReturn(env, "dsvisual", "https://skhuang.github.io/dsvisual/index.html")).toBe(true);
  });
  it("allowedOrigin matches an allowlisted return prefix's origin", () => {
    expect(allowedOrigin(env, "https://skhuang.github.io")).toBe(true);
    expect(allowedOrigin(env, "https://evil.example")).toBe(false);
  });

  it("supports multiple registered apps (dsvisual + stvisual2)", () => {
    const multi: any = {
      APP_ALLOWLIST:
        "dsvisual=https://skhuang.github.io/dsvisual;stvisual2=https://skhuang.github.io/stvisual2",
      APP_TOKEN_SECRET: "s3cret",
    };
    // each app's own return is accepted, at an exact match or a '/' boundary
    expect(allowedReturn(multi, "stvisual2", "https://skhuang.github.io/stvisual2")).toBe(true);
    expect(allowedReturn(multi, "stvisual2", "https://skhuang.github.io/stvisual2/?explorer=graph-coverage")).toBe(true);
    expect(allowedReturn(multi, "dsvisual", "https://skhuang.github.io/dsvisual/index.html")).toBe(true);
    // an app cannot return to another app's prefix, and no prefix-boundary bypass
    expect(allowedReturn(multi, "stvisual2", "https://skhuang.github.io/dsvisual")).toBe(false);
    expect(allowedReturn(multi, "stvisual2", "https://skhuang.github.io/stvisual2-evil/x")).toBe(false);
    // the shared Pages origin is allowed for CORS on /api/app/verify
    expect(allowedOrigin(multi, "https://skhuang.github.io")).toBe(true);
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
