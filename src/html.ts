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

// Shared, dependency-free UI foundation for every Worker-rendered page. Keep
// this inline so authenticated pages do not depend on a separate static host.
const UI_CSS = `
:root{color-scheme:light;--bg:#f4f7f6;--surface:#fff;--surface-soft:#f8faf9;--text:#17211d;--muted:#5f6f67;--line:#dbe4df;--brand:#087f5b;--brand-hover:#066b4c;--danger:#c92a2a;--danger-soft:#fff0f0;--success-soft:#eaf8f1;--warning-soft:#fff8db;--radius:12px;--shadow:0 12px 32px rgba(20,45,34,.08);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
*{box-sizing:border-box}
html{min-height:100%;background:var(--bg)}
body{max-width:780px!important;margin:2rem auto!important;padding:clamp(1.25rem,3vw,2.5rem)!important;background:var(--surface);color:var(--text);line-height:1.65!important;border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
body:has(table){max-width:1040px!important}
h1,h2,h3{line-height:1.25;letter-spacing:-.02em;color:var(--text)}
h1{font-size:clamp(1.75rem,4vw,2.3rem);margin:.4rem 0 1.4rem}
h2{font-size:1.25rem;margin:2.25rem 0 .75rem;padding-top:1.25rem;border-top:1px solid var(--line)}
h3{font-size:1.05rem}
p{margin:.75rem 0}
a{color:var(--brand);text-underline-offset:3px;text-decoration-thickness:1px}
a:hover{color:var(--brand-hover)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,summary:focus-visible{outline:3px solid rgba(8,127,91,.28);outline-offset:2px}
ul{padding-left:1.35rem}li+li{margin-top:.35rem}
form{max-width:560px}
label{display:block;color:var(--text);font-weight:600}
label input:not([type=checkbox]),label select{display:block;width:100%;margin-top:.35rem}
input:not([type=checkbox]):not([type=hidden]),select,textarea{width:100%;min-height:44px;padding:.65rem .75rem;border:1px solid #b9c7c0;border-radius:8px;background:#fff;color:var(--text);font:inherit}
textarea{min-height:7rem;resize:vertical}
input::placeholder,textarea::placeholder{color:#73827a}
button,.button{display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:.58rem 1rem;border:1px solid transparent;border-radius:8px;background:var(--brand);color:#fff;font-family:inherit;font-size:.95rem;font-weight:600;line-height:1.2;cursor:pointer;text-decoration:none;transition:background .15s ease,transform .15s ease}
button:hover,.button:hover{background:var(--brand-hover);color:#fff}
button:active,.button:active{transform:translateY(1px)}
form[action$="/delete"] button,form[action$="/remove"] button{border-color:#f1b6b6;background:#fff;color:var(--danger)}
form[action$="/delete"] button:hover,form[action$="/remove"] button:hover{background:var(--danger-soft)}
table{display:block;width:100%;overflow-x:auto;border:0!important;border-collapse:collapse;white-space:nowrap;-webkit-overflow-scrolling:touch}
thead{background:var(--surface-soft)}
th,td{padding:.7rem .8rem!important;border:1px solid var(--line);text-align:left;vertical-align:top}
th{font-size:.86rem;color:#405047}
tbody tr:nth-child(even){background:#fbfcfb}
tbody tr:hover{background:#f2f8f5}
td form{margin:0}
details{margin:.8rem 0;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft)}
summary{padding:.75rem 1rem;cursor:pointer;font-weight:650}
details table{margin:0;border-radius:0}
code{padding:.12rem .35rem;border-radius:5px;background:#eef2f0;font-size:.9em}
body>p[style*="background"]{padding:.75rem 1rem!important;border:1px solid var(--line);border-radius:9px!important}
body>p[style*="#d4edda"]{background:var(--success-soft)!important;border-color:#b8e4ce}
body>p[style*="#f8d7da"],body>p[style*="#fee"]{background:var(--danger-soft)!important;border-color:#f1b6b6}
body>p[style*="#fff3cd"]{background:var(--warning-soft)!important;border-color:#eedc93}
@media(max-width:640px){html{background:var(--surface)}body{width:100%;margin:0!important;padding:1.15rem!important;border:0;border-radius:0;box-shadow:none}h1{margin-top:.75rem}h2{margin-top:1.75rem}th,td{padding:.6rem!important}button{width:100%}td button,li button{width:auto}form[style*="display:inline"]{display:inline!important}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;

function uiHead(): string {
  return `<meta name="viewport" content="width=device-width, initial-scale=1"><style>${UI_CSS}</style>`;
}

// The student's repo link for a problem: a bare owner/name → github.com; a full
// http(s) URL (e.g. a Gitea exam repo) is used as-is. null when no repo yet.
function repoHref(repo: string | null | undefined): string | null {
  if (!repo) return null;
  return /^https?:\/\//.test(repo) ? repo : `https://github.com/${repo}`;
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

