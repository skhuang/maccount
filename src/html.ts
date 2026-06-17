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

// Render a stored updated_at (epoch seconds/ms, or an ISO string) as a readable
// Asia/Taipei timestamp "YYYY/MM/DD HH:MM". Falls back to the raw value.
export function fmtTime(raw: string | null | undefined): string {
  if (raw == null || String(raw).trim() === "") return "-";
  const s = String(raw).trim();
  const num = Number(s);
  let d: Date;
  if (Number.isFinite(num) && num > 0) {
    d = new Date(num * (num < 1e12 ? 1000 : 1)); // seconds vs ms
  } else {
    d = new Date(s);
  }
  if (isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("zh-TW", {
      timeZone: "Asia/Taipei",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 16).replace("T", " ");
  }
}

interface StaffLite {
  nycu_id: string;
  added_by: string | null;
}

export function adminPage(
  lang: Lang,
  rows: BindingRow[],
  opts: { isOwner: boolean; staff: StaffLite[]; staffMsg?: string } = { isOwner: false, staff: [] },
): string {
  const t = T[lang];
  const { isOwner, staff } = opts;
  // Flash from a staff add/remove → GitHub org/team sync (see syncStaffToGitHub).
  const syncMsg: Record<string, string> = {
    ok: t.staff_sync_ok,
    "no-binding": t.staff_sync_nobinding,
    error: t.staff_sync_error,
  };
  const banner =
    isOwner && opts.staffMsg && syncMsg[opts.staffMsg]
      ? `<p style="padding:8px;border:1px solid #ccc;background:#f6f6f6">${syncMsg[opts.staffMsg]}</p>`
      : "";
  const trs = rows
    .map(
      (r) => `<tr>
  <td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td>${h(r.github_id)}</td>
  <td>${h(fmtTime(r.updated_at))}</td>${
    isOwner
      ? `
  <td><form method="post" action="/admin/delete" onsubmit="return confirm('${t.confirm_delete}')">
    <input type="hidden" name="nycu_id" value="${h(r.nycu_id)}"><button type="submit">${t.delete}</button></form></td>`
      : ""
  }
</tr>`,
    )
    .join("\n");

  // Staff/TA management — owner only.
  const staffRows = staff
    .map(
      (s) => `<tr><td>${h(s.nycu_id)}</td><td>${h(s.added_by)}</td>
  <td><form method="post" action="/admin/staff/remove" onsubmit="return confirm('${t.staff_remove_confirm}')">
    <input type="hidden" name="nycu_id" value="${h(s.nycu_id)}"><button type="submit">${t.staff_remove}</button></form></td></tr>`,
    )
    .join("\n");
  const staffSection = isOwner
    ? `<h2>${t.staff_heading}</h2>
<p style="color:#777;font-size:.9em">${t.staff_note}</p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.staff_added_by}</th><th></th></tr></thead>
<tbody>${staffRows}</tbody></table>
<form method="post" action="/admin/staff/add" style="margin-top:8px">
  <input name="nycu_id" placeholder="${t.staff_id_placeholder}" required>
  <button type="submit">${t.staff_add}</button>
</form>`
    : "";

  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
${langToggle("/admin", lang)}
<h1>${t.admin_bindings.replace("{n}", String(rows.length))}</h1>
${banner}
<p><a href="/admin/export.csv">${t.export_full}</a>　|　<a href="/admin/roster.csv">${t.export_roster}</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.th_name}</th><th>GitHub</th><th>${t.th_github_id}</th><th>${t.th_updated}</th>${isOwner ? `<th>${t.th_actions}</th>` : ""}</tr></thead>
<tbody>
${trs}
</tbody></table>
${staffSection}
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
  <td>${h(fmtTime(g.updated_at))}</td>
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
<p style="text-align:right;font-size:.9em"><a href="/logout">${t.logout}</a></p>
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
