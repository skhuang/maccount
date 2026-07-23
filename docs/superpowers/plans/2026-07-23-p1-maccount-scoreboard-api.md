# P1 — maccount token 版 scoreboard JSON 端點 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 `GET /api/scoreboard?assignment_id=X`（Bearer token），回該 assignment 的 `buildScoreboard` 結果（每人加權總分 + max_total），供 seminar-moodle 拉去寫進 Moodle gradebook。

**Architecture:** 薄薄一層——新增一個不綁課程的 DB 讀取 `listGradesForAssignmentAllCourses(db, aid)`，交給既有純函式 `buildScoreboard`，用既有 `bearerOk` 驗 token。只新增唯讀端點，不動 `/api/grades`、`buildScoreboard`、ingest。

**Tech Stack:** TypeScript、Cloudflare Worker、D1；測試用 vitest + `@cloudflare/vitest-pool-workers`（`cloudflare:test` 提供真 D1 + `applyD1Migrations`）。

## Global Constraints

- 端點**只以 `assignment_id` 過濾、不收 `course_id`**：seminar-moodle 只有 Moodle 數字課號、拿不到 maccount 的 course slug（P3 已因此停送 course_id）。`assignment_id`（如 `ds2026-lab3`）實務上專屬其課程，僅以 aid 過濾即正確。
- Token 用既有 `bearerOk(req, env)`（比對 `env.GRADES_INGEST_TOKEN`，與 `/api/grades`、ingest 同一把）。
- 回傳只需總分：`{ ok, problems, rows:[{rank, student_id, total}], max_total }`；不回 cells/verdict/repo。
- 與 `listGradesForAssignment` 一致，**不套 `NOT_HIDDEN`**（staff/instructor 視角，含 provisioning 的 repo-only 0 分列）。
- 不重測 `buildScoreboard` 的加權（已有測試）；只測新 DB helper 的過濾與 handler 的 token/參數/結構。

---

### Task 1: `listGradesForAssignmentAllCourses` DB helper

**Files:**
- Modify: `src/db/grades.ts`（緊接在 `listGradesForAssignment` 之後新增）
- Test: `test/grades.test.ts`

**Interfaces:**
- Consumes: `GradeRow`、`COLS`（同檔既有）、`env.DB`（測試）。
- Produces: `export async function listGradesForAssignmentAllCourses(db: D1Database, assignment_id: string): Promise<GradeRow[]>` — Task 2 使用。

- [ ] **Step 1: Write the failing test**

在 `test/grades.test.ts` 檔尾新增（沿用檔頭既有的 `beforeAll`/`beforeEach`/`g` 工廠與 imports；把 `listGradesForAssignmentAllCourses` 加進 `../src/db/grades` 的 import）：

```ts
describe("listGradesForAssignmentAllCourses", () => {
  it("returns only the target assignment's rows, across all courses", async () => {
    await upsertGrades(env.DB, [
      g({ course_id: "ds-2026", student_id: "A1", problem_id: "p1", assignment_id: "ds2026-lab3" }),
      g({ course_id: "ds-2026", student_id: "A2", problem_id: "p1", assignment_id: "ds2026-lab3" }),
      g({ course_id: "ds-2027", student_id: "B1", problem_id: "p1", assignment_id: "ds2026-lab3" }), // 另一課程、同 aid
      g({ course_id: "ds-2026", student_id: "A1", problem_id: "p9", assignment_id: "ds2026-lab4" }), // 別的 aid
    ]);
    const rows = await listGradesForAssignmentAllCourses(env.DB, "ds2026-lab3");
    expect(rows.map((r) => [r.course_id, r.student_id]).sort()).toEqual([
      ["ds-2026", "A1"], ["ds-2026", "A2"], ["ds-2027", "B1"],
    ]);
    expect(rows.every((r) => r.assignment_id === "ds2026-lab3")).toBe(true);
  });

  it("returns [] for an unknown assignment", async () => {
    await upsertGrades(env.DB, [g({ assignment_id: "ds2026-lab3" })]);
    expect(await listGradesForAssignmentAllCourses(env.DB, "nope")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/grades.test.ts -t "listGradesForAssignmentAllCourses"`
