// Contest scoreboard for one assignment, computed from maccount's own grades
// (score + verdict + repo only — iron rule 2). Pure + testable: the handler
// feeds the assignment's grade rows; ranking is standard competition (1,2,2,4).
// Participants come from the grade rows themselves — provisioning registers a
// repo-only row (score null) per enrolled student, so non-submitters show 0.

import type { GradeRow } from "./db/grades";

export interface SbCell {
  score: number | null;
  verdict: string | null;
  repo: string | null;
}
export interface SbRow {
  rank: number;
  student_id: string;
  total: number;
  cells: Record<string, SbCell>;
}
export interface Scoreboard {
  problems: { problem_id: string; max_score: number | null }[];
  rows: SbRow[];
  max_total: number;
}

export function buildScoreboard(rows: GradeRow[]): Scoreboard {
  const order: string[] = [];
  const maxByPid = new Map<string, number | null>();
  const byStudent = new Map<string, Record<string, SbCell>>();

  for (const r of rows) {
    if (!maxByPid.has(r.problem_id)) {
      order.push(r.problem_id);
      maxByPid.set(r.problem_id, r.max_score);
    } else if (r.max_score != null) {
      const cur = maxByPid.get(r.problem_id) ?? null;
      if (cur == null || r.max_score > cur) maxByPid.set(r.problem_id, r.max_score);
    }
    let cells = byStudent.get(r.student_id);
    if (!cells) {
      cells = {};
      byStudent.set(r.student_id, cells);
    }
    cells[r.problem_id] = { score: r.score, verdict: r.verdict, repo: r.repo };
  }

  const out: SbRow[] = [];
  for (const [student_id, cells] of byStudent) {
    let total = 0;
    for (const pid of order) total += cells[pid]?.score ?? 0;
    out.push({ rank: 0, student_id, total, cells });
  }
  out.sort((a, b) => b.total - a.total || a.student_id.localeCompare(b.student_id));

  let rank = 0;
  let prev = Number.NaN;
  out.forEach((r, i) => {
    if (r.total !== prev) {
      rank = i + 1;
      prev = r.total;
    }
    r.rank = rank;
  });

  const problems = order.map((problem_id) => ({ problem_id, max_score: maxByPid.get(problem_id) ?? null }));
  const max_total = problems.reduce((s, p) => s + (p.max_score ?? 0), 0);
  return { problems, rows: out, max_total };
}

// CSV: rank,student_id,<pid…>,total,<pid…>_repo — score + repo only.
export function scoreboardCsv(board: Scoreboard): string {
  const head = ["rank", "student_id", ...board.problems.map((p) => p.problem_id), "total",
    ...board.problems.map((p) => `${p.problem_id}_repo`)];
  const lines = [head.join(",")];
  for (const r of board.rows) {
    const scores = board.problems.map((p) => {
      const c = r.cells[p.problem_id];
      return c && c.score != null ? String(c.score) : "";
    });
    const repos = board.problems.map((p) => r.cells[p.problem_id]?.repo ?? "");
    lines.push([r.rank, r.student_id, ...scores, r.total, ...repos].join(","));
  }
  return lines.join("\n") + "\n";
}
