CREATE TABLE bindings (
  nycu_id      TEXT PRIMARY KEY,
  nycu_name    TEXT,
  github_id    INTEGER UNIQUE,
  github_login TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
