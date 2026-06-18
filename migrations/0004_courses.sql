-- Course-offerings (multi-tenant): one row per course per term, e.g. ds-2026.
-- The top-level tenant key. Identity (bindings) stays GLOBAL; staff / grades /
-- enrollments hang off course_id. moodle_course_id is the bridge to a Moodle
-- course (Phase 3); github_org lets each offering use its own GitHub org.
CREATE TABLE courses (
  course_id        TEXT PRIMARY KEY,                -- slug, e.g. ds-2026
  name             TEXT NOT NULL,                   -- display, e.g. 資料結構 2026
  term             TEXT,                            -- e.g. 2026 / 2026-fall
  moodle_course_id TEXT,                            -- Moodle numeric course id
  github_org       TEXT,                            -- per-course GitHub org (optional)
  status           TEXT NOT NULL DEFAULT 'active',  -- active | archived
  created_at       TEXT NOT NULL
);

-- Seed the existing single course so backfilled staff/grades have a parent
-- (see 0006). Adjust name/term later in the admin UI.
INSERT INTO courses (course_id, name, term, status, created_at)
VALUES ('ds-2026', '資料結構 2026', '2026', 'active', '2026-01-01T00:00:00.000Z');
