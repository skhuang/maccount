# Course Team Student-Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add enrolled∩bound students to their course's GitHub team (`courses.github_team_slug`) both automatically on GitHub bind and via a per-course admin batch button.

**Architecture:** Pure maccount (Cloudflare Worker, TypeScript). Two new `src/index.ts` helpers (`studentTeams`, `syncStudentsToTeam`) + one on-bind helper (`syncStudentTeamsOnBind`) reuse the existing `addTeamMembership`/`inviteOrgMember` GitHub clients, the `courses`/`enrollments`/`bindings` D1 tables, and `ORG_INVITE_TOKEN`. A new `/c/{course}/admin/students/team/sync` route + admin button trigger the batch. Mirrors the existing `syncStaffToGitHub` (staff→`STAFF_TEAM`) pattern.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, vitest (`@cloudflare/vitest-pool-workers`).

## Global Constraints

- **Home = maccount only.** No dsjudge changes; no schema changes (`github_org`/`github_team_slug` already on `courses`); no new secret (reuse `env.ORG_INVITE_TOKEN`, which already has org members + team write — the staff sync uses it).
- **GitHub clients are `fetcher`-injectable** (`src/oauth/github.ts`): `inviteOrgMember(org, username, token, fetcher?) => {state?}` and `addTeamMembership(org, teamSlug, username, token, fetcher?) => {state?}` (throws on non-2xx). New functions accept an optional `fetcher: typeof fetch = fetch` and thread it through, so tests inject a mock and never hit GitHub.
- **Add-only** for students (no auto-remove). **Best-effort on bind**: a GitHub failure must never fail the binding. **Idempotent**: re-adding an existing member is a no-op.
- **Export the new helpers** from `src/index.ts` (named exports alongside the default `fetch` handler) so vitest can unit-test them.
- **Admin gating**: the new route handler calls `requireCourseStaff(req, env, courseId)` first and returns its `Response` if not authorized — identical to `courseAdmin` and the sibling `/staff/*` handlers.
- **Effective org**: use `effectiveOrg(env, course)` (returns `course.github_org` else `env.COURSE_ORG`). Student team = `course.github_team_slug` (skip when null/empty).
- **Test DB pattern** (from `test/enrollments.test.ts`): `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` in `beforeAll`; clear tables in `beforeEach`; seed with `upsertCourse(env.DB, {...}, now)`, `bulkEnroll(env.DB, courseId, ids, now)`, and raw binding inserts:
  `INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at) VALUES ('s1','甲',1,'alice','t','t')`.
- **Run tests:** `npx vitest run test/<file>.test.ts` (targeted) / `npm test` (all).

---

### Task 1: `studentTeams(env, studentId)` resolver

**Files:**
- Modify: `src/index.ts` (add + export `studentTeams`, next to `studentOrgs`)
- Test: `test/student_teams.test.ts`

**Interfaces:**
- Consumes: `coursesForStudent(db, studentId)`, `listCourses(db)`, `effectiveOrg(env, course)` (all existing).
- Produces: `export async function studentTeams(env: Env, studentId: string): Promise<{ org: string; team: string }[]>` — deduped `{org, team}` for enrolled courses whose `github_team_slug` is set.

