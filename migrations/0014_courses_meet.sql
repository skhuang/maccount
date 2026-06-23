-- Optional Google Meet link for a course. The Classroom API doesn't expose a
-- class's Meet link, so it's stored manually and shown to enrolled students on
-- /me (per course), next to that course's Classroom invite flow.
ALTER TABLE courses ADD COLUMN google_meet_url TEXT;
