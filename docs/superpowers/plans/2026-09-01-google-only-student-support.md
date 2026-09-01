# Google-only Student Support (maccount API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose maccount course-membership + identity for google-only (no-GitHub) students so dsjudge can show them their courses and non-program assignments.

**Architecture:** Three token-authed HTTP additions to the single Worker router (`src/index.ts`): fix `/api/resolve-google` to fall back to email, add `GET /api/courses`, add `GET /api/enrolled`. All read-only; reuse existing DB helpers. maccount stays a grades mirror — no submission storage, no changes to `/api/roster` or `/api/grades/ingest`.

**Tech Stack:** TypeScript, Cloudflare Workers, D1, Vitest (`@cloudflare/vitest-pool-workers`).

**Spec:** [../specs/2026-09-01-google-only-student-support-design.md](../specs/2026-09-01-google-only-student-support-design.md)

## Global Constraints

- All three endpoints are token-auth via the existing `bearerOk(req, env)` (shared `GRADES_INGEST_TOKEN`); missing/wrong token → `401`.
- Do NOT modify `/api/roster` or `/api/grades/ingest`, or any login flow.
- All needed helpers are already imported in `src/index.ts`: `getBindingByGoogleSub`, `getBindingByGoogleEmail`, `coursesForStudent`, `listCourses`, `listEnrolledWithBinding`, `getCourse`, `bearerOk`. No new imports.
- After each task run `npx vitest run` and `npx tsc --noEmit`; both must be green.
- Tests live in `test/worker.test.ts`; the pool env `testEnv.GRADES_INGEST_TOKEN` is `"ingest-secret"`; use the existing `call(path, init?, env?)` helper.

---

## Task 1: `/api/resolve-google` email fallback

**Files:**
- Modify: `src/index.ts` (function `apiResolveGoogle`, ~line 854-869)
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: `getBindingByGoogleSub(db, sub)`, `getBindingByGoogleEmail(db, email)` (both already imported; each returns `BindingRow | null`).
- Produces: no new exports; changes the runtime behavior of `GET /api/resolve-google` (tries `sub` then `email`).

- [ ] **Step 1: Write the failing test**

Add this `it(...)` inside `test/worker.test.ts`, immediately AFTER the existing test `it("token API resolve-google maps a bound Google account → 學號", …)` (currently ends ~line 1239), i.e. in the same `describe` block:

```ts
  it("resolve-google falls back to email when the google_sub is unclaimed (manual binding)", async () => {
    // manual binding: has google_email, google_sub still NULL
    await env.DB.prepare(
      "INSERT INTO bindings (nycu_id, nycu_name, google_email, source, created_at, updated_at) VALUES ('AT9337','黃測試','ext@corp.edu','manual','t','t')",
    ).run();
    const get = (qs: string) =>
      call(`/api/resolve-google?${qs}`, { headers: { Authorization: "Bearer ingest-secret" } });

    // dsjudge sends its own OAuth sub (never stored here) + the verified email:
    // sub misses, email resolves.
    const r = await get("sub=dsjudge-sub-xyz&email=ext@corp.edu");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ student_id: "AT9337" });

    // neither matches → 404 {null}
    const none = await get("sub=dsjudge-sub-xyz&email=nobody@corp.edu");
    expect(none.status).toBe(404);
    expect(await none.json()).toEqual({ student_id: null });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker.test.ts -t "falls back to email"`
Expected: FAIL — the first assertion gets `404 {student_id:null}` because current code only queries by `sub` when `sub` is present.

- [ ] **Step 3: Write minimal implementation**

In `src/index.ts`, inside `apiResolveGoogle`, replace this block:

```ts
  const row = sub
    ? await getBindingByGoogleSub(env.DB, sub)
    : await getBindingByGoogleEmail(env.DB, email!);
  if (!row) return json({ student_id: null }, 404);
```

with:

```ts
  // Prefer the stable google_sub; fall back to email so google-only students
  // (manual bindings whose sub is not yet claimed) still resolve. Email match =
  // the caller verified control of the address via its own Google OAuth (same
  // trust boundary as maccount's manual-binding login).
  const row =
    (sub ? await getBindingByGoogleSub(env.DB, sub) : null) ??
    (email ? await getBindingByGoogleEmail(env.DB, email) : null);
  if (!row) return json({ student_id: null }, 404);
```

