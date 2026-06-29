-- Per-assignment visibility on the student dashboard (/me). A row with hidden=1
-- removes that assignment's grade/repo rows from the STUDENT views (listGradesFor
-- + the /me/exam entry) without deleting any grades. Kept in a separate table so
-- the dsjudge grade/repo upsert never resets it. Staff/bridge views are unaffected.
CREATE TABLE assignment_visibility (
  course_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  hidden        INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT,
  PRIMARY KEY (course_id, assignment_id)
);
