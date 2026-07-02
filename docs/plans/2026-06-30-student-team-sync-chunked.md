# Chunked Student→Team Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-course student→team sync process in bounded chunks (each Worker invocation under the ~50-subrequest cap, scaling to ~100+ students) and drive it from a small inline progress loop in the admin page.

**Architecture:** `syncStudentsToTeam` gains an `{offset, limit}` window and returns a chunk result as JSON; the admin route becomes a JSON API; the admin page replaces its POST-redirect form with a button + inline `<script>` that loops chunk-requests, showing "同步中… X/N" and a final summary.

**Tech Stack:** TypeScript, Cloudflare Workers + D1, vitest (`@cloudflare/vitest-pool-workers`).

## Global Constraints

- **Chunk size default 40** (1 subrequest/student → ≤40 per invocation, under the ~50 cap).
- **No new secret / no schema change**; reuse `env.ORG_INVITE_TOKEN`. Add-only; single course.
- GitHub client `addTeamMembership(org, teamSlug, username, token, fetcher?)` is fetcher-injectable — new code threads `fetcher` for offline tests.
- **Inline `<script>` only, no external assets** (ADMIN_UI_SPEC). Inject any string/URL into the script via `JSON.stringify(...)` (escaping-safe; no user data in the script anyway).
- Admin route stays `requireCourseStaff`-gated **before** any GitHub write / body read.
- Test DB pattern (from `test/students_team_sync.test.ts`): `applyD1Migrations` in `beforeAll`; clear `enrollments`/`courses`/`bindings` in `beforeEach`; seed with `upsertCourse`, `bulkEnroll`, and the raw `bind()` helper; construct env as `{ ...env, ORG_INVITE_TOKEN: "t" } as unknown as Env`.
- Run: `npx vitest run test/<file>.test.ts`, `npm test`, `npx tsc --noEmit`.

---

### Task 1: Chunk window on `syncStudentsToTeam` (+ tests)

**Files:**
- Modify: `src/index.ts` (`StudentTeamSyncResult` + `syncStudentsToTeam`)
- Test: `test/students_team_sync.test.ts` (rewrite to the options object + add a chunking test)

**Interfaces:**
- Produces: `StudentTeamSyncResult = { total, processed, added, failed, done, nextOffset, skipped? }` and `syncStudentsToTeam(env, courseId, opts?: { offset?; limit?; fetcher? }): Promise<StudentTeamSyncResult>`.

- [ ] **Step 1: Rewrite `test/students_team_sync.test.ts`**

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import { upsertCourse } from "../src/db/courses";
import { bulkEnroll } from "../src/db/enrollments";
import { syncStudentsToTeam } from "../src/index";
import type { Env } from "../src/env";