(The existing `if (!sub && !email) return json({ error: "need sub or email" }, 400);` guard above stays unchanged.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/worker.test.ts -t "resolve-google"` then `npx tsc --noEmit`
Expected: the new test AND the pre-existing `resolve-google` test both PASS (sub-first still works); tsc clean.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat(api): resolve-google falls back to email for google-only students"
```

---

## Task 2: `GET /api/courses?student_id=`

**Files:**
- Modify: `src/index.ts` (add route in the `fetch` dispatcher near the other `/api/*` GETs; add handler `apiCourses` near `apiRoster`)
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: `bearerOk(req, env)`, `coursesForStudent(db, student_id): Promise<string[]>`, `listCourses(db): Promise<CourseRow[]>` (`CourseRow` has `course_id: string`, `name: string`).
- Produces: `GET /api/courses?student_id=<id>` → `200 { student_id, courses: {course_id, name}[] }`; missing token → `401`; missing `student_id` → `400 { error: "need student_id" }`; unknown/never-enrolled student → `200 { student_id, courses: [] }`.

- [ ] **Step 1: Write the failing test**

Add this `describe` to `test/worker.test.ts` (anywhere at top level, e.g. right after the resolve-google/github token-API tests):

```ts
describe("GET /api/courses (token API: a student's courses)", () => {
  const get = (qs: string, tok = "ingest-secret") =>
    call(`/api/courses?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });

  it("lists the courses a student is enrolled in, with names", async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO courses (course_id, name, status, created_at) VALUES ('mk-2026','行銷 2026','active','t')"),
      env.DB.prepare("INSERT INTO courses (course_id, name, status, created_at) VALUES ('ds-2026','資料結構 2026','active','t')"),
      env.DB.prepare("INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES ('mk-2026','AT9337','student','t')"),
    ]);
    const r = await get("student_id=AT9337");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({
      student_id: "AT9337",
      courses: [{ course_id: "mk-2026", name: "行銷 2026" }],
    });
  });

  it("returns an empty list for a student with no enrollment", async () => {
    const r = await get("student_id=ghost");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ student_id: "ghost", courses: [] });
  });

  it("requires the token and the student_id param", async () => {
    expect((await call("/api/courses?student_id=AT9337")).status).toBe(401);
    expect((await get("")).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker.test.ts -t "/api/courses"`
Expected: FAIL — route not implemented (the requests hit the `404 Not found` fall-through, so status assertions fail).

- [ ] **Step 3: Add the route**

In `src/index.ts`, in the `fetch` dispatcher, immediately after the line:

```ts
      if (p === "/api/roster" && req.method === "GET") return await apiRoster(req, env);
```

add:

```ts
      if (p === "/api/courses" && req.method === "GET") return await apiCourses(req, env, url);
```

- [ ] **Step 4: Add the handler**

In `src/index.ts`, add this function right after `apiRoster` (…the function that ends with the `toRosterCsv` response):

```ts
// GET /api/courses?student_id= — the courses a student is enrolled in (token
// auth). Lets dsjudge list courses for a google-only student it resolved by
// email. Unknown/never-enrolled student → empty list (200), not 404.
async function apiCourses(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const studentId = url.searchParams.get("student_id");
  if (!studentId) return json({ error: "need student_id" }, 400);
  const ids = await coursesForStudent(env.DB, studentId);
  const nameById = new Map((await listCourses(env.DB)).map((c) => [c.course_id, c.name]));
  const courses = ids.map((id) => ({ course_id: id, name: nameById.get(id) ?? id }));
  return json({ student_id: studentId, courses }, 200);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/worker.test.ts -t "/api/courses"` then `npx tsc --noEmit`
Expected: 3 tests PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat(api): GET /api/courses — a student's enrolled courses (token auth)"
```

---

## Task 3: `GET /api/enrolled?course_id=`

**Files:**
- Modify: `src/index.ts` (add route after the `/api/courses` route; add handler `apiEnrolled` near `apiCourses`)
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: `bearerOk(req, env)`, `getCourse(db, course_id): Promise<CourseRow | null>`, `listEnrolledWithBinding(db, course_id): Promise<EnrolledStudent[]>` where `EnrolledStudent` has `student_id: string`, `name: string | null`, `github_login: string | null`, `google_email: string | null` (plus other fields not returned).
- Produces: `GET /api/enrolled?course_id=<id>` → `200 { course_id, students: {student_id, name, github_login, google_email}[] }` (includes students with `github_login: null`); missing token → `401`; missing `course_id` → `400 { error: "need course_id" }`; unknown course → `404 { error: "course not found" }`.

- [ ] **Step 1: Write the failing test**

Add this `describe` to `test/worker.test.ts` (top level, near the `/api/courses` describe):

```ts
describe("GET /api/enrolled (token API: full roster incl. google-only)", () => {
  const get = (qs: string, tok = "ingest-secret") =>
    call(`/api/enrolled?${qs}`, { headers: { Authorization: `Bearer ${tok}` } });

  beforeEach(async () => {
    await env.DB.batch([
      env.DB.prepare("INSERT INTO courses (course_id, name, status, created_at) VALUES ('mk-2026','行銷 2026','active','t')"),
      // AT9336: has GitHub + Google
      env.DB.prepare("INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, google_email, created_at, updated_at) VALUES ('AT9336','黃老師',111,'skhuang','kun@gmail.com','t','t')"),
      // AT9337: manual, google-only (no github)
      env.DB.prepare("INSERT INTO bindings (nycu_id, nycu_name, google_email, source, created_at, updated_at) VALUES ('AT9337','黃測試','ext@corp.edu','manual','t','t')"),
      env.DB.prepare("INSERT INTO enrollments (course_id, student_id, name, role, created_at) VALUES ('mk-2026','AT9336','黃老師','student','t')"),
      env.DB.prepare("INSERT INTO enrollments (course_id, student_id, name, role, created_at) VALUES ('mk-2026','AT9337','黃測試','student','t')"),
    ]);
  });

  it("returns all enrolled students including google-only (github_login null)", async () => {
    const r = await get("course_id=mk-2026");
    expect(r.status).toBe(200);
    const body = (await r.json()) as { course_id: string; students: Array<Record<string, unknown>> };
    expect(body.course_id).toBe("mk-2026");
    const byId = Object.fromEntries(body.students.map((s) => [s.student_id, s]));
    expect(byId["AT9336"]).toEqual({ student_id: "AT9336", name: "黃老師", github_login: "skhuang", google_email: "kun@gmail.com" });
    expect(byId["AT9337"]).toEqual({ student_id: "AT9337", name: "黃測試", github_login: null, google_email: "ext@corp.edu" });
  });

  it("404s an unknown course, 400s a missing param, 401s a missing token", async () => {
    expect((await get("course_id=nope")).status).toBe(404);
    expect((await get("")).status).toBe(400);
    expect((await call("/api/enrolled?course_id=mk-2026")).status).toBe(401);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker.test.ts -t "/api/enrolled"`
Expected: FAIL — route not implemented (requests hit `404 Not found` fall-through; the 200/400 assertions fail).

- [ ] **Step 3: Add the route**

In `src/index.ts`, in the `fetch` dispatcher, immediately after the `/api/courses` route added in Task 2:

```ts
      if (p === "/api/enrolled" && req.method === "GET") return await apiEnrolled(req, env, url);
```

- [ ] **Step 4: Add the handler**

In `src/index.ts`, add this function right after `apiCourses`:

```ts
// GET /api/enrolled?course_id= — full enrolled roster for a course (token auth),
// INCLUDING google-only students (github_login null), so dsjudge can build
// non-program assignments for students without a repo. Only the four fields
// below are returned (no Moodle email / github_id) to limit PII exposure.
async function apiEnrolled(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const courseId = url.searchParams.get("course_id");
  if (!courseId) return json({ error: "need course_id" }, 400);
  if (!(await getCourse(env.DB, courseId))) return json({ error: "course not found" }, 404);
  const rows = await listEnrolledWithBinding(env.DB, courseId);
  const students = rows.map((s) => ({
    student_id: s.student_id,
    name: s.name,
    github_login: s.github_login,
    google_email: s.google_email,
  }));
  return json({ course_id: courseId, students }, 200);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/worker.test.ts -t "/api/enrolled"` then `npx tsc --noEmit`
Expected: 2 tests PASS; tsc clean.

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run` and `npx tsc --noEmit` (whole suite green).

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat(api): GET /api/enrolled — full roster incl. google-only students (token auth)"
```

---

## Self-Review (checked against the spec)

- **§3.1 resolve-google email fallback** → Task 1 (sub-then-email; 404 when neither; token/param guards retained).
- **§3.2 /api/courses** → Task 2 (`{student_id, courses:[{course_id,name}]}`; `[]` for no enrollment; 400 missing param; 401 token).
- **§3.3 /api/enrolled** → Task 3 (JSON incl. google-only; four fields only; 404 unknown course; 400/401 guards). "Do not modify /api/roster" honored (new endpoint).
- **§6 tests** → each task's tests cover the spec's listed cases (sub-hit retained by the pre-existing test; email fallback; both-miss; courses list/empty/guards; enrolled incl. google-only/guards).
- **§7 no changes to /api/roster or /api/grades/ingest or login** → only additive routes + one handler body edit.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `apiCourses`/`apiEnrolled` signatures `(req, env, url)` match their route calls; `CourseRow.course_id/name` and `EnrolledStudent.{student_id,name,github_login,google_email}` match verified interfaces; `bearerOk`/`json` pattern mirrors existing `apiResolveGoogle`.
