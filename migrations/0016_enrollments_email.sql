-- Moodle enrollment sync can provide the email shown on Moodle's participants
-- page. This is distinct from bindings.google_email, which is the Google
-- account a student connected through maccount.
ALTER TABLE enrollments ADD COLUMN email TEXT;
