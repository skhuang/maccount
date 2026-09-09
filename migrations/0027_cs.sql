ALTER TABLE bindings ADD COLUMN cs_sub TEXT;
ALTER TABLE bindings ADD COLUMN cs_account TEXT;
CREATE UNIQUE INDEX idx_bindings_cs_sub ON bindings(cs_sub);
