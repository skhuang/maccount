import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { listStaff, addStaff, removeStaff, isStaffMember, isStaffAnywhere } from "../src/db/staff";

const C = "ds-2026";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM staff").run();
});

describe("staff db", () => {
  it("adds, lists, checks membership, removes (per course)", async () => {
    await addStaff(env.DB, C, "TA001", "AT9336", "t1");
    await addStaff(env.DB, C, "TA002", "AT9336", "t2");
    expect((await listStaff(env.DB, C)).map((s) => s.nycu_id)).toEqual(["TA001", "TA002"]);
    expect(await isStaffMember(env.DB, C, "TA001")).toBe(true);
    expect(await isStaffMember(env.DB, C, "nobody")).toBe(false);
    await removeStaff(env.DB, C, "TA001");
    expect(await isStaffMember(env.DB, C, "TA001")).toBe(false);
  });

  it("add is idempotent (re-adding keeps the original)", async () => {
    await addStaff(env.DB, C, "TA001", "AT9336", "t1");
    await addStaff(env.DB, C, "TA001", "someoneelse", "t2");
    const rows = await listStaff(env.DB, C);
    expect(rows).toHaveLength(1);
    expect(rows[0].added_by).toBe("AT9336"); // ON CONFLICT DO NOTHING
  });

  it("staff is scoped per course; isStaffAnywhere spans courses", async () => {
    await addStaff(env.DB, "ds-2026", "TA001", "AT9336", "t1");
    await addStaff(env.DB, "ds-2027", "TA002", "AT9336", "t2");
    // course scoping: a TA of one course is not a member of the other
    expect(await isStaffMember(env.DB, "ds-2026", "TA002")).toBe(false);
    expect((await listStaff(env.DB, "ds-2026")).map((s) => s.nycu_id)).toEqual(["TA001"]);
    expect((await listStaff(env.DB, "ds-2027")).map((s) => s.nycu_id)).toEqual(["TA002"]);
    // same id may be staff of two courses independently
    await addStaff(env.DB, "ds-2027", "TA001", "AT9336", "t3");
    expect(await isStaffMember(env.DB, "ds-2027", "TA001")).toBe(true);
    // access gate: staff of any course
    expect(await isStaffAnywhere(env.DB, "TA002")).toBe(true);
    expect(await isStaffAnywhere(env.DB, "nobody")).toBe(false);
  });
});