interface CourseLite {
  course_id: string;
  name: string;
  term?: string | null;
  status?: string;
}

// /admin course picker: owners see all courses + a create form; staff see only
// the courses they belong to. Each links to /c/<course_id>/admin.
export function adminHomePage(
  lang: Lang,
  courses: CourseLite[],
  opts: { isOwner: boolean; orgs?: string[] } = { isOwner: false },
): string {
  const t = T[lang];
  // Query bindings by GitHub org — for students who bound but aren't enrolled
  // in any course yet (so the per-course views don't show them).
  const orgs = opts.orgs ?? [];
  const orgLinks = orgs
    .map((o) => `<li><a href="/admin/org/${encodeURIComponent(o)}">${h(o)}</a></li>`)
    .join("\n");
  const bindingsSection = `<h2>${t.bindings_query_heading}</h2>
<ul>
  <li><a href="/admin/bindings"><b>${t.bindings_all_link}</b></a></li>
  ${orgLinks}
</ul>
<p style="color:#777;font-size:.9em">${t.bindings_query_note}</p>`;
  const items = courses.length
    ? courses
        .map(
          (c) => `<li><a href="/c/${encodeURIComponent(c.course_id)}/admin"><b>${h(c.name)}</b></a>
  <span style="color:#999">${h(c.course_id)}${c.term ? " · " + h(c.term) : ""}${
    c.status && c.status !== "active" ? " · " + h(c.status) : ""
  }</span></li>`,
        )
        .join("\n")
    : `<li style="color:#666">${t.no_courses}</li>`;
  const createForm = opts.isOwner
    ? `<h2>${t.course_create}</h2>
<form method="post" action="/admin/courses" style="display:grid;gap:6px;max-width:440px">
  <input name="course_id" placeholder="${t.ph_course_id}" required pattern="[A-Za-z0-9_-]+">
  <input name="name" placeholder="${t.ph_course_name}" required>
  <input name="term" placeholder="${t.ph_course_term}">
  <input name="moodle_course_id" placeholder="${t.ph_course_moodle}">
  <input name="github_org" placeholder="${t.ph_course_org}">
  <input name="google_classroom_id" placeholder="${t.ph_course_classroom}">
  <input name="google_meet_url" placeholder="${t.ph_course_meet}">
  <button type="submit">${t.course_create}</button>
</form>
<p style="color:#777;font-size:.9em">${t.course_create_note}</p>`
    : "";
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle("/admin", lang)}
<p style="text-align:right;font-size:.9em"><a href="/me">${t.acct_heading}</a>　|　<a href="/logout">${t.logout}</a></p>
<h1>${t.admin_courses_heading}</h1>
<ul>${items}</ul>
${createForm}
${bindingsSection}
</body></html>`;
}

// All bindings (the global registry), independent of course/enrollment — the
// pre-enrollment catch-all. orgs link to the per-org join view.
export function bindingsPage(lang: Lang, rows: BindingRow[], orgs: string[] = []): string {
  const t = T[lang];
  const trs = rows
    .map(
      (r) => `<tr><td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td>${h(r.github_id)}</td><td>${h(r.google_email)}</td><td>${h(fmtTime(r.updated_at))}</td></tr>`,
    )
    .join("\n");
  const orgLinks = orgs
    .map((o) => `<a href="/admin/org/${encodeURIComponent(o)}">${h(o)}</a>`)
    .join("　");
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem">
${langToggle("/admin/bindings", lang)}
<p style="font-size:.9em"><a href="/admin">← ${t.admin_courses_heading}</a></p>
<h1>${t.bindings_all_link}（${rows.length}）</h1>
${orgs.length ? `<p>${t.bindings_query_heading}：${orgLinks}</p>` : ""}
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.th_name}</th><th>GitHub</th><th>${t.th_github_id}</th><th>${t.google}</th><th>${t.th_updated}</th></tr></thead>
<tbody>
${trs}
</tbody></table>
</body></html>`;
}

