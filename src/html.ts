import type { BindingRow } from "./csv";
import type { GradeRow } from "./db/grades";

function h(v: unknown): string {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function adminPage(rows: BindingRow[]): string {
  const trs = rows
    .map(
      (r) => `<tr>
  <td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td>${h(r.github_id)}</td>
  <td>${h(r.updated_at)}</td>
  <td><form method="post" action="/admin/delete" onsubmit="return confirm('確定刪除此綁定？')">
    <input type="hidden" name="nycu_id" value="${h(r.nycu_id)}"><button type="submit">刪除</button></form></td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<title>maccount 管理</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
<h1>綁定名單 (${rows.length})</h1>
<p><a href="/admin/export.csv">⬇ 匯出 CSV（完整綁定）</a>　|　<a href="/admin/roster.csv">⬇ 匯出 roster.csv（github_login,student_id）</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>姓名</th><th>GitHub</th><th>GitHub id</th><th>更新時間</th><th></th></tr></thead>
<tbody>
${trs}
</tbody></table>
</body></html>`;
}

// Logged-in dashboard: NYCU↔GitHub binding (+ bind action), OJ results, and an
// admin link when the user is an admin. Grades show verdict + score ONLY (iron
// rule 2) — never any test data.
export function dashboardPage(
  nycu: { id: string; name: string },
  binding: BindingRow | null,
  grades: GradeRow[],
  admin: boolean,
  flash: { kind: "ok" | "err"; text: string } | null,
): string {
  const gh = binding?.github_login
    ? `已綁定 <b>${h(binding.github_login)}</b> — <a href="/auth/github/start">重新綁定</a>`
    : `<span style="color:#b00">尚未綁定</span> — <a href="/auth/github/start"><b>綁定 GitHub →</b></a>`;

  const rows = grades
    .map(
      (g) => `<tr>
  <td>${h(g.problem_id)}</td>
  <td>${h(g.verdict ?? "-")}</td>
  <td>${g.score == null ? "-" : h(g.score)} / ${g.max_score == null ? "-" : h(g.max_score)}</td>
  <td>${h(g.updated_at)}</td>
</tr>`,
    )
    .join("\n");

  const table = grades.length
    ? `<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>題目</th><th>結果</th><th>分數</th><th>更新時間</th></tr></thead>
<tbody>
${rows}
</tbody></table>`
    : `<p style="color:#666">目前沒有成績資料。送出程式並完成評分後，結果會顯示在這裡。</p>`;

  const flashHtml = flash
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:${
        flash.kind === "ok" ? "#d4edda" : "#f8d7da"
      }">${h(flash.text)}</p>`
    : "";

  const adminHtml = admin
    ? `<p style="margin-top:1.5rem"><a href="/admin"><b>🔧 管理功能</b></a>（綁定名單、匯出 CSV / roster）</p>`
    : "";

  return `<!doctype html><html lang="zh-Hant"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>我的帳號</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
<h1>我的帳號</h1>
${flashHtml}
<p>學號：<b>${h(nycu.id)}</b>${nycu.name ? `（${h(nycu.name)}）` : ""}</p>
<p>GitHub：${gh}</p>
<h2>我的成績</h2>
${table}
<p style="color:#888;font-size:.9em">僅顯示分數與判定結果（AC/WA/TLE…）。測資內容不對外公開。</p>
${adminHtml}
</body></html>`;
}
