// Provisioning request queue (D1). Course staff enqueue; the dsjudge runner
// claims + executes + writes the result back. maccount only records intent.
// See migrations/0020_provision_requests.sql.

// Read-only actions any course staff/TA may trigger.
export const READ_ACTIONS = ["plan", "status"] as const;
// Write actions — course OWNER (ADMIN) only. config/repos_apply touch course.yaml
// / create GitHub repos; register (re)pushes repo links + points to /me without
// creating repos; scoreboard_open/close flip the student scoreboard's visibility.
export const WRITE_ACTIONS =
  ["config", "repos_apply", "register", "scoreboard_open", "scoreboard_close"] as const;
export const PROVISION_ACTIONS = [...READ_ACTIONS, ...WRITE_ACTIONS] as const;
export type ProvisionAction = (typeof PROVISION_ACTIONS)[number];

export function isWriteAction(action: string): boolean {
  return (WRITE_ACTIONS as readonly string[]).includes(action);
}

export interface ProvisionRequest {
  id: number;
  course_id: string;
  assignment_id: string;
  action: string;
  requested_by: string;
  status: string;
  result: string | null;
  created_at: string;
  claimed_at: string | null;
  done_at: string | null;
}

export async function enqueueRequest(
  db: D1Database,
  r: { course_id: string; assignment_id: string; action: string; requested_by: string; now: string },
): Promise<number> {
  const row = await db
    .prepare(
      "INSERT INTO provision_requests (course_id, assignment_id, action, requested_by, created_at)" +
      " VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id",
    )
    .bind(r.course_id, r.assignment_id, r.action, r.requested_by, r.now)
    .first<{ id: number }>();
  return row!.id;
}

// Atomically claim the oldest queued request (optionally scoped to a set of
// course_ids the runner serves). Two-step guard keeps a concurrent claim safe.
export async function claimNextRequest(
  db: D1Database, now: string, courseIds?: string[],
): Promise<ProvisionRequest | null> {
  const scope =
    courseIds && courseIds.length
      ? ` AND course_id IN (${courseIds.map(() => "?").join(",")})`
      : "";
  const next = await db
    .prepare(`SELECT id FROM provision_requests WHERE status='queued'${scope} ORDER BY id LIMIT 1`)
    .bind(...(courseIds ?? []))
    .first<{ id: number }>();
  if (!next) return null;
  const claimed = await db
    .prepare(
      "UPDATE provision_requests SET status='claimed', claimed_at=?2 WHERE id=?1 AND status='queued' RETURNING *",
    )
    .bind(next.id, now)
    .first<ProvisionRequest>();
  return claimed ?? null; // null if another claimer won the race
}

export async function finishRequest(
  db: D1Database, id: number, status: "done" | "error", result: string, now: string,
): Promise<boolean> {
  const res = await db
    .prepare("UPDATE provision_requests SET status=?2, result=?3, done_at=?4 WHERE id=?1")
    .bind(id, status, result, now)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function listRequests(
  db: D1Database, course_id: string, limit = 20,
): Promise<ProvisionRequest[]> {
  const { results } = await db
    .prepare("SELECT * FROM provision_requests WHERE course_id=? ORDER BY id DESC LIMIT ?")
    .bind(course_id, limit)
    .all<ProvisionRequest>();
  return results ?? [];
}