// Query bindings by GitHub org: each binding tagged with its membership of this
// org (member/pending/—), plus org members/invitees with no maccount binding.
export function orgMembersPage(
  lang: Lang,
  org: string,
  view: { rows: { student_id: string; nycu_name: string | null; github_login: string | null; status: string }[]; unbound: string[] },
  err = "",
): string {
  const t = T[lang];
  const badge: Record<string, string> = {
    member: `<span style="color:#0a0">${t.org_status_member}</span>`,
    pending: `<span style="color:#b80">${t.org_status_pending}</span>`,
    none: `<span style="color:#999">${t.org_status_none}</span>`,
  };
  // Bound students sorted: in-org first (member, pending), then not-in-org.
  const order: Record<string, number> = { member: 0, pending: 1, none: 2 };
  const sorted = [...view.rows].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const trs = sorted
    .map(
      (r) => `<tr><td>${h(r.github_login)}</td><td>${h(r.student_id)}</td>
  <td>${h(r.nycu_name)}</td><td>${badge[r.status] ?? h(r.status)}</td></tr>`,
    )
    .join("\n");
  const unbound = view.unbound.length
    ? `<h2>${t.org_unbound_heading}（${view.unbound.length}）</h2>
<p style="color:#777;font-size:.9em">${t.org_unbound_note}</p>
<p>${view.unbound.map((l) => h(l)).join("、")}</p>`
    : "";
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem">
${langToggle(`/admin/org/${encodeURIComponent(org)}`, lang)}
<p style="font-size:.9em"><a href="/admin">← ${t.admin_courses_heading}</a>　|　<a href="/admin/bindings">${t.bindings_all_link}</a></p>
<h1>GitHub org：${h(org)}</h1>
${err ? `<p style="padding:8px;border:1px solid #c00;background:#fee">${t.org_fetch_error}：${h(err)}</p>` : ""}
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>GitHub</th><th>NYCU id</th><th>${t.th_name}</th><th>${t.org_status_col}</th></tr></thead>
<tbody>
${trs}
</tbody></table>
${unbound}
</body></html>`;
}

interface EnrolledLite {
  student_id: string;
  github_login: string | null;
  google_email?: string | null;
}

interface FormLite {
  id: number;
  title: string;
  url: string;
  form_id?: string | null; // present when created via the Forms API → edit link
  pre_enroll?: number;     // 1 = shown to not-yet-enrolled students on /me/<course_id>
}

// Only render a clickable link for an http(s) URL; otherwise show plain text.
// Defense-in-depth on top of the http(s) check at insert time.
function linkOrText(url: string, label: string): string {
  return /^https?:\/\//i.test(url)
    ? `<a href="${h(url)}" target="_blank" rel="noopener">${h(label)} ↗</a>`
    : h(label);
}

export function adminPage(
  lang: Lang,
  course: {
    course_id: string;
    name: string;
    term?: string | null;
    moodle_course_id?: string | null;
    github_org?: string | null;
    google_classroom_id?: string | null;
    google_meet_url?: string | null;
    status?: string;
  },
  rows: BindingRow[],
  opts: {
    isOwner: boolean;
    staff: StaffLite[];
    staffMsg?: string;
    driveMsg?: string;
    formsMsg?: string;
    classroomMsg?: string;
    enrolled?: EnrolledLite[];
    forms?: FormLite[];
  } = { isOwner: false, staff: [] },
): string {
  const t = T[lang];
  const { isOwner, staff } = opts;
  const enrolled = opts.enrolled ?? [];
  const base = `/c/${encodeURIComponent(course.course_id)}/admin`;
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
  <td>${h(r.google_email)}</td>
  <td>${h(fmtTime(r.updated_at))}</td>${
    isOwner
      ? `
  <td><form method="post" action="${base}/delete" onsubmit="return confirm('${t.confirm_delete}')">
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
  <td><form method="post" action="${base}/staff/remove" onsubmit="return confirm('${t.staff_remove_confirm}')">
    <input type="hidden" name="nycu_id" value="${h(s.nycu_id)}"><button type="submit">${t.staff_remove}</button></form></td></tr>`,
    )
    .join("\n");
  const staffSection = isOwner
    ? `<h2>${t.staff_heading}</h2>
<p style="color:#777;font-size:.9em">${t.staff_note}</p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.staff_added_by}</th><th></th></tr></thead>
<tbody>${staffRows}</tbody></table>
<form method="post" action="${base}/staff/add" style="margin-top:8px">
  <input name="nycu_id" placeholder="${t.staff_id_placeholder}" required>
  <button type="submit">${t.staff_add}</button>
