-- How each binding row was first provisioned (for admin management):
--   nycu   = created from a NYCU-authenticated session (bound GitHub/Google)
--   moodle = auto-created on first Google login via a Moodle enrollment email
--   manual = admin entered (學號 + Google email); no NYCU / no Moodle
-- Set on INSERT; preserved on later updates (first provisioning wins). Existing
-- rows stay NULL and are shown as "unknown".
ALTER TABLE bindings ADD COLUMN source TEXT;
