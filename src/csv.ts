export interface BindingRow {
  nycu_id: string;
  nycu_name: string | null;
  github_id: number;
  github_login: string | null;
  created_at: string;
  updated_at: string;
}

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: BindingRow[]): string {
  const header = ["nycu_id", "nycu_name", "github_id", "github_login", "created_at", "updated_at"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.nycu_id, r.nycu_name, r.github_id, r.github_login, r.created_at, r.updated_at]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

// dsjudge roster.csv shape: `github_login,student_id` (student_id == nycu_id ==
// 學號). Only verified bindings that actually have a GitHub login are emitted;
// this file is what app/roster.py on the OJ host reads.
export function toRosterCsv(rows: BindingRow[]): string {
  const lines = ["github_login,student_id"];
  for (const r of rows) {
    if (!r.github_login) continue;
    lines.push([r.github_login, r.nycu_id].map(esc).join(","));
  }
  return lines.join("\n") + "\n";
}
