// Per-offering enrollment (course_id, student_id). Source of truth is Moodle
// (synced in Phase 3); may be empty until then. student_id == nycu_id == 學號.
// See migrations/0005_enrollments.sql.

export interface EnrollmentRow {
  course_id: string;
  student_id: string;
  name: string | null;
  email: string | null;
  role: string;
  created_at: string;
}

export interface EnrollmentInput {
  student_id: string;
  name?: string | null;
  email?: string | null;
}

function normalizeEnrollments(students: (string | EnrollmentInput)[]): EnrollmentInput[] {
  const byId = new Map<string, EnrollmentInput>();
  for (const s of students) {
    const student_id = String(typeof s === "string" ? s : s?.student_id ?? "").trim();
    if (!student_id || byId.has(student_id)) continue;
    const name = typeof s === "string" ? "" : String(s?.name ?? "").trim();
    const email = typeof s === "string" ? "" : String(s?.email ?? "").trim();
    byId.set(student_id, { student_id, name, email });
  }
  return [...byId.values()];
}

export async function listEnrollments(db: D1Database, course_id: string): Promise<EnrollmentRow[]> {
  const { results } = await db
    .prepare(
      "SELECT course_id, student_id, name, email, role, created_at FROM enrollments WHERE course_id = ? ORDER BY student_id",
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

// Distinct student ids whose Moodle participants-page email matches the given
// address. Used only as a conservative Google-login fallback after a verified
// Google OAuth identity is returned.
export async function studentIdsForMoodleEmail(db: D1Database, email: string): Promise<string[]> {
  const e = String(email || "").trim().toLowerCase();
  if (!e) return [];
  const { results } = await db
    .prepare("SELECT DISTINCT student_id FROM enrollments WHERE LOWER(email) = ? ORDER BY student_id")
    .bind(e)
    .all<{ student_id: string }>();
  return (results ?? []).map((r) => r.student_id);
}

// Upsert one enrollment (idempotent) — used by the Moodle sync in Phase 3.
export async function enroll(
  db: D1Database, course_id: string, student_id: string, role: string, now: string, email = "", name = "",
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO enrollments (course_id, student_id, name, email, role, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT(course_id, student_id) DO UPDATE SET name = ?3, email = ?4, role = ?5`,
    )
    .bind(course_id, student_id, String(name || "").trim() || null, String(email || "").trim() || null, role, now)
    .run();
}

// Add many student_ids to a course (idempotent; existing rows keep roster
// membership and get a fresh Moodle email when one is provided).
// Returns the number of ids submitted (deduped). Empty input is a no-op.
export async function bulkEnroll(
  db: D1Database, course_id: string, student_ids: (string | EnrollmentInput)[], now: string,
): Promise<number> {
  const students = normalizeEnrollments(student_ids);
  if (students.length === 0) return 0;
  const stmt = db.prepare(
    `INSERT INTO enrollments (course_id, student_id, name, email, role, created_at) VALUES (?1, ?2, ?3, ?4, 'student', ?5)
     ON CONFLICT(course_id, student_id) DO UPDATE SET
       name = COALESCE(?3, enrollments.name),
       email = COALESCE(?4, enrollments.email)`,
  );
  await db.batch(students.map((s) => stmt.bind(course_id, s.student_id, s.name || null, s.email || null, now)));
  return students.length;
}

// Replace a course's entire roster with the given ids (Moodle-authoritative sync).
export async function replaceEnrollments(
  db: D1Database, course_id: string, student_ids: (string | EnrollmentInput)[], now: string,
): Promise<number> {
  const students = normalizeEnrollments(student_ids);
  const ops: D1PreparedStatement[] = [
    db.prepare("DELETE FROM enrollments WHERE course_id = ?").bind(course_id),
  ];
  const ins = db.prepare(
    `INSERT INTO enrollments (course_id, student_id, name, email, role, created_at) VALUES (?1, ?2, ?3, ?4, 'student', ?5)`,
  );
  for (const s of students) ops.push(ins.bind(course_id, s.student_id, s.name || null, s.email || null, now));
  await db.batch(ops);
  return students.length;
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
  name: string | null;          // Moodle participants-page display name
  email: string | null;         // Moodle participants-page email
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
      `SELECT e.student_id, e.name, e.email, b.nycu_name, b.github_login, b.github_id, b.google_email
       FROM enrollments e LEFT JOIN bindings b ON b.nycu_id = e.student_id
       WHERE e.course_id = ? ORDER BY e.student_id`,
    )
    .bind(course_id)
    .all<EnrolledStudent>();
  return results ?? [];
}
