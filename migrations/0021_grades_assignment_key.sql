-- Fold assignment_id into the grades primary key so a problem reused across
-- assignments in the same course (e.g. ds2026-lab4 web exam vs ds2026-lab4-github
-- git-push exam, both using tpl-matrix) keeps a SEPARATE grade + scoreboard cell
-- per assignment instead of colliding on (course_id, student_id, problem_id).
-- Mirrors dsjudge's own gradebook re-key. SQLite can't alter a PK in place, so
-- rebuild + backfill; assignment_id is NOT NULL DEFAULT '' (an empty legacy
-- bucket) because a PK column that is NULL breaks ON CONFLICT upserts.
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (
  course_id        TEXT NOT NULL,
  assignment_id    TEXT NOT NULL DEFAULT '',
  student_id       TEXT NOT NULL,
  problem_id       TEXT NOT NULL,
  verdict          TEXT,
  score            INTEGER,
  max_score        INTEGER,
  updated_at       TEXT NOT NULL,
  repo             TEXT,
  assignment_type  TEXT,
  assignment_title TEXT,
  PRIMARY KEY (course_id, assignment_id, student_id, problem_id)
);
INSERT INTO grades
  (course_id, assignment_id, student_id, problem_id, verdict, score, max_score,
   updated_at, repo, assignment_type, assignment_title)
  SELECT course_id, COALESCE(assignment_id, ''), student_id, problem_id, verdict,
         score, max_score, updated_at, repo, assignment_type, assignment_title
  FROM grades_old;
DROP TABLE grades_old;
