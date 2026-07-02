import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { upsertCourse } from "../src/db/courses";
import type { Env } from "../src/env";

const now = "2026-06-30T00:00:00.000Z";
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { for (const t of ["courses","enrollments","bindings"]) await env.DB.prepare(`DELETE FROM ${t}`).run(); });

describe("POST /c/<id>/admin/students/team/sync", () => {
  it("requires admin/staff (unauthenticated → not 3xx redirect to the course admin)", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    const res = await worker.fetch(new Request("https://x/c/ds-2026/admin/students/team/sync", { method: "POST" }), env as unknown as Env);
    // requireCourseStaff returns a login/403 Response for anonymous callers
    expect([302, 303, 401, 403]).toContain(res.status);
    // must NOT have performed the sync (redirect target, if any, is the login flow, not ?students_team_msg=)
    expect(res.headers.get("location") ?? "").not.toContain("students_team_msg");
  });
});
