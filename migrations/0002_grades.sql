-- Per-student OJ results, pushed from the trusted OJ runner (dsjudge).
-- DELIBERATELY score + verdict ONLY: no test input/expected/diff/program output
-- ever lands here (dsjudge iron rule 2 — students see score + verdict only).
-- student_id == nycu_id (the 學號), so /me joins straight onto a NYCU session.
CREATE TABLE grades (
  student_id  TEXT NOT NULL,
  problem_id  TEXT NOT NULL,
  verdict     TEXT,
  score       INTEGER,
  max_score   INTEGER,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (student_id, problem_id)
);
