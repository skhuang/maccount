import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import { env, applyD1Migrations } from "cloudflare:test";
import {
  upsertGrades, listGradesFor, listGradesForProblem, listGradesForStudentAssignment,
  setAssignmentVisibility, listHiddenAssignments,
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

  it("COALESCE merge is order-independent: grade first, then provisioning", async () => {
    await upsertGrades(env.DB, [
      { course_id: "c1", student_id: "s1", problem_id: "p1", assignment_id: "examA",
        verdict: "AC", score: 10, max_score: 10, updated_at: "t1" },
    ]);
    await upsertGrades(env.DB, [
      { course_id: "c1", student_id: "s1", problem_id: "p1", assignment_id: "examA",
        verdict: null, score: null, max_score: null, updated_at: "t2",
        repo: "o/r", assignment_type: "exam", assignment_title: "Exam A" },
    ]);
    const rows = await listGradesForProblem(env.DB, "p1", "c1", "examA");
    expect(rows.length).toBe(1);
    expect(rows[0].score).toBe(10);        // score kept (provisioning's null didn't clobber)
    expect(rows[0].repo).toBe("o/r");      // repo filled by provisioning
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
