import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertGrades, listGradesFor, listGradesForStudentAssignment,
  setAssignmentVisibility, listHiddenAssignments, listGradesForAssignmentAllCourses,
  setAssignmentWindow, setScoreboardVisible, getAssignmentMeta, listAssignmentWindows,
} from "../src/db/grades";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
beforeEach(async () => {
  await env.DB.prepare("DELETE FROM grades").run();
});

const g = (over = {}) => ({
  course_id: "ds-2026",
  student_id: "314561004",
  problem_id: "lab01-stack",
  verdict: "AC",
  score: 100,
  max_score: 100,
  updated_at: "2026-06-17T00:00:00.000Z",
  ...over,
});

describe("grades db", () => {
  it("upserts a batch and lists by student", async () => {
    const n = await upsertGrades(env.DB, [g(), g({ problem_id: "lab02-queue", verdict: "WA", score: 50 })]);
    expect(n).toBe(2);
    const rows = await listGradesFor(env.DB, "314561004");
    expect(rows.map((r) => r.problem_id)).toEqual(["lab01-stack", "lab02-queue"]);
    expect(rows[1]).toMatchObject({ verdict: "WA", score: 50 });
  });

  it("re-ingesting the same (student,problem) updates in place", async () => {
    await upsertGrades(env.DB, [g({ verdict: "WA", score: 30, updated_at: "t1" })]);
    await upsertGrades(env.DB, [g({ verdict: "AC", score: 100, updated_at: "t2" })]);
    const rows = await listGradesFor(env.DB, "314561004");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "AC", score: 100, updated_at: "t2" });
  });

  it("empty batch is a no-op", async () => {
    expect(await upsertGrades(env.DB, [])).toBe(0);
  });

  it("listGradesFor isolates students", async () => {
    await upsertGrades(env.DB, [g(), g({ student_id: "999999999" })]);
    expect(await listGradesFor(env.DB, "314561004")).toHaveLength(1);
    expect(await listGradesFor(env.DB, "000000000")).toHaveLength(0);
  });

  it("the same (student,problem) in two courses stays distinct (course_id in PK)", async () => {
    await upsertGrades(env.DB, [g({ course_id: "ds-2026" }), g({ course_id: "ds-2027", score: 40 })]);
    const rows = await listGradesFor(env.DB, "314561004");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => [r.course_id, r.score])).toEqual([
      ["ds-2026", 100],
      ["ds-2027", 40],
    ]);
  });
});

describe("assignment visibility (hide/publish on /me)", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM assignment_visibility").run();
  });
  const A = "ds2026-practice6";
  const ga = (over = {}) => g({ assignment_id: A, ...over });

  it("hiding an assignment removes its rows from listGradesFor", async () => {
    await upsertGrades(env.DB, [
      ga({ problem_id: "lab01-stack" }),
      ga({ problem_id: "lab02-queue" }),
      g({ problem_id: "other", assignment_id: "ds2026-mid" }),  // different assignment
    ]);
    expect((await listGradesFor(env.DB, "314561004")).length).toBe(3);
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t");
    const rows = await listGradesFor(env.DB, "314561004");
    expect(rows.map((r) => r.problem_id)).toEqual(["other"]);   // only the other assignment
  });

  it("un-hiding (hidden:false) brings the rows back", async () => {
    await upsertGrades(env.DB, [ga()]);
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t1");
    expect(await listGradesFor(env.DB, "314561004")).toHaveLength(0);
    await setAssignmentVisibility(env.DB, "ds-2026", A, false, "t2");  // publish again
    expect(await listGradesFor(env.DB, "314561004")).toHaveLength(1);
  });

  it("ungrouped grades (assignment_id NULL) are never hidden", async () => {
    await upsertGrades(env.DB, [g({ problem_id: "lonelab" })]);   // no assignment_id
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t");
    expect(await listGradesFor(env.DB, "314561004")).toHaveLength(1);
  });

  it("hide is scoped to the course", async () => {
    await upsertGrades(env.DB, [ga(), ga({ course_id: "ds-2027" })]);
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t");  // only ds-2026
    const rows = await listGradesFor(env.DB, "314561004");
    expect(rows.map((r) => r.course_id)).toEqual(["ds-2027"]);
  });

  it("hidden exam also drops from the /me/exam query + listHiddenAssignments", async () => {
    await upsertGrades(env.DB, [ga()]);
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t");
    expect(await listGradesForStudentAssignment(env.DB, "314561004", A)).toHaveLength(0);
    expect(await listHiddenAssignments(env.DB, "ds-2026")).toEqual([A]);
  });
});

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

