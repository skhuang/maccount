-- Add course_id to staff + grades and fold it into the primary key, so two
-- offerings can reuse a TA id / problem_id without colliding. SQLite can't
-- alter a PK in place, so rebuild each table and backfill existing rows into
-- the seeded default course (ds-2026, see 0004).

-- staff: PK (nycu_id) -> (course_id, nycu_id)
ALTER TABLE staff RENAME TO staff_old;
CREATE TABLE staff (
  course_id TEXT NOT NULL,
  nycu_id   TEXT NOT NULL,
  added_by  TEXT,
  added_at  TEXT NOT NULL,
  PRIMARY KEY (course_id, nycu_id)
);
INSERT INTO staff (course_id, nycu_id, added_by, added_at)
  SELECT 'ds-2026', nycu_id, added_by, added_at FROM staff_old;
DROP TABLE staff_old;

-- grades: PK (student_id, problem_id) -> (course_id, student_id, problem_id)
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (
  course_id   TEXT NOT NULL,
  student_id  TEXT NOT NULL,
  problem_id  TEXT NOT NULL,
  verdict     TEXT,
  score       INTEGER,
  max_score   INTEGER,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (course_id, student_id, problem_id)
);
INSERT INTO grades (course_id, student_id, problem_id, verdict, score, max_score, updated_at)
  SELECT 'ds-2026', student_id, problem_id, verdict, score, max_score, updated_at FROM grades_old;
DROP TABLE grades_old;
