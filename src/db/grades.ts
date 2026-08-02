// OJ grades mirror, per course-offering. Rows are pushed in by the trusted OJ
// runner via /api/grades/ingest; the student /me page reads them back. Only
// score + verdict (+ the student's own repo) are stored (iron rule 2). Keyed by
// (course_id, assignment_id, student_id, problem_id) so a problem reused across
// assignments (and across offerings) keeps a separate row per assignment —
// see migrations/0002 + 0006 + 0007(repo) + 0008(assignment grouping) + 0021(key).

export interface GradeRow {
  course_id: string;
  student_id: string;
  problem_id: string;
  verdict: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string;
  repo: string | null;             // student's repo (full_name or URL), or null
  assignment_id: string | null;    // which assignment this problem belongs to
  assignment_type: string | null;  // lab | exam
  assignment_title: string | null;
  points: number | null;           // this assignment's weight for the problem
}

export interface GradeInput {
  course_id: string;
  student_id: string;
  problem_id: string;
  // score/verdict are null for a repo-only provisioning row (before solving).
  verdict: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string;
  repo?: string | null;
  assignment_id?: string | null;
  assignment_type?: string | null;
  assignment_title?: string | null;
  points?: number | null;
}

const COLS =
  "course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo, " +
  "assignment_id, assignment_type, assignment_title, points";

// Upsert a batch keyed by (course_id, assignment_id, student_id, problem_id) —
// assignment_id is part of the key (migration 0021), so a problem reused across
// assignments keeps a separate row per assignment. A null assignment_id maps to
// '' (the legacy bucket). Returns count written. COALESCE-keeps existing values
// for fields the writer leaves null, so the provisioning push (repo + assignment_*,
// no score) and the grade push (score/verdict, no title) don't clobber each other
// regardless of order. assignment_id is NOT in the UPDATE set (it's a key column).
export async function upsertGrades(db: D1Database, rows: GradeInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO grades
       (course_id, assignment_id, student_id, problem_id, verdict, score, max_score,
        updated_at, repo, assignment_type, assignment_title, points)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
     ON CONFLICT(course_id, assignment_id, student_id, problem_id) DO UPDATE SET
       verdict = COALESCE(?5, verdict),
       score = COALESCE(?6, score),
       max_score = COALESCE(?7, max_score),
       updated_at = ?8,
       repo = COALESCE(?9, repo),
       assignment_type = COALESCE(?10, assignment_type),
       assignment_title = COALESCE(?11, assignment_title),
       points = COALESCE(?12, points)`,
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.course_id, r.assignment_id ?? "", r.student_id, r.problem_id, r.verdict, r.score,
      r.max_score, r.updated_at, r.repo ?? null, r.assignment_type ?? null, r.assignment_title ?? null,
      r.points ?? null,
    ),
  );
  await db.batch(batch);
  return batch.length;
}

// A student's grades across all their courses (each row carries course_id +
// assignment_* so /me can group labs flat and exams into an exam list).
// Excludes assignments an instructor has hidden from the student dashboard.
// (assignment_id NULL never matches -> ungrouped grades are never hidden.)
const NOT_HIDDEN =
  "NOT EXISTS (SELECT 1 FROM assignment_visibility v" +
  " WHERE v.course_id = grades.course_id AND v.assignment_id = grades.assignment_id" +
  " AND v.hidden = 1)";

export async function listGradesFor(db: D1Database, student_id: string): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE student_id = ? AND ${NOT_HIDDEN} ORDER BY course_id, problem_id`)
    .bind(student_id)
    .all<GradeRow>();
  return results ?? [];
}

// One student's problems for a given assignment — the /me/exam/<id> page.
export async function listGradesForStudentAssignment(
  db: D1Database, student_id: string, assignment_id: string,
): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE student_id = ? AND assignment_id = ? AND ${NOT_HIDDEN} ORDER BY problem_id`)
    .bind(student_id, assignment_id)
    .all<GradeRow>();
  return results ?? [];
}

// All grades for one problem — for the OJ→Moodle "程式作業自動批改" pull. Optionally
// scope to a course and/or an assignment; omit both to keep the legacy
// cross-course/cross-assignment behavior. Scoping by assignment_id matters now a
// problem can appear in several assignments (post the assignment_id re-key).
export async function listGradesForProblem(
  db: D1Database, problem_id: string, course_id?: string, assignment_id?: string,
): Promise<GradeRow[]> {
  const where = ["problem_id = ?"];
  const params: string[] = [problem_id];
  if (course_id) { where.push("course_id = ?"); params.push(course_id); }
  if (assignment_id) { where.push("assignment_id = ?"); params.push(assignment_id); }
  const sql = `SELECT ${COLS} FROM grades WHERE ${where.join(" AND ")} ORDER BY student_id`;
  const { results } = await db.prepare(sql).bind(...params).all<GradeRow>();
  return results ?? [];
}

// All grades for one assignment (across students) — the staff scoreboard.
// Includes repo-only rows (score null) that provisioning registered, so
// non-submitters appear too.
export async function listGradesForAssignment(
  db: D1Database, course_id: string, assignment_id: string,
): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE course_id = ? AND assignment_id = ? ORDER BY student_id, problem_id`)
    .bind(course_id, assignment_id)
    .all<GradeRow>();
  return results ?? [];
}

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

