-- Per-problem repo (the student's own GitHub repo for that problem), so /me and
-- the admin can link to it. Pushed in by dsjudge from its gradebook (the repo
-- full_name, e.g. nycu-cs-course-ds/lab01-stack-skhuang). NOT test data — it's
-- the student's own repo — so it's fine under iron rule 2.
ALTER TABLE grades ADD COLUMN repo TEXT;
