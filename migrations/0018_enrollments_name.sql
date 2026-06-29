-- Moodle enrollment sync can provide the participant's display name. This lets
-- the course roster show names even before the student binds an account.
ALTER TABLE enrollments ADD COLUMN name TEXT;
