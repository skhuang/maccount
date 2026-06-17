-- TA/staff list, managed in the admin UI by an owner (ADMIN_IDS). A staff
-- member (by NYCU id) may view /admin + export, but only owners manage staff or
-- delete bindings — so a TA can't self-escalate.
CREATE TABLE staff (
  nycu_id   TEXT PRIMARY KEY,
  added_by  TEXT,
  added_at  TEXT NOT NULL
);