const now = "2026-06-30T00:00:00.000Z";
const envTok = () => ({ ...env, ORG_INVITE_TOKEN: "t" } as unknown as Env);

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
  it("adds all enrolled∩bound students in one chunk (limit >= total)", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1", "s2", "s3"], now);
    await bind("s1", 1, "alice"); await bind("s2", 2, "bob"); // s3 unbound
    const calls: string[] = [];
    const fetcher = (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const r = await syncStudentsToTeam(envTok(), "ds-2026", { fetcher });
    expect(r).toMatchObject({ total: 2, processed: 2, added: 2, failed: 0, done: true, nextOffset: 2 });
    expect(calls.filter((u) => u.includes("/teams/team/memberships/")).length).toBe(2);
  });

  it("skips a course with no team", async () => {
    await upsertCourse(env.DB, { course_id: "nt", name: "NT", github_org: "org", github_team_slug: null }, now);
    const r = await syncStudentsToTeam(envTok(), "nt", { fetcher: (async () => new Response("{}")) as unknown as typeof fetch });
    expect(r.skipped).toBe("not-configured");
    expect(r.done).toBe(true);
  });

  it("counts a failing student within the chunk", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1", "s2"], now);
    await bind("s1", 1, "alice"); await bind("s2", 2, "bob");
    const fetcher = (async (u: RequestInfo | URL) => (String(u).includes("bob") ? new Response("x", { status: 500 }) : new Response("{}", { status: 200 }))) as unknown as typeof fetch;
    const r = await syncStudentsToTeam(envTok(), "ds-2026", { fetcher });
    expect(r.added).toBe(1);
    expect(r.failed).toBe(1);
  });

  it("processes in bounded chunks via offset/limit", async () => {
    await upsertCourse(env.DB, { course_id: "ds-2026", name: "DS", github_org: "org", github_team_slug: "team" }, now);
    await bulkEnroll(env.DB, "ds-2026", ["s1", "s2", "s3"], now);
    await bind("s1", 1, "alice"); await bind("s2", 2, "bob"); await bind("s3", 3, "carol");
    const calls: string[] = [];
    const fetcher = (async (u: RequestInfo | URL) => { calls.push(String(u)); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    const c0 = await syncStudentsToTeam(envTok(), "ds-2026", { offset: 0, limit: 2, fetcher });
    expect(c0).toMatchObject({ total: 3, processed: 2, done: false, nextOffset: 2 });
    const c1 = await syncStudentsToTeam(envTok(), "ds-2026", { offset: 2, limit: 2, fetcher });
    expect(c1).toMatchObject({ total: 3, processed: 1, done: true, nextOffset: 3 });
    expect(calls.filter((u) => u.includes("/teams/team/memberships/")).length).toBe(3);
  });
});
```

- [ ] **Step 2: Run — fails**

Run: `npx vitest run test/students_team_sync.test.ts`
Expected: FAIL (result lacks `processed`/`done`/`nextOffset`; `syncStudentsToTeam` third arg is currently a bare `fetcher`, not `{ fetcher }`).

- [ ] **Step 3: Replace `StudentTeamSyncResult` + `syncStudentsToTeam` in `src/index.ts`**

Replace the existing interface and function with:

```ts
export interface StudentTeamSyncResult {
  total: number;      // full enrolled∩bound count
  processed: number;  // handled in this chunk
  added: number;
  failed: number;
  done: boolean;      // nextOffset >= total
  nextOffset: number;
  skipped?: string;   // "not-configured" when org/team/token missing
}

// Add a bounded window of enrolled∩bound students to the course GitHub team.
// One subrequest/student (addTeamMembership also invites non-members to the org),
// and a `limit` (default 40) keeps each invocation under the Workers ~50
// subrequest cap — the caller loops with `offset` until `done`.
export async function syncStudentsToTeam(
  env: Env, courseId: string,
  opts: { offset?: number; limit?: number; fetcher?: typeof fetch } = {},
): Promise<StudentTeamSyncResult> {
  const fetcher = opts.fetcher ?? fetch;
  const course = await getCourse(env.DB, courseId);
  const org = course ? effectiveOrg(env, course) : "";
  const team = (course?.github_team_slug ?? "").trim();
  if (!org || !team || !env.ORG_INVITE_TOKEN)
    return { total: 0, processed: 0, added: 0, failed: 0, done: true, nextOffset: 0, skipped: "not-configured" };
  const all = (await listEnrolledWithBinding(env.DB, courseId)).filter((s) => s.github_login);
  const total = all.length;
  const offset = Math.max(0, opts.offset ?? 0);
  const limit = opts.limit ?? 40;
  const slice = all.slice(offset, offset + limit);
  let added = 0, failed = 0;
  for (const s of slice) {
    try {
      await addTeamMembership(org, team, s.github_login!, env.ORG_INVITE_TOKEN, fetcher);
      added++;
    } catch (e) {
      failed++;
      console.error(`student team sync failed (${s.github_login}):`, (e as Error).message);
    }
  }
  const nextOffset = offset + slice.length;
  return { total, processed: slice.length, added, failed, done: nextOffset >= total, nextOffset };
}
```

- [ ] **Step 4: Run — passes**

Run: `npx vitest run test/students_team_sync.test.ts` → 4 pass.
Then `npx tsc --noEmit` — expect errors at the route call site (`syncStudentsToTeam(env, courseId)` in `studentsTeamSync` now returns a shape whose `.skipped`/`.added`/etc. are still fine, but the call omits opts — that's allowed since opts defaults `{}`). If tsc reports the route's `r.total` usage is fine, good; the route is fixed in Task 2 regardless. Confirm `npx vitest run test/students_team_sync.test.ts` is green before committing.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/students_team_sync.test.ts
git commit -m "feat(maccount): chunk syncStudentsToTeam (offset/limit, JSON-friendly result)"
```

