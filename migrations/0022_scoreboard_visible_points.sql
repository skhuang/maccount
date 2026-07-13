-- Student-facing anonymised scoreboard support.
-- points: the assignment's weight for a problem (e.g. 33), pushed by dsjudge, so
-- maccount can present a points-weighted board matching the dsjudge one (a cell
-- is worth `points`, not the raw 0..max_score). Nullable → fall back to raw.
ALTER TABLE grades ADD COLUMN points INTEGER;
-- scoreboard_visible: instructor manual switch to open the anonymised board to
-- students on /me/exam/<id>/scoreboard. Default 0 (hidden) until turned on;
-- independent of `hidden` (which removes the assignment from /me entirely).
ALTER TABLE assignment_visibility ADD COLUMN scoreboard_visible INTEGER NOT NULL DEFAULT 0;