</form>`
    : "";

  // Enrollment (course roster). Bound = has a GitHub binding; unbound students
  // still need to bind. Import is owner-only.
  const bound = enrolled.filter((e) => e.github_login).length;
  const gbound = enrolled.filter((e) => e.google_email).length;
  const enrolledRows = enrolled
    .map(
      (e) => `<tr><td>${h(e.student_id)}</td><td>${
        e.github_login ? h(e.github_login) : `<span style="color:#b00">${t.enroll_unbound}</span>`
      }</td><td>${
        e.google_email ? h(e.google_email) : `<span style="color:#b00">${t.enroll_unbound}</span>`
      }</td></tr>`,
    )
    .join("\n");
  const enrollImport = isOwner
    ? `<form method="post" action="${base}/enroll" style="margin-top:8px">
  <textarea name="student_ids" rows="4" cols="40" placeholder="${t.enroll_placeholder}"></textarea><br>
  <label><input type="checkbox" name="replace" value="1"> ${t.enroll_replace}</label><br>
  <button type="submit">${t.enroll_import}</button>
</form>`
    : "";
  const enrollSection = `<h2>${t.enroll_heading.replace("{n}", String(enrolled.length))}</h2>
<p style="color:#777;font-size:.9em">${t.enroll_note.replace("{bound}", String(bound)).replace("{gbound}", String(gbound))}</p>${
    enrolled.length
      ? `
<details><summary>${t.enroll_show_list}</summary>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>GitHub</th><th>Google</th></tr></thead>
<tbody>${enrolledRows}</tbody></table></details>`
      : ""
  }
${enrollImport}`;

  // Share a staff-owned Drive file with the class (any course staff). Acts as
  // the logged-in staff's own connected Google Drive; recipients are the
  // enrolled+bound students' Google emails.
  const dm = opts.driveMsg ?? "";
  let driveBannerText = "";
  if (dm.startsWith("done:")) {
    const [, shared = "0", errors = "0", skipped = "0"] = dm.split(":");
    driveBannerText = t.drive_msg_done
      .replace("{shared}", shared).replace("{errors}", errors).replace("{skipped}", skipped);
  } else if (dm === "no-file") driveBannerText = t.drive_msg_nofile;
  else if (dm === "no-drive") driveBannerText = t.drive_msg_nodrive;
  else if (dm === "token-error") driveBannerText = t.drive_msg_tokenerror;
  const driveBanner = driveBannerText
    ? `<p style="padding:8px;border:1px solid #ccc;background:#f6f6f6">${driveBannerText}</p>`
    : "";
  const driveSection = `<h2>${t.drive_heading}</h2>
<p style="color:#777;font-size:.9em">${t.drive_note} <a href="/auth/google/start?drive=1">${t.drive_connect}</a></p>
${driveBanner}
<form method="post" action="${base}/drive/share" style="display:grid;gap:6px;max-width:440px">
  <input name="file_id" placeholder="${t.drive_file_placeholder}" required>
  <select name="role">
    <option value="reader">${t.drive_role_reader}</option>
    <option value="commenter">${t.drive_role_commenter}</option>
    <option value="writer">${t.drive_role_writer}</option>
  </select>
  <label><input type="checkbox" name="notify" value="1"> ${t.drive_notify}</label>
  <button type="submit">${t.drive_share_btn}</button>
