-- Exam window (考試期間) mirrored from dsjudge, so /me/exam/<id> and the student
-- scoreboard can show when an exam opens and closes.
--
-- Stored on assignment_visibility (the assignment-level side table) rather than
-- on `grades`: the window belongs to the assignment, not to a (student, problem)
-- pair. A per-row copy would need every row rewritten on each change, and the
-- grade upsert's COALESCE could never CLEAR a bound (an unbounded window).
-- ISO8601 strings with offset, exactly as they appear in dsjudge's
-- assignments/<id>.yaml; NULL = that bound is unset.
ALTER TABLE assignment_visibility ADD COLUMN open_at TEXT;
ALTER TABLE assignment_visibility ADD COLUMN due_at TEXT;
