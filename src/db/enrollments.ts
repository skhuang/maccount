// Per-offering enrollment (course_id, student_id). Source of truth is Moodle
// (synced in Phase 3); may be empty until then. student_id == nycu_id == 學號.
// See migrations/0005_enrollments.sql.

export interface EnrollmentRow {
  course_id: string;
  student_id: string;
  role: string;
  created_at: string;
}

export async function listEnrollments(db: D1Database, course_id: string): Promise<EnrollmentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT course_id, student_id, role, created_at FROM enrollments WHERE course_id = ? ORDER BY student_id",
    )
    .bind(course_id)
    .all<EnrollmentRow>();
  return results ?? [];
}

export async function isEnrolled(
  db: D1Database, course_id: string, student_id: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM enrollments WHERE course_id = ? AND student_id = ?")
    .bind(course_id, student_id)
    .first();
  return row != null;
}

// Course ids a student is enrolled in (for /me grouping in Phase 1b).
export async function coursesForStudent(db: D1Database, student_id: string): Promise<string[]> {
  const { results } = await db
    .prepare("SELECT course_id FROM enrollments WHERE student_id = ? ORDER BY course_id")
    .bind(student_id)
    .all<{ course_id: string }>();
  return (results ?? []).map((r) => r.course_id);
}

// Upsert one enrollment (idempotent) — used by the Moodle sync in Phase 3.
export async function enroll(
  db: D1Database, course_id: string, student_id: string, role: string, now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(course_id, student_id) DO UPDATE SET role = ?3`,
    )
    .bind(course_id, student_id, role, now)
    .run();
}
