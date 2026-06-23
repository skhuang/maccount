-- Mark a course form as for not-yet-enrolled ("prospective") students. These
-- show on the per-course landing /me/<course_id> (binding + form) rather than
-- the enrolled student's /me dashboard.
ALTER TABLE course_forms ADD COLUMN pre_enroll INTEGER NOT NULL DEFAULT 0;
