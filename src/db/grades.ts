// OJ grades mirror, per course-offering. Rows are pushed in by the trusted OJ
// runner via /api/grades/ingest; the student /me page reads them back. Only
// score + verdict (+ the student's own repo) are stored (iron rule 2). Keyed by
// (course_id, student_id, problem_id) so two offerings can reuse a problem_id —
// see migrations/0002 + 0006 + 0007(repo) + 0008(assignment grouping).

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
}

const COLS =
  "course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo, " +
  "assignment_id, assignment_type, assignment_title";

// Upsert a batch keyed by (course_id, student_id, problem_id). Returns count
// written. COALESCE-keeps existing values for fields the writer leaves null, so
// the provisioning push (repo + assignment_*, no score) and the grade push
// (score/verdict, no title) don't clobber each other regardless of order.
export async function upsertGrades(db: D1Database, rows: GradeInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO grades
       (course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo,
        assignment_id, assignment_type, assignment_title)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(course_id, student_id, problem_id) DO UPDATE SET
       verdict = COALESCE(?4, verdict),
       score = COALESCE(?5, score),
       max_score = COALESCE(?6, max_score),
       updated_at = ?7,
       repo = COALESCE(?8, repo),
       assignment_id = COALESCE(?9, assignment_id),
       assignment_type = COALESCE(?10, assignment_type),
       assignment_title = COALESCE(?11, assignment_title)`,
  );
  const batch = rows.map((r) =>
    stmt.bind(
      r.course_id, r.student_id, r.problem_id, r.verdict, r.score, r.max_score, r.updated_at,
      r.repo ?? null, r.assignment_id ?? null, r.assignment_type ?? null, r.assignment_title ?? null,
    ),
  );
  await db.batch(batch);
  return batch.length;
}

// A student's grades across all their courses (each row carries course_id +
// assignment_* so /me can group labs flat and exams into an exam list).
export async function listGradesFor(db: D1Database, student_id: string): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE student_id = ? ORDER BY course_id, problem_id`)
    .bind(student_id)
    .all<GradeRow>();
  return results ?? [];
}

// One student's problems for a given assignment — the /me/exam/<id> page.
export async function listGradesForStudentAssignment(
  db: D1Database, student_id: string, assignment_id: string,
): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM grades WHERE student_id = ? AND assignment_id = ? ORDER BY problem_id`)
    .bind(student_id, assignment_id)
    .all<GradeRow>();
  return results ?? [];
}

// All grades for one problem — for the OJ→Moodle "程式作業自動批改" pull. Optionally
// scope to a course; omit course_id to keep the legacy cross-course behavior.
export async function listGradesForProblem(
  db: D1Database, problem_id: string, course_id?: string,
): Promise<GradeRow[]> {
  const sql = course_id
    ? `SELECT ${COLS} FROM grades WHERE problem_id = ? AND course_id = ? ORDER BY student_id`
    : `SELECT ${COLS} FROM grades WHERE problem_id = ? ORDER BY student_id`;
  const stmt = course_id ? db.prepare(sql).bind(problem_id, course_id) : db.prepare(sql).bind(problem_id);
  const { results } = await stmt.all<GradeRow>();
  return results ?? [];
}
