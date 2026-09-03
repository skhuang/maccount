ALTER TABLE bindings ADD COLUMN line_sub TEXT;
ALTER TABLE bindings ADD COLUMN line_name TEXT;
CREATE UNIQUE INDEX idx_bindings_line_sub ON bindings(line_sub);
