import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertBinding,
  listBindings,
  deleteBinding,
  GithubConflictError,
} from "../src/db/bindings";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM bindings").run();
});

const base = {
  nycu_id: "0856001",
  nycu_name: "王小明",
  github_id: 111,
  github_login: "ming",
  now: "2026-06-16T00:00:00.000Z",
};

describe("bindings", () => {
  it("inserts then lists", async () => {
    await upsertBinding(env.DB, base);
    const rows = await listBindings(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].github_login).toBe("ming");
  });

  it("re-binding the same nycu_id updates github fields", async () => {
    await upsertBinding(env.DB, base);
    await upsertBinding(env.DB, { ...base, github_id: 222, github_login: "ming2", now: "2026-06-17T00:00:00.000Z" });
    const rows = await listBindings(env.DB);
    expect(rows).toHaveLength(1);
    expect(rows[0].github_id).toBe(222);
    expect(rows[0].updated_at).toBe("2026-06-17T00:00:00.000Z");
  });

  it("throws GithubConflictError when github_id belongs to another nycu_id", async () => {
    await upsertBinding(env.DB, base);
    await expect(
      upsertBinding(env.DB, { ...base, nycu_id: "0856002", nycu_name: "李小華" }),
    ).rejects.toBeInstanceOf(GithubConflictError);
  });

  it("deletes a binding", async () => {
    await upsertBinding(env.DB, base);
    await deleteBinding(env.DB, base.nycu_id);
    expect(await listBindings(env.DB)).toHaveLength(0);
  });
});
