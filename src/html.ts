import type { BindingRow } from "./csv";
import type { GradeRow } from "./db/grades";
import { T, langToggle, type Lang } from "./i18n";

function h(v: unknown): string {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

function htmlLang(lang: Lang): string {
  return lang === "en" ? "en" : "zh-Hant";
}

export function adminPage(lang: Lang, rows: BindingRow[]): string {
  const t = T[lang];
  const trs = rows
    .map(
      (r) => `<tr>
  <td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td>${h(r.github_id)}</td>
  <td>${h(r.updated_at)}</td>
  <td><form method="post" action="/admin/delete" onsubmit="return confirm('${t.confirm_delete}')">
    <input type="hidden" name="nycu_id" value="${h(r.nycu_id)}"><button type="submit">${t.delete}</button></form></td>
</tr>`,
    )
    .join("\n");
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
${langToggle("/admin", lang)}
<h1>${t.admin_bindings.replace("{n}", String(rows.length))}</h1>
<p><a href="/admin/export.csv">${t.export_full}</a>　|　<a href="/admin/roster.csv">${t.export_roster}</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.th_name}</th><th>GitHub</th><th>${t.th_github_id}</th><th>${t.th_updated}</th><th>${t.th_actions}</th></tr></thead>
<tbody>
${trs}
</tbody></table>
</body></html>`;
}

// Logged-in dashboard: NYCU↔GitHub binding (+ bind action), OJ results, and an
// admin link when the user is an admin. Grades show verdict + score ONLY (iron
// rule 2) — never any test data.
export function dashboardPage(
  lang: Lang,
  nycu: { id: string; name: string },
  binding: BindingRow | null,
  grades: GradeRow[],
  admin: boolean,
  flash: { bound?: boolean; error?: string | null },
  orgJoinUrl: string = "",
): string {
  const t = T[lang];
  const gh = binding?.github_login
    ? `${t.bound} <b>${h(binding.github_login)}</b> — <a href="/auth/github/start">${t.rebind}</a>`
    : `<span style="color:#b00">${t.not_bound}</span> — <a href="/auth/github/start"><b>${t.bind_action}</b></a>`;

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
<thead><tr><th>${t.col_problem}</th><th>${t.col_result}</th><th>${t.col_score}</th><th>${t.col_updated}</th></tr></thead>
<tbody>
${rows}
</tbody></table>`
    : `<p style="color:#666">${t.no_grades}</p>`;

  const flashHtml = flash.bound
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#d4edda">${t.flash_bound_ok}</p>`
    : flash.error
      ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#f8d7da">${t.flash_error_prefix}${h(flash.error)}</p>`
      : "";

  const adminHtml = admin
    ? `<p style="margin-top:1.5rem"><a href="/admin"><b>${t.admin_link}</b></a></p>`
    : "";

  const orgHtml = orgJoinUrl
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#fff3cd">${t.join_org_prompt} ` +
      `<a href="${h(orgJoinUrl)}" target="_blank" rel="noopener"><b>${t.join_org_link}</b></a></p>`
    : "";

  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${t.acct_title}</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle("/me", lang)}
<h1>${t.acct_heading}</h1>
${flashHtml}
<p>${t.student_id}：<b>${h(nycu.id)}</b>${nycu.name ? `（${h(nycu.name)}）` : ""}</p>
<p>${t.github}：${gh}</p>
${orgHtml}
<h2>${t.grades_heading}</h2>
${table}
<p style="color:#888;font-size:.9em">${t.privacy_note}</p>
${adminHtml}
</body></html>`;
}
