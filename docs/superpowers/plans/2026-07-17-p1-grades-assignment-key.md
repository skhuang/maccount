# P1: maccount grades assignment_id key — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold `assignment_id` into the `grades` primary key so a `problem_id` reused across assignments in one course no longer collides, while staying backward compatible with the current `/api/grades?problem_id=` consumer.

**Architecture:** Migration `0020` rebuilds `grades` with PK `(course_id, assignment_id, student_id, problem_id)` (SQLite can't alter a PK in place — rename/create/copy/drop, per `0006`). `upsertGrades` conflicts on the 4-key; `listGradesForProblem` gains optional `course_id`/`assignment_id` filters. The ingest route defaults a missing `assignment_id` to the named bucket `on-line-bank`; `/api/grades` accepts optional `assignment_id`/`course_id`. `/me` + `/me/exam` need no code change — the new key fixes them.

**Tech Stack:** TypeScript, Cloudflare Workers, D1 (SQLite), vitest + `@cloudflare/vitest-pool-workers`.

## Global Constraints

- TypeScript ESM; Cloudflare Workers + D1.
- Sentinels (durable cross-repo contract): **`on-line-bank`** = default for missing/ungrouped assignment_id (ingest + column DEFAULT + future 題庫直解); **`_legacy`** = migration backfill of old NULL/'' rows (leading underscore ⇒ can't collide with a real dsjudge id).
- New PK **exactly** `(course_id, assignment_id, student_id, problem_id)`.
- **Backward compatible:** `/api/grades` keeps `problem_id` required, all new params optional; `problem_id`-only keeps working. Do NOT break the current seminar-moodle caller.
- COALESCE upsert semantics preserved: a provisioning row (repo+assignment, null score) and a grade row (score, no title) must not clobber each other, order-independent.
- Do NOT change `/me`/`/me/exam`/scoreboard rendering logic, or touch P2 (dsjudge) / P3 (seminar-moodle).
- Tests offline via `cloudflare:test` `env.DB` (migrations auto-applied by `applyD1Migrations`).

---

### Task 1: Migration 0020 + grades.ts (4-key upsert + filtered query)

**Files:**
- Create: `migrations/0020_grades_assignment_key.sql`
- Modify: `src/db/grades.ts` (`upsertGrades` ON CONFLICT; `listGradesForProblem` params)
- Create: `test/grades.test.ts`

**Interfaces:**
- Consumes: existing `GradeInput`/`GradeRow` (already carry `assignment_id`).
- Produces:
  - `grades` PK `(course_id, assignment_id, student_id, problem_id)`, `assignment_id TEXT NOT NULL DEFAULT 'on-line-bank'`.
  - `upsertGrades(db, rows)` — conflicts on the 4-key; binds `assignment_id ?? "on-line-bank"`.
  - `listGradesForProblem(db, problem_id, course_id?, assignment_id?) => GradeRow[]`.

- [ ] **Step 1: Write the failing test**

Create `test/grades.test.ts`:

```ts
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertGrades,
  listGradesForProblem,
  listGradesForStudentAssignment,
} from "../src/db/grades";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM grades").run();
});

const base = {
  course_id: "c1",
  student_id: "s1",
  problem_id: "p1",
  verdict: "AC",
  score: 10,
  max_score: 10,
  updated_at: "2026-01-01T00:00:00Z",
};

describe("grades assignment_id key", () => {
  it("same (course,student,problem) in two assignments coexist as two rows", async () => {
    await upsertGrades(env.DB, [
      { ...base, assignment_id: "lab1", score: 8 },
      { ...base, assignment_id: "examA", score: 10 },
    ]);
    const rows = await listGradesForProblem(env.DB, "p1", "c1");
    expect(rows.length).toBe(2);
    const byAsg = Object.fromEntries(rows.map((r) => [r.assignment_id, r.score]));
    expect(byAsg.lab1).toBe(8);
    expect(byAsg.examA).toBe(10);
  });

  it("filters by assignment_id", async () => {
    await upsertGrades(env.DB, [
      { ...base, assignment_id: "lab1", score: 8 },
      { ...base, assignment_id: "examA", score: 10 },
    ]);
    const rows = await listGradesForProblem(env.DB, "p1", "c1", "examA");
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(10);
  });

  it("missing assignment_id lands in on-line-bank", async () => {
    await upsertGrades(env.DB, [{ ...base, assignment_id: null }]);
    const rows = await listGradesForProblem(env.DB, "p1", "c1", "on-line-bank");
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(10);
  });

  it("provisioning row + grade row merge via COALESCE on the 4-key, order-independent", async () => {
    await upsertGrades(env.DB, [
      { course_id: "c1", student_id: "s1", problem_id: "p1", assignment_id: "examA",
        verdict: null, score: null, max_score: null, updated_at: "t1",
        repo: "o/r", assignment_type: "exam", assignment_title: "Exam A" },
    ]);
    await upsertGrades(env.DB, [
      { course_id: "c1", student_id: "s1", problem_id: "p1", assignment_id: "examA",
        verdict: "AC", score: 10, max_score: 10, updated_at: "t2" },
    ]);
    const rows = await listGradesForProblem(env.DB, "p1", "c1", "examA");
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(10);
    expect(rows[0].repo).toBe("o/r");
    expect(rows[0].assignment_title).toBe("Exam A");
  });

  it("listGradesForStudentAssignment separates the same problem across assignments (/me/exam fix)", async () => {
    await upsertGrades(env.DB, [
      { ...base, assignment_id: "lab1", score: 8 },
      { ...base, assignment_id: "examA", score: 10 },
    ]);
    const exam = await listGradesForStudentAssignment(env.DB, "s1", "examA");
    expect(exam.length).toBe(1);
    expect(exam[0].score).toBe(10);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/grades.test.ts`
Expected: FAIL — with the current 3-key PK, the two-assignment rows collide (coexist test sees 1 row, not 2), and `listGradesForProblem` rejects the 4th arg / doesn't filter by assignment.

- [ ] **Step 3: Write the migration**

Create `migrations/0020_grades_assignment_key.sql`:

```sql
-- grades PK (course_id, student_id, problem_id)
--       -> (course_id, assignment_id, student_id, problem_id)
-- so a problem reused across assignments (lab + exam in one course) no longer
-- collides on the key. SQLite can't alter a PK in place (see 0006): rebuild.
-- Legacy rows (assignment_id NULL or '', pushed before 0008 grouping) backfill
-- to '_legacy' (leading underscore => cannot collide with a real dsjudge
-- assignment id). Going-forward missing values default to 'on-line-bank'.
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (
  course_id        TEXT NOT NULL,
  assignment_id    TEXT NOT NULL DEFAULT 'on-line-bank',
  student_id       TEXT NOT NULL,
  problem_id       TEXT NOT NULL,
  verdict          TEXT,
  score            INTEGER,
  max_score        INTEGER,
  updated_at       TEXT NOT NULL,
  repo             TEXT,
  assignment_type  TEXT,
  assignment_title TEXT,
  PRIMARY KEY (course_id, assignment_id, student_id, problem_id)
);
INSERT INTO grades
  (course_id, assignment_id, student_id, problem_id, verdict, score, max_score,
   updated_at, repo, assignment_type, assignment_title)
  SELECT course_id, COALESCE(NULLIF(assignment_id, ''), '_legacy'),
         student_id, problem_id, verdict, score, max_score,
         updated_at, repo, assignment_type, assignment_title
  FROM grades_old;
DROP TABLE grades_old;
```

- [ ] **Step 4: Update grades.ts**

In `src/db/grades.ts`, change `upsertGrades`'s statement — the `ON CONFLICT` target and drop the now-redundant `assignment_id` update (it's part of the key, so it never changes on conflict). Replace:

```ts
     ON CONFLICT(course_id, student_id, problem_id) DO UPDATE SET
       verdict = COALESCE(?4, verdict),
       score = COALESCE(?5, score),
       max_score = COALESCE(?6, max_score),
       updated_at = ?7,
       repo = COALESCE(?8, repo),
       assignment_id = COALESCE(?9, assignment_id),
       assignment_type = COALESCE(?10, assignment_type),
       assignment_title = COALESCE(?11, assignment_title)`,
```

with:

```ts
     ON CONFLICT(course_id, assignment_id, student_id, problem_id) DO UPDATE SET
       verdict = COALESCE(?4, verdict),
       score = COALESCE(?5, score),
       max_score = COALESCE(?6, max_score),
       updated_at = ?7,
       repo = COALESCE(?8, repo),
       assignment_type = COALESCE(?10, assignment_type),
       assignment_title = COALESCE(?11, assignment_title)`,
```

In the same function's `.bind(...)`, change the assignment_id argument from:

```ts
      r.repo ?? null, r.assignment_id ?? null, r.assignment_type ?? null, r.assignment_title ?? null,
```

to:

```ts
      r.repo ?? null, r.assignment_id ?? "on-line-bank", r.assignment_type ?? null, r.assignment_title ?? null,
```

Replace the whole `listGradesForProblem` function with a filter builder:

```ts
// All grades for one problem — the OJ→Moodle "程式作業自動批改" pull. Optionally
// scope to a course and/or a single assignment (a problem reused across
// assignments needs assignment_id to disambiguate). problem_id-only is kept for
// backward compatibility (returns every matching row).
export async function listGradesForProblem(
  db: D1Database, problem_id: string, course_id?: string, assignment_id?: string,
): Promise<GradeRow[]> {
  const conds = ["problem_id = ?"];
  const binds: string[] = [problem_id];
  if (course_id) { conds.push("course_id = ?"); binds.push(course_id); }
  if (assignment_id) { conds.push("assignment_id = ?"); binds.push(assignment_id); }
  const sql = `SELECT ${COLS} FROM grades WHERE ${conds.join(" AND ")} ORDER BY student_id`;
  const { results } = await db.prepare(sql).bind(...binds).all<GradeRow>();
  return results ?? [];
}
```

Also update the header comment at the top of `grades.ts` — change the "Keyed by (course_id, student_id, problem_id)" line to `(course_id, assignment_id, student_id, problem_id)` and note migration `0020`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/grades.test.ts`
Expected: PASS — all 5 tests.

- [ ] **Step 6: Verify the migration backfill (SQL, best-effort)**

`applyD1Migrations` runs on an empty test DB, so the NULL→`_legacy` backfill isn't exercised by vitest. Verify the migration body's transform directly with sqlite3:

```bash
sqlite3 :memory: <<'SQL'
CREATE TABLE grades (course_id TEXT NOT NULL, student_id TEXT NOT NULL, problem_id TEXT NOT NULL,
  verdict TEXT, score INTEGER, max_score INTEGER, updated_at TEXT NOT NULL, repo TEXT,
  assignment_id TEXT, assignment_type TEXT, assignment_title TEXT,
  PRIMARY KEY (course_id, student_id, problem_id));
INSERT INTO grades VALUES ('c1','s1','p1','AC',10,10,'t',NULL,NULL,NULL,NULL);
INSERT INTO grades VALUES ('c1','s2','p1','AC',9,10,'t','o/r','examA','exam','Exam A');
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (course_id TEXT NOT NULL, assignment_id TEXT NOT NULL DEFAULT 'on-line-bank',
  student_id TEXT NOT NULL, problem_id TEXT NOT NULL, verdict TEXT, score INTEGER, max_score INTEGER,
  updated_at TEXT NOT NULL, repo TEXT, assignment_type TEXT, assignment_title TEXT,
  PRIMARY KEY (course_id, assignment_id, student_id, problem_id));
INSERT INTO grades (course_id, assignment_id, student_id, problem_id, verdict, score, max_score, updated_at, repo, assignment_type, assignment_title)
  SELECT course_id, COALESCE(NULLIF(assignment_id, ''), '_legacy'), student_id, problem_id, verdict, score, max_score, updated_at, repo, assignment_type, assignment_title FROM grades_old;
DROP TABLE grades_old;
SELECT student_id || '|' || assignment_id FROM grades ORDER BY student_id;
SQL
```

Expected output:
```
s1|_legacy
s2|examA
```
(2 rows, legacy NULL → `_legacy`, real assignment preserved.) If `sqlite3` is not installed, note it and rely on the SQL review — do not block on this step.

- [ ] **Step 7: Commit**

```bash
git add migrations/0020_grades_assignment_key.sql src/db/grades.ts test/grades.test.ts
git commit -m "feat(grades): fold assignment_id into the grades primary key

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: ingest default + /api/grades assignment_id/course_id params

**Files:**
- Modify: `src/index.ts` (`gradesIngest` assignment_id default; `apiGrades` new params)
- Modify: `test/worker.test.ts` (add a `describe` block; fix 2 pre-existing grades tests broken by the new key)

**Interfaces:**
- Consumes: `listGradesForProblem(db, problem_id, course_id?, assignment_id?)` (Task 1); `bearerOk` (token `GRADES_INGEST_TOKEN`).
- Produces: ingest that never drops a row for a missing assignment (defaults `on-line-bank`); `GET /api/grades?problem_id=&assignment_id=&course_id=`.

- [ ] **Step 1: Write the failing test**

Append to `test/worker.test.ts` (uses the existing `call` helper + `ingest-secret` token):

```ts
describe("/api/grades + ingest assignment_id", () => {
  const ingest = (body: unknown) =>
    call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify(body),
    });
  const get = (qs: string) =>
    call(`/api/grades?${qs}`, { headers: { Authorization: "Bearer ingest-secret" } });

  it("ingest with no assignment_id lands the row in on-line-bank", async () => {
    const r = await ingest([{ course_id: "c1", student_id: "s1", problem_id: "p1", verdict: "AC", score: 5, max_score: 5 }]);
    expect(r.status).toBe(200);
    const bank = await (await get("problem_id=p1&course_id=c1&assignment_id=on-line-bank")).json() as { grades: unknown[] };
    expect(bank.grades.length).toBe(1);
  });

  it("same problem in two assignments is pullable per assignment", async () => {
    await ingest([
      { course_id: "c1", assignment_id: "lab1", student_id: "s1", problem_id: "p1", verdict: "AC", score: 8, max_score: 10 },
      { course_id: "c1", assignment_id: "examA", student_id: "s1", problem_id: "p1", verdict: "AC", score: 10, max_score: 10 },
    ]);
    const lab = await (await get("problem_id=p1&course_id=c1&assignment_id=lab1")).json() as { grades: { score: number }[] };
    const exam = await (await get("problem_id=p1&course_id=c1&assignment_id=examA")).json() as { grades: { score: number }[] };
    expect(lab.grades.length).toBe(1);
    expect(lab.grades[0].score).toBe(8);
    expect(exam.grades.length).toBe(1);
    expect(exam.grades[0].score).toBe(10);
    // backward compat: problem_id-only returns both
    const both = await (await get("problem_id=p1")).json() as { grades: unknown[] };
    expect(both.grades.length).toBe(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/worker.test.ts -t "assignment_id"`
Expected: FAIL — ingest currently sets `assignment_id: null` (so the `on-line-bank` pull finds 0), and `apiGrades` ignores `assignment_id`/`course_id` (both per-assignment pulls return both rows).

- [ ] **Step 3: Update the ingest default**

In `src/index.ts` `gradesIngest`, change:

```ts
      assignment_id: typeof x.assignment_id === "string" && x.assignment_id ? x.assignment_id : null,
```

to:

```ts
      assignment_id: typeof x.assignment_id === "string" && x.assignment_id ? x.assignment_id : "on-line-bank",
```

- [ ] **Step 4: Update apiGrades to accept the new params**

In `src/index.ts` `apiGrades`, replace:

```ts
  const problemId = url.searchParams.get("problem_id");
  if (!problemId) return new Response("problem_id required", { status: 400 });
  const grades = await listGradesForProblem(env.DB, problemId);
```

with:

```ts
  const problemId = url.searchParams.get("problem_id");
  if (!problemId) return new Response("problem_id required", { status: 400 });
  const courseId = url.searchParams.get("course_id") ?? undefined;
  const assignmentId = url.searchParams.get("assignment_id") ?? undefined;
  const grades = await listGradesForProblem(env.DB, problemId, courseId, assignmentId);
```

- [ ] **Step 4b: Fix two pre-existing grades tests broken by the new key**

Task 1's schema change breaks two existing tests in `test/worker.test.ts` (they encode the old column order / old omit-assignment_id merge behavior). Update them to the new model:

(i) In `it("ignores extra fields (no test data ever stored)", …)`, the `Object.keys` assertion hardcodes the old column order. Replace:
```ts
    expect(Object.keys(cols ?? {})).toEqual([
      "course_id", "student_id", "problem_id", "verdict", "score", "max_score", "updated_at", "repo",
      "assignment_id", "assignment_type", "assignment_title",
    ]);
```
with (assignment_id now sits at position 2, matching the new PK column order):
```ts
    expect(Object.keys(cols ?? {})).toEqual([
      "course_id", "assignment_id", "student_id", "problem_id", "verdict", "score", "max_score",
      "updated_at", "repo", "assignment_type", "assignment_title",
    ]);
```

(ii) In `it("repo-only provisioning row keeps score null; a later grade fills it (COALESCE)", …)`, the second (grade) push omits `assignment_id`, which now defaults to `on-line-bank` — a *different* key from the provisioning push's `"mid"`, so they no longer merge. Give the grade push the same `assignment_id` so it merges on the 4-key. Replace the later-grade-push line:
```ts
    await ingest([{ course_id: "ds-2026", student_id: "S1", problem_id: "p1", verdict: "AC", score: 90, max_score: 100, updated_at: "t2" }]);
```
with:
```ts
    await ingest([{ course_id: "ds-2026", student_id: "S1", problem_id: "p1", assignment_id: "mid", verdict: "AC", score: 90, max_score: 100, updated_at: "t2" }]);
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/worker.test.ts -t "assignment_id"`
Expected: PASS.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — the new ingest/apiGrades tests plus the two fixed pre-existing tests; no remaining grades failures. (The full suite was red after Task 1 by design; Step 4b restores it.)

- [ ] **Step 7: Commit**

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat(grades): ingest defaults assignment_id to on-line-bank; /api/grades scopes by assignment_id/course_id

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Docs — CLAUDE.md grades model + stale comment cleanup

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/db/grades.ts` (stale `NOT_HIDDEN` comment)

**Interfaces:**
- Consumes: nothing (docs/comment only).

- [ ] **Step 1: Update the grades key + route lines**

In `CLAUDE.md`:

(a) In the `db/grades.ts` table row, change:
```
鍵 `(course_id,student_id,problem_id)`）— `upsertGrades` / `listGradesFor` / `listGradesForProblem(…, course_id?)`
```
to:
```
鍵 `(course_id,assignment_id,student_id,problem_id)`，遷移 `0020`；未分組/題庫直解用哨兵 `on-line-bank`、legacy 回填 `_legacy`）— `upsertGrades` / `listGradesFor` / `listGradesForProblem(…, course_id?, assignment_id?)`
```

(b) In the `GET /api/grades?problem_id=<id>` bullet, append:
```
 也可加 `&assignment_id=<id>`（同題跨 assignment 消歧義）與 `&course_id=<id>` 收窄；`problem_id`-only 保留為向後相容（回所有符合列）。
```

(c) In the `POST /api/grades/ingest` bullet, change the assignment_id sentence to note the default:
```
`assignment_id/assignment_type(lab|exam)/assignment_title` 選填（dsjudge provision 推送,遷移 `0008`；`assignment_id` 缺省落 `on-line-bank`，並自 `0020` 起是主鍵一部分——同題跨 assignment 各自一列）。
```

- [ ] **Step 2: Fix the stale NOT_HIDDEN comment in grades.ts**

Now that `assignment_id` is `NOT NULL DEFAULT 'on-line-bank'`, no grade row is ever NULL, so the comment claiming "ungrouped grades are never hidden" is stale. In `src/db/grades.ts`, replace:
```ts
// Excludes assignments an instructor has hidden from the student dashboard.
// (assignment_id NULL never matches -> ungrouped grades are never hidden.)
```
with:
```ts
// Excludes assignments an instructor has hidden from the student dashboard.
// (Since 0020 assignment_id is NOT NULL — ungrouped rows carry 'on-line-bank',
// which an instructor can hide like any other assignment.)
```
Do NOT change any code or the query logic — comment only.

- [ ] **Step 3: Verify**

Run: `grep -n "assignment_id.*主鍵\|0020\|on-line-bank\|_legacy" CLAUDE.md && grep -n "on-line-bank" src/db/grades.ts`
Expected: matches for the new key/sentinel text in CLAUDE.md and the updated comment in grades.ts.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md src/db/grades.ts
git commit -m "docs: grades PK now includes assignment_id (0020); document sentinels + /api/grades params

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage:**
- PK → 4-key via migration 0020 → Task 1 (migration + PK). ✓
- `on-line-bank` default (schema DEFAULT + ingest) → Task 1 (DEFAULT + bind) + Task 2 (ingest). ✓
- `_legacy` backfill → Task 1 migration `COALESCE(NULLIF(...),'_legacy')` + sqlite3 check. ✓
- `upsertGrades` 4-key conflict, COALESCE preserved → Task 1 (Step 4) + COALESCE test. ✓
- `listGradesForProblem` optional course_id/assignment_id → Task 1. ✓
- `/api/grades` additive params, keep problem_id-only → Task 2 (+ backward-compat test). ✓
- ingest default → Task 2. ✓
- `/me`/`/me/exam` auto-fixed → Task 1 `listGradesForStudentAssignment` separation test (that function is unchanged; the key fixes it). ✓
- Docs → Task 3. ✓
- No P2/P3 changes, no /me rendering changes → nothing touches them. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N". Full code in every code step. ✓

**3. Type consistency:** `listGradesForProblem(db, problem_id, course_id?, assignment_id?)` identical in Task 1 (definition), Task 1 tests, and Task 2 (`apiGrades` call). Sentinels `on-line-bank`/`_legacy` spelled identically in migration, bind default, ingest, and tests. PK column order `(course_id, assignment_id, student_id, problem_id)` identical in migration, ON CONFLICT, and the spec. ✓

**Migration-in-tests note (not a gap):** `applyD1Migrations` runs 0020 on an empty test DB, so vitest exercises the resulting *schema* (all db/route tests run against the 4-key table) but not the NULL→`_legacy` *backfill* of pre-existing rows; the backfill transform is verified by the Task 1 Step 6 sqlite3 check.
