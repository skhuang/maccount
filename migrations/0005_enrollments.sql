-- Per-offering enrollment (different students each term). Source of truth is
-- Moodle (synced in Phase 3). Until populated, roster/access fall back to the
-- global bindings / grade-derived membership, so this being empty is safe.
-- student_id == nycu_id == Moodle username (學號) — the cross-system join key.
CREATE TABLE enrollments (
  course_id  TEXT NOT NULL,
  student_id TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'student',  -- student | (future: auditor, …)
  created_at TEXT NOT NULL,
  PRIMARY KEY (course_id, student_id)
);