</form>`;

  // Google Forms attached to the course (any course staff). Students see these
  // on /me under the matching course and answer signed into Google.
  const forms = opts.forms ?? [];
  const formsMsgText: Record<string, string> = {
    bad: t.forms_msg_bad,
    "no-drive": t.forms_msg_nodrive,
    "token-error": t.forms_msg_tokenerror,
    "create-error": t.forms_msg_createerror,
  };
  const formsBanner = opts.formsMsg && formsMsgText[opts.formsMsg]
    ? `<p style="padding:8px;border:1px solid #c00;background:#fee">${formsMsgText[opts.formsMsg]}</p>`
    : "";
  const formsRows = forms.length
    ? `<ul>${forms
        .map((f) => {
          const editLink = f.form_id
            ? ` — <a href="https://docs.google.com/forms/d/${encodeURIComponent(f.form_id)}/edit" target="_blank" rel="noopener">${t.forms_edit} ↗</a>`
            : "";
          const preBadge = f.pre_enroll ? ` <span style="color:#0a7">${t.forms_pre_enroll_badge}</span>` : "";
          return `<li>${linkOrText(f.url, f.title)}${preBadge}${editLink}
  <form method="post" action="${base}/forms/remove" style="display:inline" onsubmit="return confirm('${t.forms_remove_confirm}')">
    <input type="hidden" name="id" value="${h(f.id)}"><button type="submit">${t.forms_remove}</button></form></li>`;
        })
        .join("\n")}</ul>`
    : `<p style="color:#666">${t.forms_none}</p>`;
  const preEnrollLabel = `<label><input type="checkbox" name="pre_enroll" value="1"> ${t.forms_pre_enroll_label}</label>`;
  const formsSection = `<h2>${t.forms_heading}</h2>
<p style="color:#777;font-size:.9em">${t.forms_note}</p>
<p style="color:#777;font-size:.9em">${t.prejoin_link_label}：<code>/me/${h(course.course_id)}</code></p>
${formsBanner}
${formsRows}
<form method="post" action="${base}/forms/add" style="display:grid;gap:6px;max-width:440px">
  <input name="title" placeholder="${t.forms_title_ph}" required>
  <input name="url" type="url" placeholder="${t.forms_url_ph}" required>
  ${preEnrollLabel}
  <button type="submit">${t.forms_add}</button>
</form>
<p style="color:#777;font-size:.9em;margin-top:.8rem">${t.forms_create_note}</p>
<form method="post" action="${base}/forms/create" style="display:grid;gap:6px;max-width:440px">
  <input name="title" placeholder="${t.forms_create_title_ph}" required>
  ${preEnrollLabel}
  <button type="submit">${t.forms_create_btn}</button>
</form>`;

  // Google Classroom — invite enrolled+bound students into the course's
  // Classroom (acts as the staff's connected Google account; needs the
  // google_classroom_id set in course settings).
  const classroomId = (course.google_classroom_id ?? "").trim();
  const cm = opts.classroomMsg ?? "";
  let classroomBannerText = "";
  if (cm.startsWith("done:")) {
    const [, invited = "0", already = "0", errors = "0", skipped = "0"] = cm.split(":");
    classroomBannerText = t.classroom_msg_done
      .replace("{invited}", invited).replace("{already}", already)
      .replace("{errors}", errors).replace("{skipped}", skipped);
  } else if (cm === "no-classroom") classroomBannerText = t.classroom_msg_noid;
  else if (cm === "no-drive") classroomBannerText = t.classroom_msg_nodrive;
  else if (cm === "token-error") classroomBannerText = t.classroom_msg_tokenerror;
  const classroomBanner = classroomBannerText
    ? `<p style="padding:8px;border:1px solid #ccc;background:#f6f6f6">${classroomBannerText}</p>`
    : "";
  const classroomSection = `<h2>${t.classroom_heading}</h2>
<p style="color:#777;font-size:.9em">${t.classroom_note}</p>
${classroomBanner}
${
    classroomId
      ? `<p>Classroom ID：<code>${h(classroomId)}</code></p>
<form method="post" action="${base}/classroom/invite"><button type="submit">${t.classroom_invite_btn}</button></form>`
      : `<p style="color:#b00">${t.classroom_no_id}</p>`
  }`;

  // Course settings — owner edits name/term/Moodle/org/status (re-submits the
  // upsert with the same course_id).
  const settingsSection = isOwner
    ? `<h2>${t.course_settings}</h2>
