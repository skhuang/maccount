-- Optional per-course GitHub access targets for private course repositories.
-- github_team_slug is the course student team (for example ds2026-students).
-- github_repos is a comma/whitespace/newline separated list of private repo
-- names inside the effective GitHub org (for example ds2026 or ds2026 labs).
ALTER TABLE courses ADD COLUMN github_team_slug TEXT;
ALTER TABLE courses ADD COLUMN github_repos TEXT;
