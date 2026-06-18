// OJ grades mirror, per course-offering. Rows are pushed in by the trusted OJ
// runner via /api/grades/ingest; the student /me page reads them back. Only
// score + verdict are stored (iron rule 2). Keyed by (course_id, student_id,
// problem_id) so two offerings can reuse a problem_id — see
// migrations/0002_grades.sql + 0006_course_id_staff_grades.sql.

export interface GradeRow {
  course_id: string;
  student_id: string;
  problem_id: string;
  verdict: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string;
  repo: string | null; // student's repo full_name for this problem (or null)
}

export interface GradeInput {
  course_id: string;
  student_id: string;
  problem_id: string;
  verdict: string;
  score: number;
  max_score: number;
  updated_at: string;
  repo?: string | null;
}

// Upsert a batch keyed by (course_id, student_id, problem_id). Returns count written.
export async function upsertGrades(db: D1Database, rows: GradeInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(course_id, student_id, problem_id) DO UPDATE SET
       verdict = ?4, score = ?5, max_score = ?6, updated_at = ?7, repo = ?8`,
  );
  const batch = rows.map((r) =>
    stmt.bind(r.course_id, r.student_id, r.problem_id, r.verdict, r.score, r.max_score, r.updated_at, r.repo ?? null),
  );
  await db.batch(batch);
  return batch.length;
}

// A student's grades across all their courses (each row carries course_id so
// /me can group by course in Phase 1b).
export async function listGradesFor(db: D1Database, student_id: string): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo
       FROM grades WHERE student_id = ? ORDER BY course_id, problem_id`,
    )
    .bind(student_id)
    .all<GradeRow>();
  return results ?? [];
}

// All grades for one problem — for the OJ→Moodle "程式作業自動批改" pull. Optionally
// scope to a course; omit course_id to keep the legacy cross-course behavior.
export async function listGradesForProblem(
  db: D1Database, problem_id: string, course_id?: string,
): Promise<GradeRow[]> {
  const sql = course_id
    ? `SELECT course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo
       FROM grades WHERE problem_id = ? AND course_id = ? ORDER BY student_id`
    : `SELECT course_id, student_id, problem_id, verdict, score, max_score, updated_at, repo
       FROM grades WHERE problem_id = ? ORDER BY student_id`;
  const stmt = course_id
    ? db.prepare(sql).bind(problem_id, course_id)
    : db.prepare(sql).bind(problem_id);
  const { results } = await stmt.all<GradeRow>();
  return results ?? [];
}