<form method="post" action="/admin/courses" style="display:grid;gap:6px;max-width:440px">
  <input type="hidden" name="course_id" value="${h(course.course_id)}">
  <label>${t.ph_course_name}<input name="name" value="${h(course.name)}" required></label>
  <label>${t.ph_course_term}<input name="term" value="${h(course.term ?? "")}"></label>
  <label>${t.ph_course_moodle}<input name="moodle_course_id" value="${h(course.moodle_course_id ?? "")}"></label>
  <label>${t.ph_course_org}<input name="github_org" value="${h(course.github_org ?? "")}"></label>
  <label>${t.ph_course_classroom}<input name="google_classroom_id" value="${h(course.google_classroom_id ?? "")}"></label>
  <label>${t.ph_course_meet}<input name="google_meet_url" value="${h(course.google_meet_url ?? "")}"></label>
  <label>${t.course_status}
    <select name="status">
      <option value="active"${course.status !== "archived" ? " selected" : ""}>active</option>
      <option value="archived"${course.status === "archived" ? " selected" : ""}>archived</option>
    </select></label>
  <button type="submit">${t.course_save}</button>
</form>`
    : "";

  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${t.admin_title}</title>
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
${langToggle(base, lang)}
<p style="font-size:.9em"><a href="/admin">← ${t.admin_courses_heading}</a></p>
<h1>${h(course.name)} <span style="color:#999;font-size:.6em">${h(course.course_id)}</span></h1>
<h2>${t.admin_bindings.replace("{n}", String(rows.length))}</h2>
${banner}
<p><a href="${base}/export.csv">${t.export_full}</a>　|　<a href="${base}/roster.csv">${t.export_roster}</a></p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th>${t.th_name}</th><th>GitHub</th><th>${t.th_github_id}</th><th>${t.google}</th><th>${t.th_updated}</th>${isOwner ? `<th>${t.th_actions}</th>` : ""}</tr></thead>
<tbody>
${trs}
</tbody></table>
${enrollSection}
${driveSection}
${formsSection}
${classroomSection}
${staffSection}
${settingsSection}
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
  flash: { bound?: boolean; gbound?: boolean; error?: string | null },
  orgJoins: { org: string; url: string }[] = [],
  courseNames: Record<string, string> = {},
  enrolledCourses: { course_id: string; name: string }[] = [],
  formsByCourse: Record<string, { title: string; url: string }[]> = {},
  meetByCourse: Record<string, string> = {},
): string {
  const t = T[lang];
  const gh = binding?.github_login
    ? `${t.bound} <b>${h(binding.github_login)}</b> — <a href="/auth/github/start">${t.rebind}</a>`
    : `<span style="color:#b00">${t.not_bound}</span> — <a href="/auth/github/start"><b>${t.bind_action}</b></a>`;
  const goog = binding?.google_email
    ? `${t.bound} <b>${h(binding.google_email)}</b> — <a href="/auth/google/start">${t.rebind}</a>`
    : `<span style="color:#b00">${t.not_bound}</span> — <a href="/auth/google/start"><b>${t.bind_google_action}</b></a>`;

  // The student's own repo for the problem; link to it when present. A bare
  // owner/name → github.com; a full http(s) URL is used as-is.
  const problemCell = (g: GradeRow) => {
    const pid = h(g.problem_id);
    const url = repoHref(g.repo);
    return url ? `<a href="${h(url)}" target="_blank" rel="noopener">${pid} ↗</a>` : pid;
  };
  const renderRows = (rs: GradeRow[]) =>
    rs
      .map(
        (g) => `<tr>
  <td>${problemCell(g)}</td>
  <td>${h(g.verdict ?? "-")}</td>
  <td>${g.score == null ? "-" : h(g.score)} / ${g.max_score == null ? "-" : h(g.max_score)}</td>
  <td>${h(fmtTime(g.updated_at))}</td>
</tr>`,
      )
      .join("\n");

  // Grades grouped by course (arrive ordered by course_id from listGradesFor).
  const gradesByCourse = new Map<string, GradeRow[]>();
  for (const g of grades) {
    const arr = gradesByCourse.get(g.course_id) ?? [];
    arr.push(g);
    gradesByCourse.set(g.course_id, arr);
  }
  const courseTable = (rs: GradeRow[]) => `<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>${t.col_problem}</th><th>${t.col_result}</th><th>${t.col_score}</th><th>${t.col_updated}</th></tr></thead>
