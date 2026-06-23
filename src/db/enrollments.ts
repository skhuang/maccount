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

// Add many student_ids to a course (idempotent — existing rows untouched).
// Returns the number of ids submitted (deduped). Empty input is a no-op.
export async function bulkEnroll(
  db: D1Database, course_id: string, student_ids: string[], now: string,
): Promise<number> {
  const ids = [...new Set(student_ids.map((s) => s.trim()).filter(Boolean))];
  if (ids.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES (?1, ?2, 'student', ?3)
     ON CONFLICT(course_id, student_id) DO NOTHING`,
  );
  await db.batch(ids.map((id) => stmt.bind(course_id, id, now)));
  return ids.length;
}

// Replace a course's entire roster with the given ids (Moodle-authoritative sync).
export async function replaceEnrollments(
  db: D1Database, course_id: string, student_ids: string[], now: string,
): Promise<number> {
  const ids = [...new Set(student_ids.map((s) => s.trim()).filter(Boolean))];
  const ops: D1PreparedStatement[] = [
    db.prepare("DELETE FROM enrollments WHERE course_id = ?").bind(course_id),
  ];
  const ins = db.prepare(
    `INSERT INTO enrollments (course_id, student_id, role, created_at) VALUES (?1, ?2, 'student', ?3)`,
  );
  for (const id of ids) ops.push(ins.bind(course_id, id, now));
  await db.batch(ops);
  return ids.length;
}

export async function removeEnrollment(
  db: D1Database, course_id: string, student_id: string,
): Promise<void> {
  await db.prepare("DELETE FROM enrollments WHERE course_id = ? AND student_id = ?")
    .bind(course_id, student_id).run();
}

export async function enrollmentCount(db: D1Database, course_id: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM enrollments WHERE course_id = ?")
    .bind(course_id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export interface EnrolledStudent {
  student_id: string;
  nycu_name: string | null;
  github_login: string | null; // null = enrolled but hasn't bound GitHub yet
  github_id: number | null;
  google_email: string | null;  // null = enrolled but hasn't bound Google yet
}

// A course's roster joined to bindings, so the admin sees who hasn't bound yet.
export async function listEnrolledWithBinding(
  db: D1Database, course_id: string,
): Promise<EnrolledStudent[]> {
  const { results } = await db
    .prepare(
      `SELECT e.student_id, b.nycu_name, b.github_login, b.github_id, b.google_email
       FROM enrollments e LEFT JOIN bindings b ON b.nycu_id = e.student_id
       WHERE e.course_id = ? ORDER BY e.student_id`,
    )
    .bind(course_id)
    .all<EnrolledStudent>();
  return results ?? [];
}
