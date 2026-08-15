import { describe, it, expect, beforeAll } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { postLoginDestination } from "../src/index";
import { verifyAppToken } from "../src/app_sso";
import { makeEnv } from "./helpers_app_sso";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

describe("postLoginDestination", () => {
  it("returns an app token redirect when app_return is set and allowed", async () => {
    const env = await makeEnv();
    const res = await postLoginDestination(env, "S9", { app: "dsvisual", return: "https://skhuang.github.io/dsvisual/" });
    expect(res!.status).toBe(302);
    const loc = res!.headers.get("Location")!;
    expect(loc.startsWith("https://skhuang.github.io/dsvisual/#mtoken=")).toBe(true);
    expect(await verifyAppToken(env, decodeURIComponent(loc.split("#mtoken=")[1]))).toMatchObject({ sub: "S9" });
  });
  it("ignores a tampered/non-allowlisted app_return (returns null)", async () => {
    const env = await makeEnv();
    expect(await postLoginDestination(env, "S9", { app: "dsvisual", return: "https://evil/x" })).toBeNull();
    expect(await postLoginDestination(env, "S9", undefined)).toBeNull();
  });
});