<tbody>
${renderRows(rs)}
</tbody></table>`;

  // Within a course: labs/assignments (and untyped) shown flat; exams grouped
  // into an exam list the student enters at /me/exam/<assignment_id>.
  const courseBlock = (rs: GradeRow[]) => {
    const labRows = rs.filter((g) => g.assignment_type !== "exam");
    const exams = new Map<string, string>(); // assignment_id -> title
    for (const g of rs) {
      if (g.assignment_type === "exam" && g.assignment_id) {
        exams.set(g.assignment_id, g.assignment_title || g.assignment_id);
      }
    }
    const labs = labRows.length
      ? `<p style="margin:.3rem 0 .2rem;font-weight:600">${t.assignments_heading}</p>
${courseTable(labRows)}`
      : "";
    const examList = exams.size
      ? `<p style="margin:.3rem 0 .2rem;font-weight:600">${t.exam_list_heading}</p>
<ul>${[...exams].map(([aid, title]) =>
          `<li><a href="/me/exam/${encodeURIComponent(aid)}">${h(title)} ↗</a></li>`).join("")}</ul>`
      : "";
    return labs + examList;
  };

  // Course list = enrolled courses (Moodle roster, shown even with no data yet)
  // ∪ any course the student has grades in (back-compat when not yet enrolled).
  const courseOrder: string[] = [];
  const seenCourse = new Set<string>();
  for (const c of enrolledCourses) {
    if (!seenCourse.has(c.course_id)) { courseOrder.push(c.course_id); seenCourse.add(c.course_id); }
  }
  for (const cid of [...gradesByCourse.keys()].sort()) {
    if (!seenCourse.has(cid)) { courseOrder.push(cid); seenCourse.add(cid); }
  }
  const courseName = (cid: string) =>
    enrolledCourses.find((c) => c.course_id === cid)?.name || courseNames[cid] || cid;
  // Google Forms attached to the course; the student opens them and answers
  // signed into Google (the form enforces sign-in / email collection).
  const formsFor = (cid: string) => {
    const fs = formsByCourse[cid] ?? [];
    if (!fs.length) return "";
    return `<p style="margin:.3rem 0 .2rem;font-weight:600">${t.forms_student_heading}</p>
<ul>${fs.map((f) => `<li>${linkOrText(f.url, f.title)}</li>`).join("")}</ul>`;
  };
  const table = courseOrder.length
    ? courseOrder
        .map((cid) => {
          const rs = gradesByCourse.get(cid) ?? [];
          const parts: string[] = [];
          const meet = meetByCourse[cid];
          if (meet) parts.push(`<p>${linkOrText(meet, t.meet_join)}</p>`);
          if (rs.length) parts.push(courseBlock(rs));
          const fhtml = formsFor(cid);
          if (fhtml) parts.push(fhtml);
          const inner = parts.length ? parts.join("") : `<p style="color:#666">${t.course_no_data}</p>`;
          return `<h3 style="margin:1rem 0 .3rem">${h(courseName(cid))}</h3>\n${inner}`;
        })
        .join("\n")
    : `<p style="color:#666">${t.no_grades}</p>`;

  const okFlash = flash.bound ? t.flash_bound_ok : flash.gbound ? t.flash_gbound_ok : "";
  const flashHtml = okFlash
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#d4edda">${okFlash}</p>`
    : flash.error
      ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#f8d7da">${t.flash_error_prefix}${h(flash.error)}</p>`
      : "";

  const adminHtml = admin
    ? `<p style="margin-top:1.5rem"><a href="/admin"><b>${t.admin_link}</b></a></p>`
    : "";

  const orgHtml = orgJoins.length
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#fff3cd">${t.join_org_prompt} ` +
      orgJoins
        .map((j) => `<a href="${h(j.url)}" target="_blank" rel="noopener"><b>${h(j.org)}</b></a>`)
        .join("　") +
      `</p>`
    : "";

  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${t.acct_title}</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle("/me", lang)}
