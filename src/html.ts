import type { BindingRow } from "./csv";

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
<p><a href="/admin/export.csv">⬇ 匯出 CSV</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>姓名</th><th>GitHub</th><th>GitHub id</th><th>更新時間</th><th></th></tr></thead>
<tbody>
${trs}
</tbody></table>
</body></html>`;
}