Expected: FAIL（`listGradesForAssignmentAllCourses is not a function` / import 解析錯）。

- [ ] **Step 3: Write minimal implementation**

在 `src/db/grades.ts` 的 `listGradesForAssignment` 之後新增：

```ts
// All grades for one assignment across every course — the token scoreboard API
// (GET /api/scoreboard). seminar-moodle can't supply maccount's course slug, so
// we scope by assignment_id alone (an assignment_id belongs to one course in
// practice). Mirrors listGradesForAssignment (no NOT_HIDDEN: staff view).
export async function listGradesForAssignmentAllCourses(
  db: D1Database, assignment_id: string,
): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE assignment_id = ? ORDER BY student_id, problem_id`)
    .bind(assignment_id)
    .all<GradeRow>();
  return results ?? [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/grades.test.ts -t "listGradesForAssignmentAllCourses"`
Expected: PASS（2 個 it 通過）。

- [ ] **Step 5: Commit**

```bash
git add src/db/grades.ts test/grades.test.ts
git commit -m "feat(grades): listGradesForAssignmentAllCourses (assignment-only scope)"
```

---

### Task 2: `GET /api/scoreboard` handler + route + tests

**Files:**
- Modify: `src/index.ts`（新增 handler `apiScoreboard`、route、import）
- Test: `test/worker.test.ts`

**Interfaces:**
- Consumes: `bearerOk`（同檔既有）、`buildScoreboard`（已於 `src/index.ts:49` import）、`listGradesForAssignmentAllCourses`（Task 1）。
- Produces: route `GET /api/scoreboard`，回 JSON `{ ok:true, problems:[{problem_id,max_score}], rows:[{rank,student_id,total}], max_total }`。seminar-moodle P2 消費。

- [ ] **Step 1: Write the failing test**

在 `test/worker.test.ts` 新增一個 describe（沿用檔頭既有 `call()`、`testEnv`、`beforeAll`/`beforeEach`；token 為 `"ingest-secret"`）。播種資料用 D1 直插或既有 ingest 端點皆可；此處用 ingest 端點以貼近真實：

```ts
describe("GET /api/scoreboard", () => {
  const ingest = (rows: unknown[]) =>
    call("/api/grades/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer ingest-secret" },
      body: JSON.stringify(rows),
    });

  it("rejects a missing/wrong token with 401", async () => {
    const res = await call("/api/scoreboard?assignment_id=ds2026-lab3", {
      headers: { Authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
  });

  it("400 when assignment_id is missing", async () => {
    const res = await call("/api/scoreboard", { headers: { Authorization: "Bearer ingest-secret" } });
    expect(res.status).toBe(400);
  });

  it("returns per-student weighted totals + max_total for the assignment", async () => {
    // two problems, each points=50 (weight); scores out of max_score=100.
    await ingest([
      { student_id: "A1", problem_id: "p1", verdict: "AC", score: 100, max_score: 100,
        updated_at: "t1", course_id: "ds-2026", assignment_id: "ds2026-lab3", points: 50 },
      { student_id: "A1", problem_id: "p2", verdict: "WA", score: 50, max_score: 100,
        updated_at: "t1", course_id: "ds-2026", assignment_id: "ds2026-lab3", points: 50 },
      { student_id: "A2", problem_id: "p1", verdict: "AC", score: 100, max_score: 100,
        updated_at: "t1", course_id: "ds-2026", assignment_id: "ds2026-lab3", points: 50 },
    ]);
    const res = await call("/api/scoreboard?assignment_id=ds2026-lab3", {
      headers: { Authorization: "Bearer ingest-secret" },
    });
    expect(res.status).toBe(200);
    // Cast res.json() (returns `unknown`) so `npx tsc --noEmit` (a CI step) passes.
    const body = (await res.json()) as {
      ok: boolean; max_total: number;
      rows: { rank: number; student_id: string; total: number }[];
    };
    expect(body.ok).toBe(true);
    expect(body.max_total).toBe(100); // 50 + 50
    const byId = Object.fromEntries(body.rows.map((r) => [r.student_id, r.total]));
    expect(byId).toEqual({ A1: 75, A2: 50 }); // A1: 50 + round(50/100*50)=25 → 75; A2: 50 + 0
    // shape: rows carry only rank/student_id/total
    expect(Object.keys(body.rows[0]).sort()).toEqual(["rank", "student_id", "total"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/worker.test.ts -t "GET /api/scoreboard"`
Expected: FAIL（route 不存在 → 404，或 handler 未定義）。

- [ ] **Step 3: Add the import**

在 `src/index.ts` 的 `from "./db/grades"` import 區塊（第 44–48 行）加入 `listGradesForAssignmentAllCourses`：

```ts
import {
  upsertGrades, listGradesFor, listGradesForProblem, listGradesForStudentAssignment, GradeInput,
  setAssignmentVisibility, listGradesForAssignment, listAssignmentsForCourse,
  setScoreboardVisible, isScoreboardVisible, listGradesForAssignmentAllCourses,
} from "./db/grades";
```

- [ ] **Step 4: Add the handler**

在 `src/index.ts` 的 `apiGrades` handler 附近新增（`buildScoreboard` 已 import）：

```ts
// GET /api/scoreboard?assignment_id=X — token-authed per-assignment scoreboard
// (per-student weighted total + max_total) for the OJ→Moodle gradebook push.
// Scoped by assignment_id only (see /api/grades note re course_id).
async function apiScoreboard(req: Request, env: Env, url: URL): Promise<Response> {
  if (!bearerOk(req, env)) return new Response("Unauthorized", { status: 401 });
  const assignmentId = url.searchParams.get("assignment_id");
  if (!assignmentId) return new Response("assignment_id required", { status: 400 });
  const rows = await listGradesForAssignmentAllCourses(env.DB, assignmentId);
  const board = buildScoreboard(rows);
  return new Response(JSON.stringify({
    ok: true,
    problems: board.problems,
    rows: board.rows.map((r) => ({ rank: r.rank, student_id: r.student_id, total: r.total })),
    max_total: board.max_total,
  }), { headers: { "Content-Type": "application/json" } });
}
```

- [ ] **Step 5: Wire the route**

在 `src/index.ts` 的 `/api/grades` route 之後加：

```ts
      if (p === "/api/scoreboard" && req.method === "GET") return await apiScoreboard(req, env, url);
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/worker.test.ts -t "GET /api/scoreboard"`
Expected: PASS（3 個 it 通過）。

- [ ] **Step 7: Full suite + typecheck (no regressions)**

Run: `npm test && npx tsc --noEmit`
Expected: 測試全綠、tsc 無錯。**CI 有獨立的 `npx tsc --noEmit` 步驟，`npm test`(vitest) 不做型別檢查**——本地務必兩者都跑，否則 `res.json():unknown` 之類的型別錯會過了本地卻炸 CI。

- [ ] **Step 8: Commit**

```bash
git add src/index.ts test/worker.test.ts
git commit -m "feat: GET /api/scoreboard token endpoint (per-assignment totals)"
```

---

## Deploy（實作+審查後、由控制者執行的 ops 步驟，非 TDD task）

P2 依賴此端點上線。合併後部署：

```bash
cd /Users/skhuang/course/maccount
npm test            # 綠
npx wrangler deploy
# 煙霧測試（用實際 GRADES_INGEST_TOKEN 值；找一個已有成績的 assignment_id）：
curl -s "https://maccount-api.skhuang.workers.dev/api/scoreboard?assignment_id=ds2026-lab3" \
  -H "Authorization: Bearer <GRADES_INGEST_TOKEN>" | head
```

驗收：回 `{ok:true, rows:[…], max_total:…}`，rows 每筆只含 `rank/student_id/total`。

## Self-Review 註記

- 覆蓋 spec P1 全部：token(401)、缺參數(400)、assignment-only 過濾（Task 1 測跨課程）、回傳結構（rows 只含 rank/student_id/total）、max_total。
- 無 placeholder：所有 code/test/命令皆完整。
- 型別一致：`listGradesForAssignmentAllCourses(db, aid): Promise<GradeRow[]>` 在 Task 1 定義、Task 2 import 使用同名同簽章。
