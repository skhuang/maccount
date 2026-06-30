export interface BindingRow {
  nycu_id: string;
  nycu_name: string | null;
  github_id: number;
  github_login: string | null;
  // Optional: present once the student also binds a Google account.
  google_sub?: string | null;
  google_email?: string | null;
  created_at: string;
  updated_at: string;
}

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: BindingRow[]): string {
  const header = [
    "nycu_id", "nycu_name", "github_id", "github_login", "google_email", "created_at", "updated_at",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [r.nycu_id, r.nycu_name, r.github_id, r.github_login, r.google_email, r.created_at, r.updated_at]
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

export interface GithubAccessRow {
  course_id: string;
  course_name: string;
  student_id: string;
  name: string | null;
  github_login: string;
  github_org: string;
  github_team_slug: string | null;
  github_repo: string | null;
  permission: "write";
}

// GitHub private-repo access planning CSV. Each row is one enrolled student who
// has bound GitHub. A downstream provisioning script can invite github_login to
// github_org and grant the course repo/team write access.
export function toGithubAccessCsv(rows: GithubAccessRow[]): string {
  const lines = [
    "course_id,course_name,student_id,name,github_login,github_org,github_team_slug,github_repo,permission",
  ];
  for (const r of rows) {
    lines.push(
      [
        r.course_id, r.course_name, r.student_id, r.name, r.github_login,
        r.github_org, r.github_team_slug, r.github_repo, r.permission,
      ]
        .map(esc)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}
