import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { upsertCourse } from "../src/db/courses";
import { bulkEnroll } from "../src/db/enrollments";
import { syncStudentsToTeam } from "../src/index";

const now = "2026-06-30T00:00:00.000Z";
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  for (const t of ["enrollments", "courses", "bindings"]) await env.DB.prepare(`DELETE FROM ${t}`).run();
});

async function bind(id: string, gh: number, login: string) {
  await env.DB.prepare(
    "INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES (?,?,?,?,'t','t')",
  ).bind(id, id.toUpperCase(), gh, login).run();
}

describe("syncStudentsToTeam", () => {
  it("adds all enrolled∩bound students to the team", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1", "s2", "s3"], now);
    await bind("s1", 1, "alice"); await bind("s2", 2, "bob");   // s3 unbound
    const calls: string[] = [];
    const fetcher = (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await syncStudentsToTeam({ ...env, ORG_INVITE_TOKEN: "t" } as Env, "ds-2026", fetcher);
    expect(r).toMatchObject({ total: 2, added: 2, failed: 0 });
    expect(calls.filter((u) => u.includes("/teams/team/memberships/")).length).toBe(2);
  });

  it("skips a course with no team", async () => {
    await upsertCourse(env.DB, { course_id: "nt", name: "NT", github_org: "org", github_team_slug: null }, now);
    const r = await syncStudentsToTeam({ ...env, ORG_INVITE_TOKEN: "t" } as Env, "nt", (async () => new Response("{}")) as unknown as typeof fetch);
    expect(r.skipped).toBe("not-configured");
  });

  it("counts a failing student without aborting the batch", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1", "s2"], now);
    await bind("s1", 1, "alice"); await bind("s2", 2, "bob");
    const fetcher = (async (u: RequestInfo | URL) => (String(u).includes("bob") ? new Response("x", { status: 500 }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const r = await syncStudentsToTeam({ ...env, ORG_INVITE_TOKEN: "t" } as Env, "ds-2026", fetcher);
    expect(r.added).toBe(1);
    expect(r.failed).toBe(1);
  });
});
