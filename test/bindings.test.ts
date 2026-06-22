import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertBinding,
  upsertGoogleBinding,
  getGoogleTokenRow,
  listBindings,
  deleteBinding,
  getBinding,
  getBindingByGithubId,
  getBindingByGoogleSub,
  orgBindingView,
  GithubConflictError,
  GoogleConflictError,
} from "../src/db/bindings";
import { toCsv } from "../src/csv";
import type { BindingRow } from "../src/csv";

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

  it("reverse-looks-up a binding by github_id (sign-in with GitHub)", async () => {
    await upsertBinding(env.DB, base);
    expect((await getBindingByGithubId(env.DB, 111))?.nycu_id).toBe("0856001");
    expect(await getBindingByGithubId(env.DB, 999)).toBe(null);
  });

  it("reverse-looks-up a binding by google_sub (sign-in with Google)", async () => {
    await upsertGoogleBinding(env.DB, {
      nycu_id: "0856001", nycu_name: "王小明", google_sub: "108sub", google_email: "m@gmail.com",
      now: "2026-06-16T00:00:00.000Z",
    });
    expect((await getBindingByGoogleSub(env.DB, "108sub"))?.nycu_id).toBe("0856001");
    expect(await getBindingByGoogleSub(env.DB, "nope")).toBe(null);
  });
});

describe("google binding", () => {
  const g = {
    nycu_id: "0856001",
    nycu_name: "王小明",
    google_sub: "108sub",
    google_email: "ming@gmail.com",
    now: "2026-06-16T00:00:00.000Z",
  };

  it("binds google on a fresh row", async () => {
    await upsertGoogleBinding(env.DB, g);
    const row = await getBinding(env.DB, "0856001");
    expect(row).toMatchObject({ google_sub: "108sub", google_email: "ming@gmail.com" });
  });

  it("binding google does not clobber an existing github binding (and vice versa)", async () => {
    await upsertBinding(env.DB, base); // github first
    await upsertGoogleBinding(env.DB, g); // then google, same nycu
    const row = await getBinding(env.DB, "0856001");
    expect(row).toMatchObject({ github_login: "ming", google_email: "ming@gmail.com" });
  });

  it("re-binding the same nycu_id updates google fields", async () => {
    await upsertGoogleBinding(env.DB, g);
    await upsertGoogleBinding(env.DB, { ...g, google_sub: "999", google_email: "new@gmail.com", now: "2026-06-17T00:00:00.000Z" });
    const row = await getBinding(env.DB, "0856001");
    expect(row).toMatchObject({ google_sub: "999", google_email: "new@gmail.com", updated_at: "2026-06-17T00:00:00.000Z" });
  });

  it("throws GoogleConflictError when google_sub belongs to another nycu_id", async () => {
    await upsertGoogleBinding(env.DB, g);
    await expect(
      upsertGoogleBinding(env.DB, { ...g, nycu_id: "0856002", nycu_name: "李小華" }),
    ).rejects.toBeInstanceOf(GoogleConflictError);
  });

  it("stores + reads the (encrypted) refresh token & scope via getGoogleTokenRow", async () => {
    await upsertGoogleBinding(env.DB, { ...g, refresh_token: "enc-blob", scope: "openid email drive.file" });
    const tok = await getGoogleTokenRow(env.DB, "0856001");
    expect(tok).toMatchObject({ google_refresh_token: "enc-blob", google_scope: "openid email drive.file" });
    expect(tok?.google_token_updated_at).toBe(g.now);
  });

  it("a refresh-token-less re-upsert keeps the stored token (COALESCE)", async () => {
    await upsertGoogleBinding(env.DB, { ...g, refresh_token: "enc-blob", scope: "s1" });
    await upsertGoogleBinding(env.DB, { ...g, google_email: "new@gmail.com", now: "2026-06-18T00:00:00.000Z" });
    const tok = await getGoogleTokenRow(env.DB, "0856001");
    expect(tok?.google_refresh_token).toBe("enc-blob"); // not wiped
    expect(tok?.google_scope).toBe("s1");
  });

  it("keeps the refresh token OUT of listBindings + CSV export", async () => {
    await upsertGoogleBinding(env.DB, { ...g, refresh_token: "enc-blob", scope: "s1" });
    const rows = await listBindings(env.DB);
    expect(JSON.stringify(rows)).not.toContain("enc-blob");
    expect(toCsv(rows)).not.toContain("enc-blob");
  });
});

describe("orgBindingView", () => {
  const b = (nycu_id: string, github_login: string): BindingRow => ({
    nycu_id, nycu_name: nycu_id, github_id: 1, github_login, created_at: "t", updated_at: "t",
  });
  it("tags each binding member/pending/none (case-insensitive) and lists unbound org accounts", () => {
    const bindings = [b("B001", "Alice"), b("B002", "bob"), b("B003", "carol")];
    const members = ["alice", "zoe"];      // zoe is in the org but has no binding
    const pending = ["BOB"];               // case-insensitive match to b002
    const v = orgBindingView(bindings, members, pending);
    const byId = Object.fromEntries(v.rows.map((r) => [r.student_id, r.status]));
    expect(byId).toEqual({ B001: "member", B002: "pending", B003: "none" });
    expect(v.unbound).toEqual(["zoe"]); // org account with no maccount binding
  });
});
