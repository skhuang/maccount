import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { upsertCourse } from "../src/db/courses";
import { bulkEnroll } from "../src/db/enrollments";
import { syncStudentTeamsOnBind } from "../src/index";
import type { Env } from "../src/env";

const now = "2026-06-30T00:00:00.000Z";
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM enrollments").run();
  await env.DB.prepare("DELETE FROM courses").run();
});

describe("syncStudentTeamsOnBind", () => {
  it("adds the student to each enrolled course team", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1"], now);
    const calls: string[] = [];
    const fetcher = (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    await syncStudentTeamsOnBind({ ...env, ORG_INVITE_TOKEN: "t" } as unknown as Env, "s1", "alice", fetcher);
    expect(calls.some((u) => u.includes("/orgs/org/teams/team/memberships/alice"))).toBe(true);
  });

  it("never throws when GitHub fails", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1"], now);
    const fetcher = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(syncStudentTeamsOnBind({ ...env, ORG_INVITE_TOKEN: "t" } as unknown as Env, "s1", "alice", fetcher)).resolves.toBeUndefined();
  });
});
