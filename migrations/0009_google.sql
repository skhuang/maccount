-- Bind a Google account (identity now; future Google Cloud / Drive file sharing
-- uses the stored email). google_sub = Google's stable subject id (one Google
-- account → one NYCU account); google_email = address shown / shared with.
ALTER TABLE bindings ADD COLUMN google_sub TEXT;
ALTER TABLE bindings ADD COLUMN google_email TEXT;
-- UNIQUE over a nullable column: SQLite treats NULLs as distinct, so rows with
-- no Google binding don't collide; the constraint only fires once a sub is set.
CREATE UNIQUE INDEX idx_bindings_google_sub ON bindings(google_sub);