<p style="text-align:right;font-size:.9em"><a href="/logout">${t.logout}</a></p>
<h1>${t.acct_heading}</h1>
${flashHtml}
<p>${t.student_id}：<b>${h(nycu.id)}</b>${nycu.name ? `（${h(nycu.name)}）` : ""}</p>
<p>${t.github}：${gh}</p>
<p>${t.google}：${goog}</p>
${orgHtml}
<h2>${t.my_courses_heading}</h2>
${table}
<p style="color:#888;font-size:.9em">${t.privacy_note}</p>
${adminHtml}
</body></html>`;
}

// One exam, the logged-in student's view: each coding problem with its repo
// ("去解題") link + score. Reached from /me's exam list.
export function examPage(lang: Lang, assignmentId: string, rows: GradeRow[]): string {
  const t = T[lang];
  const title = rows.find((r) => r.assignment_title)?.assignment_title || assignmentId;
  const trs = rows
    .map((g) => {
      const url = repoHref(g.repo);
      const repoCell = url
        ? `<a href="${h(url)}" target="_blank" rel="noopener">${t.exam_go_solve} ↗</a>`
        : `<span style="color:#999">${t.exam_no_repo}</span>`;
      return `<tr><td>${h(g.problem_id)}</td><td>${repoCell}</td>
  <td>${h(g.verdict ?? "-")}</td>
  <td>${g.score == null ? "-" : h(g.score)} / ${g.max_score == null ? "-" : h(g.max_score)}</td></tr>`;
    })
    .join("\n");
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${h(title)}</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle(`/me/exam/${encodeURIComponent(assignmentId)}`, lang)}
<p style="font-size:.9em"><a href="/me">← ${t.acct_heading}</a></p>
<h1>${h(title)}</h1>
<p style="color:#888;font-size:.9em">${t.exam_intro}</p>
<table border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>${t.col_problem}</th><th>repo</th><th>${t.col_result}</th><th>${t.col_score}</th></tr></thead>
<tbody>
${trs}
</tbody></table>
<p style="color:#888;font-size:.9em">${t.privacy_note}</p>
</body></html>`;
}

// Per-course landing for (esp. not-yet-enrolled) students: bind GitHub/Google +
// fill the course's pre-enrollment form(s). Reached at /me/<course_id>.
export function coursePrejoinPage(
  lang: Lang,
  courseId: string,
  courseName: string,
  nycu: { id: string; name: string },
  binding: BindingRow | null,
  forms: { title: string; url: string }[],
  flash: { bound?: boolean; gbound?: boolean } = {},
): string {
  const t = T[lang];
  const gh = binding?.github_login
    ? `${t.bound} <b>${h(binding.github_login)}</b> — <a href="/auth/github/start">${t.rebind}</a>`
    : `<span style="color:#b00">${t.not_bound}</span> — <a href="/auth/github/start"><b>${t.bind_action}</b></a>`;
  const goog = binding?.google_email
    ? `${t.bound} <b>${h(binding.google_email)}</b> — <a href="/auth/google/start">${t.rebind}</a>`
    : `<span style="color:#b00">${t.not_bound}</span> — <a href="/auth/google/start"><b>${t.bind_google_action}</b></a>`;
  const okFlash = flash.bound ? t.flash_bound_ok : flash.gbound ? t.flash_gbound_ok : "";
  const flashHtml = okFlash
    ? `<p style="padding:.5rem .8rem;border-radius:6px;background:#d4edda">${okFlash}</p>`
    : "";
  const formsHtml = forms.length
    ? `<ul>${forms.map((f) => `<li>${linkOrText(f.url, f.title)}</li>`).join("")}</ul>`
    : `<p style="color:#666">${t.forms_none}</p>`;
  return `<!doctype html><html lang="${htmlLang(lang)}"><meta charset="utf-8">${uiHead()}
<title>${h(courseName)}</title>
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle(`/me/${encodeURIComponent(courseId)}`, lang)}
<p style="text-align:right;font-size:.9em"><a href="/me">${t.acct_heading}</a>　|　<a href="/logout">${t.logout}</a></p>
<h1>${h(courseName)}</h1>
<p style="color:#555">${t.prejoin_intro}</p>
${flashHtml}
<p>${t.student_id}：<b>${h(nycu.id)}</b>${nycu.name ? `（${h(nycu.name)}）` : ""}</p>
<p>${t.github}：${gh}</p>
<p>${t.google}：${goog}</p>
<h2>${t.forms_student_heading}</h2>
${formsHtml}
</body></html>`;
}
