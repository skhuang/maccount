// OJ grades mirror. Rows are pushed in by the trusted OJ runner via the
// /api/grades/ingest endpoint; the student /me page reads them back. Only
// score + verdict are stored (iron rule 2) — see migrations/0002_grades.sql.

export interface GradeRow {
  student_id: string;
  problem_id: string;
  verdict: string | null;
  score: number | null;
  max_score: number | null;
  updated_at: string;
}

export interface GradeInput {
  student_id: string;
  problem_id: string;
  verdict: string;
  score: number;
  max_score: number;
  updated_at: string;
}

// Upsert a batch keyed by (student_id, problem_id). Returns the number written.
export async function upsertGrades(db: D1Database, rows: GradeInput[]): Promise<number> {
  if (rows.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO grades (student_id, problem_id, verdict, score, max_score, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(student_id, problem_id) DO UPDATE SET
       verdict = ?3, score = ?4, max_score = ?5, updated_at = ?6`,
  );
  const batch = rows.map((r) =>
    stmt.bind(r.student_id, r.problem_id, r.verdict, r.score, r.max_score, r.updated_at),
  );
  await db.batch(batch);
  return batch.length;
}

export async function listGradesFor(db: D1Database, student_id: string): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT student_id, problem_id, verdict, score, max_score, updated_at
       FROM grades WHERE student_id = ? ORDER BY problem_id`,
    )
    .bind(student_id)
    .all<GradeRow>();
  return results ?? [];
}

// All grades for one problem — for the OJ→Moodle "程式作業自動批改" pull.
export async function listGradesForProblem(db: D1Database, problem_id: string): Promise<GradeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT student_id, problem_id, verdict, score, max_score, updated_at
       FROM grades WHERE problem_id = ? ORDER BY student_id`,
    )
    .bind(problem_id)
    .all<GradeRow>();
  return results ?? [];
}
