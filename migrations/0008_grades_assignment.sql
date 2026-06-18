-- Assignment grouping for /me: which assignment a problem belongs to + its type
-- (lab|exam) and title. Pushed by dsjudge provisioning (per student, per problem,
-- with the repo) before solving, so /me can show "go solve" repo links and group
-- exam problems into an exam the student enters at /me/exam/<assignment_id>.
-- Denormalised onto grades (no join); a problem maps to one assignment per course.
ALTER TABLE grades ADD COLUMN assignment_id TEXT;
ALTER TABLE grades ADD COLUMN assignment_type TEXT;   -- lab | exam
ALTER TABLE grades ADD COLUMN assignment_title TEXT;
