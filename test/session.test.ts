import { describe, it, expect } from "vitest";
import { signSession, verifySession, type SessionData } from "../src/session";
import { randomState } from "../src/util";

const SECRET = "test-secret";

describe("session", () => {
  it("round-trips a signed session", async () => {
    const data: SessionData = { exp: Date.now() + 60000, purpose: "bind", nstate: "abc" };
    const token = await signSession(data, SECRET);
    const out = await verifySession(token, SECRET, Date.now());
    expect(out).toEqual(data);
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession({ exp: Date.now() + 60000 }, SECRET);
    const tampered = "x" + token.slice(1);
    expect(await verifySession(tampered, SECRET, Date.now())).toBeNull();
  });

  it("rejects an expired session", async () => {
    const token = await signSession({ exp: Date.now() - 1 }, SECRET);
    expect(await verifySession(token, SECRET, Date.now())).toBeNull();
  });

  it("rejects wrong secret", async () => {
    const token = await signSession({ exp: Date.now() + 60000 }, SECRET);
    expect(await verifySession(token, "other", Date.now())).toBeNull();
  });
});

describe("randomState", () => {
  it("returns 32 hex chars and varies", () => {
    const a = randomState();
    const b = randomState();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(b);
  });
});
