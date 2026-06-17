import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { listStaff, addStaff, removeStaff, isStaffMember } from "../src/db/staff";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM staff").run();
});

describe("staff db", () => {
  it("adds, lists, checks membership, removes", async () => {
    await addStaff(env.DB, "TA001", "AT9336", "t1");
    await addStaff(env.DB, "TA002", "AT9336", "t2");
    expect((await listStaff(env.DB)).map((s) => s.nycu_id)).toEqual(["TA001", "TA002"]);
    expect(await isStaffMember(env.DB, "TA001")).toBe(true);
    expect(await isStaffMember(env.DB, "nobody")).toBe(false);
    await removeStaff(env.DB, "TA001");
    expect(await isStaffMember(env.DB, "TA001")).toBe(false);
  });

  it("add is idempotent (re-adding keeps the original)", async () => {
    await addStaff(env.DB, "TA001", "AT9336", "t1");
    await addStaff(env.DB, "TA001", "someoneelse", "t2");
    const rows = await listStaff(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].added_by).toBe("AT9336"); // ON CONFLICT DO NOTHING
  });
});
