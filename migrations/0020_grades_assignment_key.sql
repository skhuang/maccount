-- grades PK (course_id, student_id, problem_id)
--       -> (course_id, assignment_id, student_id, problem_id)
-- so a problem reused across assignments (lab + exam in one course) no longer
-- collides on the key. SQLite can't alter a PK in place (see 0006): rebuild.
-- Legacy rows (assignment_id NULL or '', pushed before 0008 grouping) backfill
-- to '_legacy' (leading underscore => cannot collide with a real dsjudge
-- assignment id). Going-forward missing values default to 'on-line-bank'.
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (
  course_id        TEXT NOT NULL,
  assignment_id    TEXT NOT NULL DEFAULT 'on-line-bank',
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
  SELECT course_id, COALESCE(NULLIF(assignment_id, ''), '_legacy'),
         student_id, problem_id, verdict, score, max_score,
         updated_at, repo, assignment_type, assignment_title
  FROM grades_old;
DROP TABLE grades_old;