// The exam window (考試期間) pushed by dsjudge, kept on the assignment-level side
// table so a grade upsert can never disturb it and an unbounded window can be
// cleared. Read back by /me/exam/<id> + its student scoreboard.
describe("assignment window", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM assignment_visibility").run();
  });
  const A = "ds2026-lab9";
  const OPEN = "2026-07-29T13:40:00+08:00";
  const DUE = "2026-07-29T16:30:00+08:00";

  it("stores and reads back both bounds", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t1");
    const meta = await getAssignmentMeta(env.DB, "ds-2026", A);
    expect(meta).toMatchObject({ open_at: OPEN, due_at: DUE, scoreboard_visible: false });
  });

  it("no row → window unknown, board closed (not an error)", async () => {
    expect(await getAssignmentMeta(env.DB, "ds-2026", "never-pushed")).toEqual({
      scoreboard_visible: false, open_at: null, due_at: null,
    });
  });

  it("extending the deadline overwrites in place", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t1");
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, "2026-07-29T17:00:00+08:00", "t2");
    expect((await getAssignmentMeta(env.DB, "ds-2026", A)).due_at).toBe("2026-07-29T17:00:00+08:00");
  });

  it("null clears a bound (an unbounded window is a real state)", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t1");
    await setAssignmentWindow(env.DB, "ds-2026", A, null, null, "t2");
    const meta = await getAssignmentMeta(env.DB, "ds-2026", A);
    expect(meta.open_at).toBeNull();
    expect(meta.due_at).toBeNull();
  });

  it("window and the visibility switches share a row without clobbering", async () => {
    await setAssignmentVisibility(env.DB, "ds-2026", A, true, "t1");
    await setScoreboardVisible(env.DB, "ds-2026", A, true, "t2");
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t3");
    const meta = await getAssignmentMeta(env.DB, "ds-2026", A);
    expect(meta).toMatchObject({ scoreboard_visible: true, open_at: OPEN, due_at: DUE });
    expect(await listHiddenAssignments(env.DB, "ds-2026")).toEqual([A]);  // hidden survived
  });

  it("a grade upsert never disturbs the window", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t1");
    await upsertGrades(env.DB, [g({ assignment_id: A, verdict: "AC" })]);
    expect((await getAssignmentMeta(env.DB, "ds-2026", A)).due_at).toBe(DUE);
  });

  it("is scoped per course offering", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", A, OPEN, DUE, "t1");
    expect((await getAssignmentMeta(env.DB, "ds-2027", A)).due_at).toBeNull();
  });
});

// Bulk read for the /me dashboard's exam list — one query for every course
// shown, instead of one per exam.
describe("listAssignmentWindows", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM assignment_visibility").run();
  });

  it("returns the windows for the requested courses only", async () => {
    await setAssignmentWindow(env.DB, "ds-2026", "lab9", "o1", "d1", "t");
    await setAssignmentWindow(env.DB, "ds-2026", "mid", null, "d2", "t");
    await setAssignmentWindow(env.DB, "ds-2027", "lab9", "o3", "d3", "t");
    const rows = await listAssignmentWindows(env.DB, ["ds-2026"]);
    expect(rows.map((r) => [r.assignment_id, r.due_at]).sort()).toEqual([["lab9", "d1"], ["mid", "d2"]]);
  });

  it("skips rows that carry no window (visibility-only rows)", async () => {
    await setAssignmentVisibility(env.DB, "ds-2026", "hidden-only", true, "t");
    await setAssignmentWindow(env.DB, "ds-2026", "lab9", null, "d1", "t");
    const rows = await listAssignmentWindows(env.DB, ["ds-2026"]);
    expect(rows.map((r) => r.assignment_id)).toEqual(["lab9"]);
  });

  it("no courses → no query, empty result", async () => {
    expect(await listAssignmentWindows(env.DB, [])).toEqual([]);
  });
});
