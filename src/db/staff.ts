// TA/staff list (D1). Owners (ADMIN_IDS) manage this; members get read/export
// access to /admin. See migrations/0003_staff.sql.

export interface StaffRow {
  nycu_id: string;
  added_by: string | null;
  added_at: string;
}

export async function listStaff(db: D1Database): Promise<StaffRow[]> {
  const { results } = await db
    .prepare("SELECT nycu_id, added_by, added_at FROM staff ORDER BY added_at")
    .all<StaffRow>();
  return results ?? [];
}

export async function addStaff(
  db: D1Database, nycu_id: string, added_by: string, now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO staff (nycu_id, added_by, added_at) VALUES (?1, ?2, ?3)
       ON CONFLICT(nycu_id) DO NOTHING`,
    )
    .bind(nycu_id, added_by, now)
    .run();
}

export async function removeStaff(db: D1Database, nycu_id: string): Promise<void> {
  await db.prepare("DELETE FROM staff WHERE nycu_id = ?").bind(nycu_id).run();
}

export async function isStaffMember(db: D1Database, nycu_id: string): Promise<boolean> {
  const row = await db
    .prepare("SELECT 1 FROM staff WHERE nycu_id = ?")
    .bind(nycu_id)
    .first();
  return row != null;
}
