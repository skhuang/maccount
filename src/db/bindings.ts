import type { BindingRow } from "../csv";

export class GithubConflictError extends Error {
  constructor(public existingNycuId: string) {
    super("github account already bound to another nycu account");
    this.name = "GithubConflictError";
  }
}

export interface UpsertInput {
  nycu_id: string;
  nycu_name: string;
  github_id: number;
  github_login: string;
  now: string;
}

export async function upsertBinding(db: D1Database, b: UpsertInput): Promise<void> {
  // Best-effort conflict guard for the common (sequential) case. Two concurrent
  // requests could both pass this SELECT; the UNIQUE(github_id) constraint is the
  // correctness backstop (the second INSERT then fails with a raw D1 error).
  const existing = await db
    .prepare("SELECT nycu_id FROM bindings WHERE github_id = ?")
    .bind(b.github_id)
    .first<{ nycu_id: string }>();
  if (existing && existing.nycu_id !== b.nycu_id) {
    throw new GithubConflictError(existing.nycu_id);
  }
  await db
    .prepare(
      `INSERT INTO bindings (nycu_id, nycu_name, github_id, github_login, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?5)
       ON CONFLICT(nycu_id) DO UPDATE SET
         nycu_name = ?2, github_id = ?3, github_login = ?4, updated_at = ?5`,
    )
    .bind(b.nycu_id, b.nycu_name, b.github_id, b.github_login, b.now)
    .run();
}

export async function listBindings(db: D1Database): Promise<BindingRow[]> {
  const { results } = await db
    .prepare(
      "SELECT nycu_id, nycu_name, github_id, github_login, created_at, updated_at FROM bindings ORDER BY created_at",
    )
    .all<BindingRow>();
  return results ?? [];
}

export async function deleteBinding(db: D1Database, nycu_id: string): Promise<void> {
  await db.prepare("DELETE FROM bindings WHERE nycu_id = ?").bind(nycu_id).run();
}

export type OrgStatus = "member" | "pending" | "none";

export interface OrgBindingRow {
  student_id: string;
  nycu_name: string | null;
  github_login: string | null;
  status: OrgStatus; // membership of THIS org for the bound github account
}

// Join the binding registry to a GitHub org's members + pending invites (by
// login, case-insensitive). Returns each binding tagged with its org status,
// plus org members/invitees that have NO maccount binding (joined GitHub but
// didn't bind). Pure — the handler fetches members/pending from GitHub. Used by
// the admin "query bindings by org" view (esp. before enrollment exists).
export function orgBindingView(
  bindings: BindingRow[], members: string[], pending: string[],
): { rows: OrgBindingRow[]; unbound: string[] } {
  const lc = (s: string) => s.toLowerCase();
  const mem = new Set(members.map(lc));
  const pend = new Set(pending.map(lc));
  const boundLogins = new Set(bindings.map((b) => lc(b.github_login ?? "")));
  const rows: OrgBindingRow[] = bindings.map((b) => {
    const l = lc(b.github_login ?? "");
    const status: OrgStatus = mem.has(l) ? "member" : pend.has(l) ? "pending" : "none";
    return { student_id: b.nycu_id, nycu_name: b.nycu_name, github_login: b.github_login, status };
  });
  const unbound = [...new Set([...members, ...pending])].filter((l) => l && !boundLogins.has(lc(l)));
  return { rows, unbound };
}

export async function getBinding(db: D1Database, nycu_id: string): Promise<BindingRow | null> {
  return await db
    .prepare(
      "SELECT nycu_id, nycu_name, github_id, github_login, created_at, updated_at FROM bindings WHERE nycu_id = ?",
    )
    .bind(nycu_id)
    .first<BindingRow>();
}
