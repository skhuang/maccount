-- Google Forms (問卷) attached to a course. Staff add a form's share URL; the
-- form itself enforces Google sign-in / email collection in its own settings, so
-- students answer with their (bound) Google account. maccount just stores +
-- surfaces the links per course.
CREATE TABLE course_forms (
  id          INTEGER PRIMARY KEY,
  course_id   TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_course_forms_course ON course_forms(course_id);
