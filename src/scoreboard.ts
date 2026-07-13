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
  const maxByPid = new Map<string, number | null>();     // problem's own max_score
  const weightByPid = new Map<string, number | null>();  // this assignment's `points`
  const rawByStudent = new Map<string, Record<string, { score: number | null; verdict: string | null; repo: string | null }>>();

  const bump = (m: Map<string, number | null>, pid: string, v: number | null) => {
    if (v == null) return;
    const cur = m.get(pid) ?? null;
    if (cur == null || v > cur) m.set(pid, v);
  };

  for (const r of rows) {
    if (!maxByPid.has(r.problem_id)) order.push(r.problem_id);
    if (!maxByPid.has(r.problem_id)) maxByPid.set(r.problem_id, null);
    bump(maxByPid, r.problem_id, r.max_score);
    bump(weightByPid, r.problem_id, r.points);
    let cells = rawByStudent.get(r.student_id);
    if (!cells) { cells = {}; rawByStudent.set(r.student_id, cells); }
    cells[r.problem_id] = { score: r.score, verdict: r.verdict, repo: r.repo };
  }

  // A cell is worth `points` (the assignment weight); the stored score is out of
  // the problem's own max_score, so weight it: round(score / max_score * points).
  // Fall back to the raw score when points is absent (pre-weighting data). Mirrors
  // dsjudge's scoreboard (#149) so both boards agree.
  const worthOf = (pid: string) => weightByPid.get(pid) ?? maxByPid.get(pid) ?? 0;
  const weighted = (pid: string, raw: number | null): number | null => {
    if (raw == null) return null;
    const max = maxByPid.get(pid) ?? null;
    const w = weightByPid.get(pid);
    if (w == null) return raw;                       // no points → raw score
    return max && max > 0 ? Math.round((raw / max) * w) : 0;
  };

  const out: SbRow[] = [];
  for (const [student_id, raw] of rawByStudent) {
    const cells: Record<string, SbCell> = {};
    let total = 0;
    for (const pid of order) {
      const c = raw[pid];
      const w = c ? weighted(pid, c.score) : null;
      cells[pid] = { score: w, verdict: c?.verdict ?? null, repo: c?.repo ?? null };
      total += w ?? 0;
    }
    out.push({ rank: 0, student_id, total, cells });
  }
  out.sort((a, b) => b.total - a.total || a.student_id.localeCompare(b.student_id));

  let rank = 0;
  let prev = Number.NaN;
  out.forEach((r, i) => {
    if (r.total !== prev) { rank = i + 1; prev = r.total; }
    r.rank = rank;
  });

  // max_score here reports the cell's WORTH (points when set, else the problem
  // max), so max_total = Σ worth and the weighted cells sum to each row's total.
  const problems = order.map((problem_id) => ({ problem_id, max_score: worthOf(problem_id) }));
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
