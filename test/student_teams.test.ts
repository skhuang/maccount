import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { upsertCourse } from "../src/db/courses";
import { bulkEnroll } from "../src/db/enrollments";
import { studentTeams } from "../src/index";

const now = "2026-06-30T00:00:00.000Z";

beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM enrollments").run();
  await env.DB.prepare("DELETE FROM courses").run();
});

describe("studentTeams", () => {
  it("returns only enrolled courses that define a github_team_slug", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "nycu-cs-course-ds", github_team_slug: "ds2026-students" }, now);
    await upsertCourse(env.DB, { course_id: "no-team", name: "NT", github_org: "nycu-cs-course-ds", github_team_slug: null }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1"], now);
    await bulkEnroll(env.DB, "no-team", ["s1"], now);
    expect(await studentTeams(env, "s1")).toEqual([{ org: "nycu-cs-course-ds", team: "ds2026-students" }]);
  });

  it("returns [] when not enrolled in any course with a team", async () => {
    expect(await studentTeams(env, "nobody")).toEqual([]);
  });
});