// Distinct assignments seen in a course's grades (+ a title) — the scoreboard picker.
export async function listAssignmentsForCourse(
  db: D1Database, course_id: string,
): Promise<{ assignment_id: string; title: string | null }[]> {
  const { results } = await db
    .prepare(
      "SELECT assignment_id, MAX(assignment_title) AS title FROM grades" +
      " WHERE course_id = ? AND assignment_id IS NOT NULL" +
      " GROUP BY assignment_id ORDER BY assignment_id",
    )
    .bind(course_id)
    .all<{ assignment_id: string; title: string | null }>();
  return results ?? [];
}

// Instructor toggle: hide/show an assignment on the student dashboard (/me).
// Independent of the grade rows, so the dsjudge upsert never resets it.
export async function setAssignmentVisibility(
  db: D1Database, course_id: string, assignment_id: string, hidden: boolean,
  updated_at: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO assignment_visibility (course_id, assignment_id, hidden, updated_at)" +
      " VALUES (?, ?, ?, ?)" +
      " ON CONFLICT(course_id, assignment_id) DO UPDATE SET hidden = ?, updated_at = ?")
    .bind(course_id, assignment_id, hidden ? 1 : 0, updated_at, hidden ? 1 : 0, updated_at)
    .run();
}

// Instructor manual switch: open the anonymised scoreboard to students on
// /me/exam/<id>/scoreboard. Default OFF (no row -> not visible). Stored on the
// same assignment_visibility row; independent of `hidden`.
export async function setScoreboardVisible(
  db: D1Database, course_id: string, assignment_id: string, visible: boolean,
  updated_at: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO assignment_visibility (course_id, assignment_id, hidden, scoreboard_visible, updated_at)" +
      " VALUES (?, ?, 0, ?, ?)" +
      " ON CONFLICT(course_id, assignment_id) DO UPDATE SET scoreboard_visible = ?, updated_at = ?")
    .bind(course_id, assignment_id, visible ? 1 : 0, updated_at, visible ? 1 : 0, updated_at)
    .run();
}

// The exam window (考試期間) as pushed by dsjudge. Assignment-level, on the same
// row: the window belongs to the assignment, not to a (student, problem) pair,
// and keeping it off `grades` means an unbounded window can be CLEARED (the
// grade upsert's COALESCE could not). ISO8601 strings; null = bound unset.
// A dsjudge snapshot — it changes only when dsjudge pushes.
export async function setAssignmentWindow(
  db: D1Database, course_id: string, assignment_id: string,
  open_at: string | null, due_at: string | null, updated_at: string,
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO assignment_visibility (course_id, assignment_id, hidden, open_at, due_at, updated_at)" +
      " VALUES (?, ?, 0, ?, ?, ?)" +
      " ON CONFLICT(course_id, assignment_id) DO UPDATE SET open_at = ?, due_at = ?, updated_at = ?")
    .bind(course_id, assignment_id, open_at, due_at, updated_at, open_at, due_at, updated_at)
    .run();
}

export interface AssignmentMeta {
  scoreboard_visible: boolean;
  open_at: string | null;
  due_at: string | null;
}

// Assignment-level state for the student views in one read: is the board open,
// and when does the exam run. No row → board closed, window unknown.
export async function getAssignmentMeta(
  db: D1Database, course_id: string, assignment_id: string,
): Promise<AssignmentMeta> {
  const row = await db
    .prepare(
      "SELECT scoreboard_visible, open_at, due_at FROM assignment_visibility" +
      " WHERE course_id = ? AND assignment_id = ?")
    .bind(course_id, assignment_id)
    .first<{ scoreboard_visible: number; open_at: string | null; due_at: string | null }>();
  return {
    scoreboard_visible: !!row && row.scoreboard_visible === 1,
    open_at: row?.open_at ?? null,
    due_at: row?.due_at ?? null,
  };
}

export interface AssignmentWindowRow {
  course_id: string;
  assignment_id: string;
  open_at: string | null;
  due_at: string | null;
}

// Every known window across a set of courses, in one read — the /me dashboard
// lists a student's exams and needs each one's time without a query per exam.
// Rows with no window at all are skipped (nothing to show for them).
export async function listAssignmentWindows(
  db: D1Database, course_ids: string[],
): Promise<AssignmentWindowRow[]> {
  if (course_ids.length === 0) return [];
  const holes = course_ids.map(() => "?").join(", ");
  const { results } = await db
    .prepare(
      "SELECT course_id, assignment_id, open_at, due_at FROM assignment_visibility" +
      ` WHERE course_id IN (${holes}) AND (open_at IS NOT NULL OR due_at IS NOT NULL)`)
    .bind(...course_ids)
    .all<AssignmentWindowRow>();
  return results ?? [];
}

// Hidden assignment ids for a course (for a staff overview).
export async function listHiddenAssignments(
  db: D1Database, course_id: string,
): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT assignment_id FROM assignment_visibility WHERE course_id = ? AND hidden = 1 ORDER BY assignment_id")
    .bind(course_id)
    .all<{ assignment_id: string }>();
  return (results ?? []).map((r) => r.assignment_id);
}
