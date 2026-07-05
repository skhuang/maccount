-- Provisioning control plane (control-plane / worker-plane split). Course staff
-- enqueue a provisioning request from /c/<id>/admin/provision; the dsjudge runner
-- (which holds the GitHub token + private problems + course.yaml) POLLS this queue,
-- executes locally, and writes the result back. maccount never runs provisioning
-- itself — it only records intent + the returned result. Inputs are limited to a
-- known assignment_id + a fixed action (iron rule 6).
CREATE TABLE provision_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id     TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  action        TEXT NOT NULL,                       -- plan | status (MVP; config/repos later)
  requested_by  TEXT NOT NULL,                       -- nycu_id of the staff who asked
  status        TEXT NOT NULL DEFAULT 'queued',      -- queued | claimed | done | error
  result        TEXT,                                -- JSON the runner posts back
  created_at    TEXT NOT NULL,
  claimed_at    TEXT,
  done_at       TEXT
);
CREATE INDEX idx_provreq_queued ON provision_requests (status, id);
CREATE INDEX idx_provreq_course ON provision_requests (course_id, id);