- [ ] **Step 1: Write the failing test `test/student_teams.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it — fails (no export `studentTeams`)**

Run: `npx vitest run test/student_teams.test.ts`
Expected: FAIL (import/undefined `studentTeams`).

- [ ] **Step 3: Implement `studentTeams` in `src/index.ts`** (place immediately after `studentOrgs`; add `export`)

```ts
// The deduped {org, team} pairs a student should be a team member of: for each
// enrolled course that defines a github_team_slug, its effective org + team.
export async function studentTeams(env: Env, studentId: string): Promise<{ org: string; team: string }[]> {
  const ids = new Set(await coursesForStudent(env.DB, studentId));
  const out: { org: string; team: string }[] = [];
  const seen = new Set<string>();
  if (ids.size) {
    for (const c of await listCourses(env.DB)) {
      if (!ids.has(c.course_id)) continue;
      const org = effectiveOrg(env, c);
      const team = (c.github_team_slug ?? "").trim();
      if (org && team && !seen.has(`${org}/${team}`)) {
        seen.add(`${org}/${team}`);
        out.push({ org, team });
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run it — passes**

Run: `npx vitest run test/student_teams.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/student_teams.test.ts
git commit -m "feat(maccount): studentTeams resolver (enrolled courses' github teams)"
```

---

### Task 2: Trigger A — add to teams on GitHub bind

**Files:**
- Modify: `src/index.ts` (add + export `syncStudentTeamsOnBind`; call it in `githubCallback`)
- Test: `test/student_team_onbind.test.ts`

**Interfaces:**
- Consumes: `studentTeams` (Task 1), `addTeamMembership` (`src/oauth/github.ts`).
- Produces: `export async function syncStudentTeamsOnBind(env: Env, studentId: string, login: string, fetcher?: typeof fetch): Promise<void>` — best-effort; never throws.

- [ ] **Step 1: Write the failing test `test/student_team_onbind.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { upsertCourse } from "../src/db/courses";
import { bulkEnroll } from "../src/db/enrollments";
import { syncStudentTeamsOnBind } from "../src/index";

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
    await syncStudentTeamsOnBind({ ...env, ORG_INVITE_TOKEN: "t" } as Env, "s1", "alice", fetcher);
    expect(calls.some((u) => u.includes("/orgs/org/teams/team/memberships/alice"))).toBe(true);
  });

  it("never throws when GitHub fails", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1"], now);
    const fetcher = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(syncStudentTeamsOnBind({ ...env, ORG_INVITE_TOKEN: "t" } as Env, "s1", "alice", fetcher)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `npx vitest run test/student_team_onbind.test.ts`
Expected: FAIL (no export `syncStudentTeamsOnBind`).

- [ ] **Step 3: Implement + wire in `src/index.ts`**

Add the helper (near `studentTeams`), importing `addTeamMembership` at the top alongside the existing `inviteOrgMember` import:

```ts
// Best-effort: add a just-bound student to every enrolled course's GitHub team.
// A failure is logged but never propagated (must not break the binding).
export async function syncStudentTeamsOnBind(
  env: Env, studentId: string, login: string, fetcher: typeof fetch = fetch,
): Promise<void> {
  if (!env.ORG_INVITE_TOKEN) return;
  for (const { org, team } of await studentTeams(env, studentId)) {
    try {
      await addTeamMembership(org, team, login, env.ORG_INVITE_TOKEN, fetcher);
      console.log(`team add: ${login} -> ${org}/${team}`);
    } catch (e) {
      console.error(`team add failed (${org}/${team}):`, (e as Error).message);
    }
  }
}
```

In `githubCallback`, immediately AFTER the existing org-invite loop (`for (const org of await studentOrgs(...)) { ... inviteOrgMember ... }`), add:

```ts
  // Also add them to each enrolled course's student team (best-effort).
  await syncStudentTeamsOnBind(env, session.nycu.id, gh.login);
```

- [ ] **Step 4: Run it — passes**

Run: `npx vitest run test/student_team_onbind.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/student_team_onbind.test.ts
git commit -m "feat(maccount): add student to course team on GitHub bind"
```

---

### Task 3: Trigger B — batch `syncStudentsToTeam` + admin route

**Files:**
- Modify: `src/index.ts` (add + export `syncStudentsToTeam`; add route in `courseAdminRouter`; add the `studentsTeamSync` handler)
- Test: `test/students_team_sync.test.ts`

**Interfaces:**
- Consumes: `getCourse(db, courseId)`, `effectiveOrg`, `listEnrolledWithBinding(db, courseId)`, `inviteOrgMember`, `addTeamMembership`, `requireCourseStaff`, `redirect`.
- Produces: `export interface StudentTeamSyncResult { total: number; added: number; failed: number; skipped?: string }` and `export async function syncStudentsToTeam(env: Env, courseId: string, fetcher?: typeof fetch): Promise<StudentTeamSyncResult>`.

- [ ] **Step 1: Write the failing test `test/students_team_sync.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it — fails**

Run: `npx vitest run test/students_team_sync.test.ts`
Expected: FAIL (no export `syncStudentsToTeam`).

- [ ] **Step 3: Implement in `src/index.ts`**

Add near `syncStaffToGitHub`:

```ts
export interface StudentTeamSyncResult { total: number; added: number; failed: number; skipped?: string }

// Batch: add every enrolled∩bound student of a course to its GitHub team.
// Idempotent, per-student isolated (one failure doesn't abort the rest).
export async function syncStudentsToTeam(
  env: Env, courseId: string, fetcher: typeof fetch = fetch,
): Promise<StudentTeamSyncResult> {
  const course = await getCourse(env.DB, courseId);
  const org = course ? effectiveOrg(env, course) : "";
  const team = (course?.github_team_slug ?? "").trim();
  if (!org || !team || !env.ORG_INVITE_TOKEN) return { total: 0, added: 0, failed: 0, skipped: "not-configured" };
  const students = (await listEnrolledWithBinding(env.DB, courseId)).filter((s) => s.github_login);
  let added = 0, failed = 0;
  for (const s of students) {
    try {
      await inviteOrgMember(org, s.github_login!, env.ORG_INVITE_TOKEN, fetcher);      // ensure org (idempotent)
      await addTeamMembership(org, team, s.github_login!, env.ORG_INVITE_TOKEN, fetcher);
      added++;
    } catch (e) {
      failed++;
      console.error(`student team sync failed (${s.github_login}):`, (e as Error).message);
    }
  }
  return { total: students.length, added, failed };
}
```

Add the route inside `courseAdminRouter` (after the `/staff/remove` line):

```ts
  if (sub === "/students/team/sync" && m === "POST") return await studentsTeamSync(req, env, courseId);
```

And the handler (near `staffAdd`/`staffRemove`):

```ts
async function studentsTeamSync(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  const r = await syncStudentsToTeam(env, courseId);
  const msg = r.skipped ? r.skipped : `added ${r.added}, failed ${r.failed} (of ${r.total})`;
  return redirect(`/c/${encodeURIComponent(courseId)}/admin?students_team_msg=${encodeURIComponent(msg)}`);
}
```

- [ ] **Step 4: Run it — passes**

Run: `npx vitest run test/students_team_sync.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/students_team_sync.test.ts
git commit -m "feat(maccount): syncStudentsToTeam batch + /c/<id>/admin/students/team/sync route"
```

---

### Task 4: Admin UI button + i18n + flash

**Files:**
- Modify: `src/index.ts` (`courseAdmin` reads `students_team_msg`, passes to the page)
- Modify: `src/html.ts` (render the button + flash on the per-course admin page)
- Modify: `src/i18n.ts` (labels)
- Test: `test/students_team_route.test.ts`

**Interfaces:**
- Consumes: `syncStudentsToTeam` route from Task 3; the existing per-course admin page renderer in `src/html.ts` (the function `courseAdmin` calls to build HTML).

- [ ] **Step 1: Read the staff-sync button as the template**

The per-course admin page already renders staff controls with a `staff_msg` flash. In `src/html.ts`, find the staff-team form/section and the `staffMsg` usage; mirror it for students. In `src/index.ts` `courseAdmin`, note the existing `const staffMsg = url.searchParams.get("staff_msg") ?? "";` block.

- [ ] **Step 2: Add the flash read in `courseAdmin` (`src/index.ts`)**

Next to the other `*_msg` reads:
```ts
  const studentsTeamMsg = url.searchParams.get("students_team_msg") ?? "";
```
Pass `studentsTeamMsg` and the enrolled∩bound count (`enrolled.filter((e) => e.github_login).length`) into the page-render call alongside the existing `staffMsg`/`enrolled` arguments.

- [ ] **Step 3: Render the button + flash in `src/html.ts`**

In the per-course admin template, near the staff-team block, add (only when the course has a `github_team_slug`):
```html
<form method="POST" action="/c/${courseId}/admin/students/team/sync" class="inline">
  <button type="submit">${t.syncStudentsTeam}</button>
  <span class="muted">${boundCount} ${t.enrolledBound}</span>
</form>
${studentsTeamMsg ? `<p class="flash">${escapeHtml(studentsTeamMsg)}</p>` : ""}
```
(Use the same escaping/CSS helpers the surrounding staff block uses; `courseId`, `boundCount`, `studentsTeamMsg`, and `t` come from the render args. If `github_team_slug` is unset, render nothing or a muted "no team configured" note, matching how the staff block guards on `STAFF_TEAM`.)

- [ ] **Step 4: Add i18n labels in `src/i18n.ts`**

Add to both language maps (mirror the staff-sync keys):
```ts
  syncStudentsTeam: "Sync students to team",   // zh: "同步學生到課程 team"
  enrolledBound: "enrolled & bound",           // zh: "位已選課且已綁定"
```

- [ ] **Step 5: Write the route test `test/students_team_route.test.ts`**

Mirror the nearest existing admin-POST test in `test/worker.test.ts` (it sets up an admin session cookie and posts to a `/c/<id>/admin/...` route). Assert the route is admin-gated and redirects with the flash:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import worker from "../src/index";
import { upsertCourse } from "../src/db/courses";

const now = "2026-06-30T00:00:00.000Z";
beforeAll(async () => { await applyD1Migrations(env.DB, env.TEST_MIGRATIONS); });
beforeEach(async () => { for (const t of ["courses","enrollments","bindings"]) await env.DB.prepare(`DELETE FROM ${t}`).run(); });

describe("POST /c/<id>/admin/students/team/sync", () => {
  it("requires admin/staff (unauthenticated → not 3xx redirect to the course admin)", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    const res = await worker.fetch(new Request("https://x/c/ds-2026/admin/students/team/sync", { method: "POST" }), env);
    // requireCourseStaff returns a login/403 Response for anonymous callers
    expect([302, 303, 401, 403]).toContain(res.status);
    // must NOT have performed the sync (redirect target, if any, is the login flow, not ?students_team_msg=)
    expect(res.headers.get("location") ?? "").not.toContain("students_team_msg");
  });
});
```
(Reuse `test/worker.test.ts`'s admin-session helper to add a positive "authenticated admin → redirect with `students_team_msg`" case if that helper is readily importable; otherwise the guard test above plus Task 3's unit tests are sufficient coverage.)

- [ ] **Step 6: Run tests**

Run: `npx vitest run test/students_team_route.test.ts && npm test`
Expected: the route test passes; the full suite stays green.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/html.ts src/i18n.ts test/students_team_route.test.ts
git commit -m "feat(maccount): admin 'Sync students to team' button + i18n + flash"
```

---

## Notes for the implementer

- Reuse the existing `fetcher` injection on `inviteOrgMember`/`addTeamMembership` — never call GitHub directly, so every test runs offline.
- Keep the on-bind path best-effort (Task 2): binding must succeed even if GitHub is down.
- `effectiveOrg` already falls back to `env.COURSE_ORG`; the student team has NO fallback — skip when `github_team_slug` is empty.
- Do not touch dsjudge or add secrets. `ORG_INVITE_TOKEN` already carries the needed org/team write scope (the staff sync uses it).
- If `src/html.ts`'s admin page is a large single function, add the students block beside the staff block without restructuring the file.
