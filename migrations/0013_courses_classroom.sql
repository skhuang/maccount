-- Optional Google Classroom course id for a course-offering. Future: use the
-- Classroom API to add bound Google accounts to the class and surface its Meet
-- link. Stored alongside moodle_course_id / github_org.
ALTER TABLE courses ADD COLUMN google_classroom_id TEXT;
