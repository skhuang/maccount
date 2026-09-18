-- Per-problem human-readable title (from dsjudge meta.yaml), pushed alongside the
-- grade. Display fallback is problem_id, so existing rows keep working until the
-- next grade push backfills the title.
ALTER TABLE grades ADD COLUMN problem_title TEXT;