---

### Task 2: JSON route + drop the redirect flash

**Files:**
- Modify: `src/index.ts` (`studentsTeamSync` handler; remove the `students_team_msg` read in `courseAdmin` and drop it from the `adminPage(...)` call)
- Test: `test/students_team_route.test.ts` (confirm the anonymous guard still holds)

**Interfaces:**
- Consumes: `syncStudentsToTeam(env, courseId, { offset, limit })` (Task 1), `requireCourseStaff`.
- Produces: `POST /c/{course}/admin/students/team/sync` returns JSON `StudentTeamSyncResult`.

- [ ] **Step 1: Replace the `studentsTeamSync` handler in `src/index.ts`**

```ts
async function studentsTeamSync(req: Request, env: Env, courseId: string): Promise<Response> {
  const s = await requireCourseStaff(req, env, courseId);
  if (s instanceof Response) return s;
  let offset = 0;
  try { offset = Number((await req.json() as { offset?: number } | null)?.offset) || 0; } catch { offset = 0; }
  const r = await syncStudentsToTeam(env, courseId, { offset, limit: 40 });
  return new Response(JSON.stringify(r), { headers: { "content-type": "application/json" } });
}
```

- [ ] **Step 2: Drop the now-unused flash read in `courseAdmin` (`src/index.ts`)**

Remove the line `const studentsTeamMsg = url.searchParams.get("students_team_msg") ?? "";` and remove `studentsTeamMsg` from the `adminPage(lang, course, scoped, { … })` argument object (keep `boundCount`). Leave the other `*Msg` reads untouched.

- [ ] **Step 3: Run the route guard test + typecheck**

Run: `npx vitest run test/students_team_route.test.ts`
Expected: PASS unchanged — an anonymous POST still hits `requireCourseStaff` first and returns 302/401/403 with no `students_team_msg` (and now no sync). `requireCourseStaff` returns before `req.json()`, so the empty-body POST is fine.
Run: `npx tsc --noEmit` → 0 errors (the `adminPage` opts field `studentsTeamMsg?` is optional, so dropping the arg compiles; it is removed from the type in Task 3).

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(maccount): students-team route returns chunk JSON (drop redirect flash)"
```

---

### Task 3: Admin UI button + inline progress script + i18n

**Files:**
- Modify: `src/html.ts` (opts type: drop `studentsTeamMsg`; replace the form with button + status + inline script)
- Modify: `src/i18n.ts` (add `syncing`, `syncDone`, `syncError` to the `Strings` interface + both language maps)
- Test: `test/students_team_render.test.ts` (adminPage renders the button + script when a team is set; nothing when not)

**Interfaces:**
- Consumes: `adminPage(...)` render (existing), the JSON route (Task 2).
- Produces: the progressive UI.

- [ ] **Step 1: Add i18n keys in `src/i18n.ts`**

In the `Strings` interface (next to `syncStudentsTeam: string; enrolledBound: string;`) add:
```ts
  syncing: string;
  syncDone: string;
  syncError: string;
```
In the **zh** map (next to `syncStudentsTeam`/`enrolledBound`):
```ts
    syncing: "同步中…",
    syncDone: "完成",
    syncError: "同步失敗",
```
In the **en** map:
```ts
    syncing: "Syncing…",
    syncDone: "Done",
    syncError: "Sync failed",
