// TA/staff list (D1), per course-offering. Owners (ADMIN_IDS) manage this;
// members get read/export access to that course's /admin. Keyed by
// (course_id, nycu_id). See migrations/0003_staff.sql + 0006_course_id_staff_grades.sql.

export interface StaffRow {
  nycu_id: string;
  added_by: string | null;
  added_at: string;
}

export async function listStaff(db: D1Database, course_id: string): Promise<StaffRow[]> {
  const { results } = await db
    .prepare("SELECT nycu_id, added_by, added_at FROM staff WHERE course_id = ? ORDER BY added_at")
    .bind(course_id)
    .all<StaffRow>();
  return results ?? [];
}

export async function addStaff(
  db: D1Database, course_id: string, nycu_id: string, added_by: string, now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO staff (course_id, nycu_id, added_by, added_at) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(course_id, nycu_id) DO NOTHING`,
    )
    .bind(course_id, nycu_id, added_by, now)
    .run();
}

export async function removeStaff(db: D1Database, course_id: string, nycu_id: string): Promise<void> {
  await db.prepare("DELETE FROM staff WHERE course_id = ? AND nycu_id = ?").bind(course_id, nycu_id).run();
}

export async function isStaffMember(
  db: D1Database, course_id: string, nycu_id: string,
): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM staff WHERE course_id = ? AND nycu_id = ?")
    .bind(course_id, nycu_id)
    .first();
  return row != null;
}

// True if the user is staff of ANY course — used to gate /admin access and the
// /me admin link (a TA of one course should still reach the admin area).
export async function isStaffAnywhere(db: D1Database, nycu_id: string): Promise<boolean> {
  const row = await db.prepare("SELECT 1 FROM staff WHERE nycu_id = ? LIMIT 1").bind(nycu_id).first();
  return row != null;
}
