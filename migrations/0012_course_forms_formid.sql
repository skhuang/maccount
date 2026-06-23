-- form_id is set when maccount creates the form via the Google Forms API (so we
-- can offer an "edit in Google" link); null for forms added by pasting a link.
ALTER TABLE course_forms ADD COLUMN form_id TEXT;