```

- [ ] **Step 2: Replace the students-team section in `src/html.ts`**

In the opts type (around the `staff`/`staffMsg` block) **remove** `studentsTeamMsg?: string;` (keep `boundCount?: number;`). Remove `const studentsTeamMsg = opts.studentsTeamMsg ?? "";`. Replace the `studentsTeamSection` body (the `<form>…</form>` + flash `<p>`) with:

```ts
  const studentsTeamSection = course.github_team_slug
    ? `<section class="admin-section" id="students-team">
<button id="sync-students-team" type="button">${t.syncStudentsTeam}</button>
<span class="muted" id="sync-students-status">${boundCount} ${t.enrolledBound}</span>
<script>
(function () {
  var URL_ = ${JSON.stringify(`${base}/students/team/sync`)};
  var SYNCING = ${JSON.stringify(t.syncing)}, DONE = ${JSON.stringify(t.syncDone)}, ERR = ${JSON.stringify(t.syncError)};
  var btn = document.getElementById('sync-students-team');
  var out = document.getElementById('sync-students-status');
  btn.addEventListener('click', async function () {
    btn.disabled = true;
    var offset = 0, added = 0, failed = 0, total = 0;
    try {
      while (true) {
        var res = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ offset: offset }) });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        var d = await res.json();
        if (d.skipped) { out.textContent = d.skipped; break; }
        added += d.added; failed += d.failed; total = d.total; offset = d.nextOffset;
        out.textContent = SYNCING + ' ' + offset + '/' + total;
        if (d.done) { out.textContent = DONE + ': added ' + added + ', failed ' + failed + ' (of ' + total + ')'; break; }
      }
    } catch (e) {
      out.textContent = ERR + ': ' + e.message;
      btn.disabled = false;
    }
  });
})();
</script>
</section>`
    : "";
```

(All injected values go through `JSON.stringify` — escaping-safe. `base` is already `encodeURIComponent`-built.)

- [ ] **Step 3: Write `test/students_team_render.test.ts`**

Confirm the render conditionally includes the button + script. (Import `adminPage`; build minimal args matching its signature — check `src/html.ts` for the exact `opts`/`course` shapes as you edit them.)

```ts
import { describe, it, expect } from "vitest";
import { adminPage } from "../src/html";

const baseCourse = { course_id: "ds-2026", name: "DS", term: null, moodle_course_id: null, github_org: "org", github_repos: null, google_classroom_id: null } as any;
const opts = { isOwner: true, staff: [], boundCount: 3, enrolled: [], forms: [] } as any;

describe("adminPage students-team section", () => {
  it("renders the button + inline script when github_team_slug is set", () => {
    const html = adminPage("en", { ...baseCourse, github_team_slug: "ds2026-students" }, [], opts);
    expect(html).toContain('id="sync-students-team"');
    expect(html).toContain("<script");
    expect(html).toContain("/students/team/sync");
  });
  it("renders nothing for the section when there is no team", () => {
    const html = adminPage("en", { ...baseCourse, github_team_slug: null }, [], opts);
    expect(html).not.toContain('id="sync-students-team"');
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run test/students_team_render.test.ts` → 2 pass.
Run: `npx tsc --noEmit` → 0 errors (adding the 3 keys to the `Strings` interface forces both maps to define them; dropping `studentsTeamMsg` from opts + its only reader compiles).
Run: `npm test` → full suite green.

- [ ] **Step 5: Commit**

```bash
git add src/html.ts src/i18n.ts test/students_team_render.test.ts
git commit -m "feat(maccount): progressive 'Sync students to team' button (chunk loop + i18n)"
```

---

## Notes for the implementer

- The chunk `limit` default 40 keeps each invocation ≤40 GitHub subrequests (< ~50 cap). 100 students → 3 chunk-requests driven by the browser loop.
- Inject every value into the inline `<script>` via `JSON.stringify(...)` — never bare interpolation — so quotes/newlines can't break the JS (and there is no user data in the script anyway).
- The intermediate branch state between Task 2 and Task 3 (JSON route live, old form still present) is transient and only matters after the whole branch deploys; the final state is correct.
- After merge, **deploy** (`npx wrangler deploy`) — merging to main does not auto-deploy.
- Do not touch dsjudge, secrets, or the DB schema. The on-bind path (`syncStudentTeamsOnBind`) is single-call already and is unchanged.
