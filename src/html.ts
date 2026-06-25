import type { BindingRow } from "./csv";
import type { GradeRow } from "./db/grades";
import { T, langToggle, type Lang } from "./i18n";
import { accountStatusCard, confirmAttrs, fmtTime, h, helpHint, repoHref, verdictBadge } from "./ui/components";
import { documentStart } from "./ui/layout";
import { sortableTh, tableTools, uiEnhancements } from "./ui/tables";

export { fmtTime } from "./ui/components";

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
.form-stack{display:grid!important;gap:1rem!important}.field-hint{display:block;margin-top:.3rem;color:var(--muted);font-size:.82rem;font-weight:400}.check-row{display:flex;align-items:flex-start;gap:.55rem;padding:.55rem .65rem;border-radius:8px;background:var(--surface-soft);font-weight:500}.check-row input{flex:0 0 auto;margin-top:.3rem}.check-row--danger{border:1px solid #efc3c3;background:var(--danger-soft);color:#8f1f1f}
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
.topbar{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-bottom:1.5rem;color:var(--muted);font-size:.9rem}.topbar p{margin:0!important}.topbar__actions{display:flex;align-items:center;gap:.75rem;flex-wrap:wrap}
.identity{margin-bottom:1.25rem}.identity h1{margin-bottom:.25rem}.identity__meta{margin:0;color:var(--muted)}
.account-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1.25rem 0 1.5rem}.status-card{padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface-soft)}.status-card__head{display:flex;align-items:center;justify-content:space-between;gap:.75rem;margin-bottom:.55rem}.status-card__title{font-weight:700}.status-card__value{min-height:1.65rem;margin:0 0 .75rem;overflow-wrap:anywhere}.status-card__action{margin:0;font-size:.9rem}
.badge{display:inline-flex;align-items:center;gap:.35rem;padding:.18rem .5rem;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--muted);font-size:.78rem;font-weight:700;line-height:1.3;white-space:nowrap}.badge::before{content:"";width:.45rem;height:.45rem;border-radius:50%;background:currentColor}.badge--success{border-color:#a8dac1;background:var(--success-soft);color:#08734f}.badge--warning{border-color:#ead483;background:var(--warning-soft);color:#8a6500}.badge--danger{border-color:#efb4b4;background:var(--danger-soft);color:var(--danger)}.badge--neutral{color:#647269}
.with-help{display:inline-flex;align-items:center;gap:.4rem;flex-wrap:wrap}.help-hint{position:relative;display:inline-flex;align-items:center;margin-left:.35rem;vertical-align:middle}.help-hint__button{width:1.35rem;min-width:1.35rem;height:1.35rem;min-height:1.35rem;padding:0;border:1px solid #aac0b6;border-radius:999px;background:#fff;color:var(--brand);font-size:.82rem;font-weight:800;line-height:1}.help-hint__button:hover{background:var(--surface-soft);color:var(--brand-hover)}.help-hint__button[aria-expanded=true]{border-color:var(--brand);background:var(--brand);color:#fff}.help-hint__panel{position:absolute;right:0;top:calc(100% + .45rem);z-index:6;width:min(18rem,80vw);padding:.65rem .75rem;border:1px solid var(--line);border-radius:10px;background:#17211d;color:#fff;box-shadow:0 12px 32px rgba(20,45,34,.18);font-size:.85rem;font-weight:500;line-height:1.5;letter-spacing:0;white-space:normal}.help-hint__panel::before{content:"";position:absolute;top:-.4rem;right:.45rem;border:.4rem solid transparent;border-top:0;border-bottom-color:#17211d}
.alert{padding:.8rem 1rem;border:1px solid var(--line);border-radius:9px}.alert--success{border-color:#b8e4ce;background:var(--success-soft)}.alert--warning{border-color:#eedc93;background:var(--warning-soft)}.alert--danger{border-color:#f1b6b6;background:var(--danger-soft)}
.confirm-dialog{width:min(32rem,calc(100% - 2rem));padding:0;border:1px solid var(--line);border-radius:14px;background:#fff;color:var(--text);box-shadow:0 24px 70px rgba(20,45,34,.24)}.confirm-dialog::backdrop{background:rgba(14,25,20,.56)}.confirm-dialog__body{padding:1.35rem}.confirm-dialog h2{margin:0 0 .65rem;padding:0;border:0}.confirm-dialog p{margin:.5rem 0 1.25rem;color:var(--muted)}.confirm-dialog__actions{display:flex;justify-content:flex-end;gap:.65rem}.button--danger{background:var(--danger)}.button--danger:hover{background:#a61e1e}
.course-list{display:grid;gap:1rem}.course-card{padding:1.1rem;border:1px solid var(--line);border-radius:var(--radius);background:#fff}.course-card h3{display:flex;align-items:center;justify-content:space-between;gap:1rem;margin:0 0 .8rem}.course-card h3::after{content:"";width:.55rem;height:.55rem;border-radius:50%;background:var(--brand)}.course-card>p:last-child{margin-bottom:0}.course-card table{margin-top:.45rem}
.section-nav{position:sticky;top:0;z-index:2;display:flex;gap:.5rem;margin:0 -1rem 1.25rem;padding:.7rem 1rem;overflow-x:auto;border-block:1px solid var(--line);background:rgba(255,255,255,.96);box-shadow:0 5px 16px rgba(20,45,34,.05);white-space:nowrap}.section-nav a{padding:.3rem .55rem;border-radius:6px;text-decoration:none;font-size:.88rem;font-weight:650}.section-nav a:hover{background:var(--surface-soft)}
.stats-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.75rem;margin:1rem 0 1.5rem}.stat{padding:.85rem;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft)}.stat__value{display:block;font-size:1.45rem;font-weight:750;line-height:1.2}.stat__label{display:block;margin-top:.25rem;color:var(--muted);font-size:.82rem}
.course-summary{margin:.25rem 0 1rem}.course-summary .stat{padding:.7rem}.course-summary .stat__value{font-size:1.1rem}.course-summary progress{display:block;width:100%;height:.45rem;margin-top:.45rem;accent-color:var(--brand)}
.admin-sections{display:grid;gap:1rem}.admin-section{scroll-margin-top:5rem;padding:1.2rem;border:1px solid var(--line);border-radius:var(--radius);background:#fff}.admin-section>h2:first-child{margin:0 0 .75rem;padding:0;border:0}.admin-section+.admin-section{margin-top:0}.admin-section form:last-child{margin-bottom:0}
.lang-toggle{display:inline-flex;align-items:center;gap:.5rem;color:var(--muted);font-size:.9rem}.lang-toggle [aria-current="true"]{padding:.2rem .45rem;border-radius:6px;background:var(--surface-soft);color:var(--text);font-weight:700}.empty-state{margin:.8rem 0;padding:1rem;border:1px dashed #b9c7c0;border-radius:10px;background:var(--surface-soft);color:var(--muted);text-align:center;list-style:none}.empty-cell{padding:1.4rem!important;color:var(--muted);text-align:center}.inline-actions{display:flex;align-items:center;gap:.65rem;flex-wrap:wrap}.text-danger{color:var(--danger)}.muted{color:var(--muted)}.text-small{font-size:.9em}
.table-tools{display:grid;grid-template-columns:minmax(220px,1fr) minmax(160px,auto) auto;align-items:end;gap:.75rem;margin:.85rem 0}.table-tools label{font-size:.82rem}.table-tools input,.table-tools select{margin-top:.25rem}.table-count{align-self:center;margin:1.35rem 0 0;color:var(--muted);font-size:.85rem;white-space:nowrap}.copy-field{display:flex;align-items:center;gap:.6rem;flex-wrap:wrap;margin:.75rem 0}.button--secondary{min-height:34px;padding:.4rem .7rem;border-color:var(--line);background:#fff;color:var(--brand);font-size:.85rem}.button--secondary:hover{border-color:#9db2a7;background:var(--surface-soft);color:var(--brand-hover)}tr[hidden]{display:none}
.sort-button{display:flex;width:100%;min-height:0;padding:0;border:0;border-radius:0;background:transparent;color:inherit;font:inherit;text-align:left}.sort-button:hover{background:transparent;color:var(--brand)}.sort-icon{margin-left:.4rem;color:var(--muted)}.course-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1rem;margin:1rem 0}.course-admin-card{display:flex;min-height:150px;flex-direction:column;padding:1.1rem;border:1px solid var(--line);border-radius:var(--radius);background:#fff}.course-admin-card--archived{background:var(--surface-soft)}.course-admin-card__head{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem}.course-admin-card h2{margin:0;padding:0;border:0;font-size:1.1rem}.course-admin-card__meta{margin:.45rem 0 1rem;color:var(--muted);font-size:.88rem}.course-admin-card__action{margin:auto 0 0}.admin-disclosure{margin:1.5rem 0;background:#fff}.admin-disclosure>summary{font-size:1.05rem}.admin-disclosure__body{padding:0 1rem 1rem}.utility-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem}.utility-card{padding:1rem;border:1px solid var(--line);border-radius:10px;background:var(--surface-soft)}.utility-card p{margin:.35rem 0 0;color:var(--muted);font-size:.86rem}
@media(max-width:760px){.stats-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:640px){html{background:var(--surface)}body{width:100%;margin:0!important;padding:1.15rem!important;border:0;border-radius:0;box-shadow:none}h1{margin-top:.75rem}h2{margin-top:1.75rem}th,td{padding:.6rem!important}button{width:100%}.help-hint__button{width:1.45rem;min-width:1.45rem}.help-hint__panel{right:auto;left:50%;transform:translateX(-50%);width:min(18rem,calc(100vw - 2rem))}.help-hint__panel::before{right:auto;left:50%;transform:translateX(-50%)}td button,li button,.button--secondary,.sort-button{width:auto}form[style*="display:inline"]{display:inline!important}.topbar{align-items:flex-start}.topbar__actions{justify-content:flex-end}.account-grid{grid-template-columns:1fr}.section-nav{margin-inline:-1.15rem;padding-inline:1.15rem}.admin-section{padding:1rem}.course-card{padding:1rem}.table-tools{grid-template-columns:1fr}.table-count{margin:0}.copy-field{align-items:stretch}.copy-field code{flex:1;overflow-wrap:anywhere}.course-grid,.utility-grid{grid-template-columns:1fr}.mobile-compact{display:table;table-layout:auto;overflow:visible;white-space:normal}.mobile-compact th,.mobile-compact td{overflow-wrap:anywhere}.mobile-compact .mobile-secondary,.mobile-compact th:nth-child(5){display:none}.mobile-card-table{overflow:visible;white-space:normal}.mobile-card-table thead{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}.mobile-card-table tbody,.mobile-card-table tr,.mobile-card-table td{display:block;width:100%}.mobile-card-table tr{margin-bottom:.75rem;overflow:hidden;border:1px solid var(--line);border-radius:10px;background:#fff}.mobile-card-table td{display:grid;grid-template-columns:minmax(6.5rem,40%) minmax(0,1fr);gap:.75rem;border:0;border-bottom:1px solid var(--line);white-space:normal;overflow-wrap:anywhere}.mobile-card-table td:last-child{border-bottom:0}.mobile-card-table td::before{content:attr(data-label);color:var(--muted);font-size:.82rem;font-weight:700}.mobile-card-table tbody tr:nth-child(even),.mobile-card-table tbody tr:hover{background:#fff}}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important;transition:none!important}}
`;

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
    .map((o) => `<article class="utility-card"><a href="/admin/org/${encodeURIComponent(o)}"><b>${h(o)}</b></a><p>GitHub org</p></article>`)
    .join("\n");
  const bindingsSection = `<h2>${t.bindings_query_heading}</h2>
<div class="utility-grid">
  <article class="utility-card"><a href="/admin/bindings"><b>${t.bindings_all_link}</b></a><p>${t.bindings_query_heading}</p></article>
  ${orgLinks}
</div>
<p class="muted text-small">${t.bindings_query_note}</p>`;
  const items = courses.length
    ? `<div class="course-grid">${courses
        .map(
          (c) => {
            const archived = c.status === "archived";
            return `<article class="course-admin-card${archived ? " course-admin-card--archived" : ""}">
  <div class="course-admin-card__head"><h2>${h(c.name)}</h2><span class="badge badge--${archived ? "neutral" : "success"}">${archived ? t.course_archived : t.course_active}</span></div>
  <p class="course-admin-card__meta"><code>${h(c.course_id)}</code>${c.term ? " · " + h(c.term) : ""}</p>
  <p class="course-admin-card__action"><a class="button button--secondary" href="/c/${encodeURIComponent(c.course_id)}/admin">${t.course_manage} →</a></p>
</article>`;
          },
        )
        .join("\n")}</div>`
    : `<p class="empty-state">${t.no_courses}</p>`;
  const createForm = opts.isOwner
    ? `<details class="admin-disclosure"${courses.length ? "" : " open"}><summary>${t.course_create_expand}${helpHint(t.help_course_create, t.help_label)}</summary><div class="admin-disclosure__body">
<form method="post" action="/admin/courses" class="form-stack" style="max-width:440px">
  <label>${t.ph_course_id}<input name="course_id" placeholder="ds-2026" required pattern="[A-Za-z0-9_-]+" autocomplete="off"></label>
  <label>${t.ph_course_name}<input name="name" placeholder="${t.ph_course_name}" required></label>
  <label>${t.ph_course_term}<input name="term" placeholder="${t.ph_course_term}"></label>
  <label>${t.ph_course_moodle}<input name="moodle_course_id" placeholder="${t.ph_course_moodle}" inputmode="numeric"></label>
  <label>${t.ph_course_org}<input name="github_org" placeholder="${t.ph_course_org}" autocomplete="off"></label>
  <label>${t.ph_course_classroom}<input name="google_classroom_id" placeholder="${t.ph_course_classroom}" autocomplete="off"></label>
  <label>${t.ph_course_meet}<input name="google_meet_url" type="url" placeholder="https://meet.google.com/…"></label>
  <button type="submit">${t.course_create}</button>
</form>
<p class="muted text-small">${t.course_create_note}</p></div></details>`
    : "";
  return `${documentStart(lang, t.admin_title, UI_CSS)}
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
<header class="topbar"><div>${langToggle("/admin", lang)}</div><div class="topbar__actions"><a href="/me">${t.acct_heading}</a><a href="/logout">${t.logout}</a></div></header>
<h1>${t.admin_courses_heading}</h1>
<p class="identity__meta">${t.course_count.replace("{n}", String(courses.length))}</p>
${items}
${createForm}
${bindingsSection}
${uiEnhancements(t)}
</body></html>`;
}

// All bindings (the global registry), independent of course/enrollment — the
// pre-enrollment catch-all. orgs link to the per-org join view.
export function bindingsPage(lang: Lang, rows: BindingRow[], orgs: string[] = []): string {
  const t = T[lang];
  const trs = rows
    .map(
      (r) => `<tr data-row><td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td class="mobile-secondary">${h(r.github_id)}</td><td class="mobile-secondary">${h(r.google_email)}</td><td class="mobile-secondary">${h(fmtTime(r.updated_at))}</td></tr>`,
    )
    .join("\n");
  const orgLinks = orgs
    .map((o) => `<a href="/admin/org/${encodeURIComponent(o)}">${h(o)}</a>`)
    .join("　");
  return `${documentStart(lang, t.admin_title, UI_CSS)}
<body style="font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem">
${langToggle("/admin/bindings", lang)}
<p style="font-size:.9em"><a href="/admin">← ${t.admin_courses_heading}</a></p>
<h1>${t.bindings_all_link}（${rows.length}）</h1>
${orgs.length ? `<p>${t.bindings_query_heading}：${orgLinks}</p>` : ""}
${rows.length ? tableTools(t, "bindings-table", rows.length) : ""}
<table id="bindings-table" class="mobile-compact" border="1" cellpadding="6" cellspacing="0">
<thead><tr>${sortableTh("NYCU id", 0)}${sortableTh(t.th_name, 1)}${sortableTh("GitHub", 2)}${sortableTh(t.th_github_id, 3, "number", "mobile-secondary")}<th>Google</th>${sortableTh(t.th_updated, 5, "text", "mobile-secondary")}</tr></thead>
<tbody>
${trs || `<tr><td colspan="6" class="empty-cell">${t.no_bindings}</td></tr>`}
</tbody></table>
${uiEnhancements(t)}
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
    member: `<span class="badge badge--success">${t.org_status_member}</span>`,
    pending: `<span class="badge badge--warning">${t.org_status_pending}</span>`,
    none: `<span class="badge badge--neutral">${t.org_status_none}</span>`,
  };
  // Bound students sorted: in-org first (member, pending), then not-in-org.
  const order: Record<string, number> = { member: 0, pending: 1, none: 2 };
  const sorted = [...view.rows].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9));
  const trs = sorted
    .map(
      (r) => `<tr data-row data-status="${h(r.status)}"><td>${h(r.github_login)}</td><td>${h(r.student_id)}</td>
  <td class="mobile-secondary">${h(r.nycu_name)}</td><td>${badge[r.status] ?? h(r.status)}</td></tr>`,
    )
    .join("\n");
  const unbound = view.unbound.length
    ? `<h2>${t.org_unbound_heading}（${view.unbound.length}）</h2>
<p class="muted text-small">${t.org_unbound_note}</p>
<p>${view.unbound.map((l) => h(l)).join("、")}</p>`
    : "";
  return `${documentStart(lang, t.admin_title, UI_CSS)}
<body style="font-family:system-ui;max-width:900px;margin:2rem auto;padding:0 1rem">
${langToggle(`/admin/org/${encodeURIComponent(org)}`, lang)}
<p style="font-size:.9em"><a href="/admin">← ${t.admin_courses_heading}</a>　|　<a href="/admin/bindings">${t.bindings_all_link}</a></p>
<h1>GitHub org：${h(org)}</h1>
${err ? `<p style="padding:8px;border:1px solid #c00;background:#fee">${t.org_fetch_error}：${h(err)}</p>` : ""}
${sorted.length ? tableTools(t, "org-members-table", sorted.length, [
    { value: "member", label: t.org_status_member },
    { value: "pending", label: t.org_status_pending },
    { value: "none", label: t.org_status_none },
  ]) : ""}
<table id="org-members-table" class="mobile-compact" border="1" cellpadding="6" cellspacing="0">
<thead><tr>${sortableTh("GitHub", 0)}${sortableTh("NYCU id", 1)}${sortableTh(t.th_name, 2, "text", "mobile-secondary")}${sortableTh(t.org_status_col, 3)}</tr></thead>
<tbody>
${trs || `<tr><td colspan="4" class="empty-cell">${t.no_bindings}</td></tr>`}
</tbody></table>
${unbound}
${uiEnhancements(t)}
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
      ? `<p class="alert alert--${opts.staffMsg === "ok" ? "success" : opts.staffMsg === "error" ? "danger" : "warning"}" role="${opts.staffMsg === "error" ? "alert" : "status"}">${syncMsg[opts.staffMsg]}</p>`
      : "";
  const trs = rows
    .map(
      (r) => `<tr data-row>
  <td>${h(r.nycu_id)}</td><td>${h(r.nycu_name)}</td>
  <td>${h(r.github_login)}</td><td class="mobile-secondary">${h(r.github_id)}</td>
  <td class="mobile-secondary">${h(r.google_email)}</td>
  <td class="mobile-secondary">${h(fmtTime(r.updated_at))}</td>${
    isOwner
      ? `
  <td><form method="post" action="${base}/delete" ${confirmAttrs(
    t.confirm_delete,
    t.confirm_delete_detail.replace("{id}", r.nycu_id),
    t.delete,
  )}>
    <input type="hidden" name="nycu_id" value="${h(r.nycu_id)}"><button type="submit">${t.delete}</button></form></td>`
      : ""
  }
</tr>`,
    )
    .join("\n");

  // Staff/TA management — owner only.
  const staffRows = staff
    .map(
      (s) => `<tr><td>${h(s.nycu_id)}</td><td class="mobile-secondary">${h(s.added_by)}</td>
  <td><form method="post" action="${base}/staff/remove" ${confirmAttrs(
    t.staff_remove_confirm,
    t.staff_remove_confirm_detail.replace("{id}", s.nycu_id),
    t.staff_remove,
  )}>
    <input type="hidden" name="nycu_id" value="${h(s.nycu_id)}"><button type="submit">${t.staff_remove}</button></form></td></tr>`,
    )
    .join("\n");
  const staffSection = isOwner
    ? `<section class="admin-section" id="staff"><h2 class="with-help">${t.staff_heading}${helpHint(t.help_staff, t.help_label)}</h2>
<p class="muted text-small">${t.staff_note}</p>
<table class="mobile-compact" border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>NYCU id</th><th class="mobile-secondary">${t.staff_added_by}</th><th></th></tr></thead>
<tbody>${staffRows}</tbody></table>
<form method="post" action="${base}/staff/add" class="form-stack" style="margin-top:12px">
  <label>${t.staff_id_label}<input name="nycu_id" placeholder="${t.staff_id_placeholder}" required autocomplete="off"></label>
  <button type="submit">${t.staff_add}</button>
</form></section>`
    : "";

  // Enrollment (course roster). Bound = has a GitHub binding; unbound students
  // still need to bind. Import is owner-only.
  const bound = enrolled.filter((e) => e.github_login).length;
  const gbound = enrolled.filter((e) => e.google_email).length;
  const enrolledRows = enrolled
    .map(
      (e) => `<tr data-row data-status="${e.github_login && e.google_email ? "complete" : "missing"}"><td>${h(e.student_id)}</td><td>${
        e.github_login ? h(e.github_login) : `<span class="badge badge--danger">${t.enroll_unbound}</span>`
      }</td><td>${
        e.google_email ? h(e.google_email) : `<span class="badge badge--danger">${t.enroll_unbound}</span>`
      }</td></tr>`,
    )
    .join("\n");
  const enrollImport = isOwner
    ? `<form method="post" action="${base}/enroll" class="form-stack" style="margin-top:12px" ${confirmAttrs(
      t.enroll_replace_confirm,
      t.enroll_replace_confirm_detail,
      t.enroll_import,
      "replace",
    )}>
  <label>${t.enroll_ids_label}<textarea name="student_ids" rows="4" cols="40" placeholder="${t.enroll_placeholder}" required spellcheck="false"></textarea></label>
  <label class="check-row check-row--danger"><input type="checkbox" name="replace" value="1"> <span>${t.enroll_replace}${helpHint(t.help_roster_replace, t.help_label)}</span></label>
  <button type="submit">${t.enroll_import}</button>
</form>`
    : "";
  const enrollSection = `<section class="admin-section" id="enrollment"><h2 class="with-help">${t.enroll_heading.replace("{n}", String(enrolled.length))}${helpHint(t.help_enrollment, t.help_label)}</h2>
<p class="muted text-small">${t.enroll_note.replace("{bound}", String(bound)).replace("{gbound}", String(gbound))}</p>${
    enrolled.length
      ? `
<details><summary>${t.enroll_show_list}</summary>
${tableTools(t, "enrollment-table", enrolled.length, [{ value: "missing", label: t.table_filter_unbound }])}
<table id="enrollment-table" class="mobile-compact" border="1" cellpadding="6" cellspacing="0">
<thead><tr>${sortableTh("NYCU id", 0)}${sortableTh("GitHub", 1)}<th>Google</th></tr></thead>
<tbody>${enrolledRows}</tbody></table></details>`
      : ""
  }
${enrollImport}</section>`;

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
    ? `<p class="alert alert--${dm.startsWith("done:") ? "success" : dm === "token-error" ? "danger" : "warning"}" role="${dm === "token-error" ? "alert" : "status"}">${driveBannerText}</p>`
    : "";
  const driveSection = `<section class="admin-section" id="drive"><h2 class="with-help">${t.drive_heading}${helpHint(t.help_drive, t.help_label)}</h2>
<p class="muted text-small">${t.drive_note} <a href="/auth/google/start?drive=1">${t.drive_connect}</a></p>
${driveBanner}
<form method="post" action="${base}/drive/share" class="form-stack" style="max-width:440px">
  <label>${t.drive_file_label}<input name="file_id" placeholder="${t.drive_file_placeholder}" required autocomplete="off"></label>
  <label>${t.drive_role_label}<select name="role">
    <option value="reader">${t.drive_role_reader}</option>
    <option value="commenter">${t.drive_role_commenter}</option>
    <option value="writer">${t.drive_role_writer}</option>
  </select></label>
  <label class="check-row"><input type="checkbox" name="notify" value="1"> <span>${t.drive_notify}</span></label>
  <button type="submit">${t.drive_share_btn}</button>
</form></section>`;

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
    ? `<p class="alert alert--danger" role="alert">${formsMsgText[opts.formsMsg]}</p>`
    : "";
  const formsRows = forms.length
    ? `<ul>${forms
        .map((f) => {
          const editLink = f.form_id
            ? ` — <a href="https://docs.google.com/forms/d/${encodeURIComponent(f.form_id)}/edit" target="_blank" rel="noopener">${t.forms_edit} ↗</a>`
            : "";
          const preBadge = f.pre_enroll ? ` <span class="badge badge--neutral">${t.forms_pre_enroll_badge}</span>` : "";
          return `<li>${linkOrText(f.url, f.title)}${preBadge}${editLink}
  <form method="post" action="${base}/forms/remove" style="display:inline" ${confirmAttrs(
    t.forms_remove_confirm,
    t.forms_remove_confirm_detail.replace("{title}", f.title),
    t.forms_remove,
  )}>
    <input type="hidden" name="id" value="${h(f.id)}"><button type="submit">${t.forms_remove}</button></form></li>`;
        })
        .join("\n")}</ul>`
    : `<p class="empty-state">${t.forms_none}</p>`;
  const preEnrollLabel = `<label class="check-row"><input type="checkbox" name="pre_enroll" value="1"> <span>${t.forms_pre_enroll_label}</span></label>`;
  const formsSection = `<section class="admin-section" id="forms"><h2 class="with-help">${t.forms_heading}${helpHint(t.help_forms, t.help_label)}</h2>
<p class="muted text-small">${t.forms_note}</p>
<div class="copy-field"><span>${t.prejoin_link_label}${helpHint(t.help_prejoin_link, t.help_label)}：</span><code>/me/${h(course.course_id)}</code><button type="button" class="button button--secondary" data-copy-path="/me/${h(course.course_id)}">${t.copy_link}</button></div>
${formsBanner}
${formsRows}
<form method="post" action="${base}/forms/add" class="form-stack" style="max-width:440px">
  <label>${t.forms_title_label}<input name="title" placeholder="${t.forms_title_ph}" required></label>
  <label>${t.forms_url_label}<input name="url" type="url" placeholder="${t.forms_url_ph}" required inputmode="url"></label>
  ${preEnrollLabel}
  <button type="submit">${t.forms_add}</button>
</form>
<p class="muted text-small" style="margin-top:.8rem">${t.forms_create_note}</p>
<form method="post" action="${base}/forms/create" class="form-stack" style="max-width:440px">
  <label>${t.forms_title_label}<input name="title" placeholder="${t.forms_create_title_ph}" required></label>
  ${preEnrollLabel}
  <button type="submit">${t.forms_create_btn}</button>
</form></section>`;

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
    ? `<p class="alert alert--${cm.startsWith("done:") ? "success" : cm === "token-error" ? "danger" : "warning"}" role="${cm === "token-error" ? "alert" : "status"}">${classroomBannerText}</p>`
    : "";
  const classroomSection = `<section class="admin-section" id="classroom"><h2 class="with-help">${t.classroom_heading}${helpHint(t.help_classroom, t.help_label)}</h2>
<p class="muted text-small">${t.classroom_note}</p>
${classroomBanner}
${
    classroomId
      ? `<p>Classroom ID：<code>${h(classroomId)}</code></p>
<form method="post" action="${base}/classroom/invite"><button type="submit">${t.classroom_invite_btn}</button></form>`
      : `<p class="alert alert--warning">${t.classroom_no_id}</p>`
  }</section>`;

  // Course settings — owner edits name/term/Moodle/org/status (re-submits the
  // upsert with the same course_id).
  const settingsSection = isOwner
    ? `<section class="admin-section" id="settings"><h2 class="with-help">${t.course_settings}${helpHint(t.help_settings, t.help_label)}</h2>
<form method="post" action="/admin/courses" class="form-stack" style="max-width:440px">
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
</form></section>`
    : "";

  const adminNav = `<nav class="section-nav" aria-label="${h(course.name)}">
  <a href="#bindings">${t.admin_bindings.replace("{n}", String(rows.length))}</a>
  <a href="#enrollment">${t.enroll_heading.replace("{n}", String(enrolled.length))}</a>
  <a href="#drive">${t.drive_heading}</a>
  <a href="#forms">${t.forms_heading}</a>
  <a href="#classroom">${t.classroom_heading}</a>
  ${isOwner ? `<a href="#staff">${t.staff_heading}</a><a href="#settings">${t.course_settings}</a>` : ""}
</nav>`;
  const stats = `<div class="stats-grid" aria-label="${t.enroll_heading.replace("{n}", String(enrolled.length))}">
  <div class="stat"><span class="stat__value">${rows.length}</span><span class="stat__label">${t.admin_bindings.replace("{n}", String(rows.length))}</span></div>
  <div class="stat"><span class="stat__value">${enrolled.length}</span><span class="stat__label">${t.enroll_heading.replace("{n}", String(enrolled.length))}</span></div>
  <div class="stat"><span class="stat__value">${bound}</span><span class="stat__label">${t.github} ${t.bound}</span></div>
  <div class="stat"><span class="stat__value">${gbound}</span><span class="stat__label">${t.google} ${t.bound}</span></div>
</div>`;

  return `${documentStart(lang, t.admin_title, UI_CSS)}
<body style="font-family:system-ui;max-width:900px;margin:2rem auto">
<header class="topbar"><div>${langToggle(base, lang)}</div><div class="topbar__actions"><a href="/admin">← ${t.admin_courses_heading}</a></div></header>
<div class="identity"><h1>${h(course.name)}</h1><p class="identity__meta">${h(course.course_id)}${course.term ? ` · ${h(course.term)}` : ""}</p></div>
${stats}
${adminNav}
<div class="admin-sections">
<section class="admin-section" id="bindings"><h2 class="with-help">${t.admin_bindings.replace("{n}", String(rows.length))}${helpHint(t.help_bindings, t.help_label)}</h2>
${banner}
<p><a href="${base}/export.csv">${t.export_full}</a>　|　<a href="${base}/roster.csv">${t.export_roster}</a>${helpHint(t.help_exports, t.help_label)}</p>
${rows.length ? tableTools(t, "course-bindings-table", rows.length) : ""}
<table id="course-bindings-table" class="mobile-compact" border="1" cellpadding="6" cellspacing="0">
<thead><tr>${sortableTh("NYCU id", 0)}${sortableTh(t.th_name, 1)}${sortableTh("GitHub", 2)}${sortableTh(t.th_github_id, 3, "number", "mobile-secondary")}<th>Google</th>${sortableTh(t.th_updated, 5, "text", "mobile-secondary")}${isOwner ? `<th>${t.th_actions}</th>` : ""}</tr></thead>
<tbody>
${trs || `<tr><td colspan="${isOwner ? "7" : "6"}" class="empty-cell">${t.no_bindings}</td></tr>`}
</tbody></table></section>
${enrollSection}
${driveSection}
${formsSection}
${classroomSection}
${staffSection}
${settingsSection}
</div>
${uiEnhancements(t)}
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
  const accountCards = `<div class="account-grid" aria-label="${t.acct_heading}">
  ${accountStatusCard(t, t.github, binding?.github_login, "/auth/github/start", t.bind_action, t.help_account_binding)}
  ${accountStatusCard(t, t.google, binding?.google_email, "/auth/google/start", t.bind_google_action, t.help_account_binding)}
</div>`;

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
  <td data-label="${h(t.col_problem)}">${problemCell(g)}</td>
  <td data-label="${h(t.col_result)}">${verdictBadge(g.verdict)}</td>
  <td data-label="${h(t.col_score)}">${g.score == null ? "-" : h(g.score)} / ${g.max_score == null ? "-" : h(g.max_score)}</td>
  <td data-label="${h(t.col_updated)}">${h(fmtTime(g.updated_at))}</td>
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
  const courseTable = (rs: GradeRow[]) => `<table class="mobile-card-table" border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>${t.col_problem}</th><th>${t.col_result}</th><th>${t.col_score}</th><th>${t.col_updated}</th></tr></thead>
<tbody>
${renderRows(rs)}
</tbody></table>`;

  const courseSummary = (rs: GradeRow[]) => {
    const withResults = rs.filter((g) => g.verdict != null || g.score != null);
    const accepted = withResults.filter((g) =>
      ["AC", "PASS", "PASSED", "OK"].includes((g.verdict ?? "").trim().toUpperCase()),
    ).length;
    const scored = rs.filter((g) => g.score != null && g.max_score != null);
    const score = scored.reduce((sum, g) => sum + Number(g.score), 0);
    const max = scored.reduce((sum, g) => sum + Number(g.max_score), 0);
    const latest = rs
      .map((g, index) => ({ raw: g.updated_at, time: Date.parse(g.updated_at ?? ""), index }))
      .filter((item) => Number.isFinite(item.time))
      .sort((a, b) => b.time - a.time || b.index - a.index)[0]?.raw ?? rs.at(-1)?.updated_at;
    const scoreText = max > 0 ? `${score} / ${max}` : "-";
    const progressLabel = h(t.grade_summary_progress.replace("{score}", String(score)).replace("{max}", String(max)));
    const progress = max > 0
      ? `<progress value="${h(score)}" max="${h(max)}" aria-label="${progressLabel}">${scoreText}</progress>`
      : "";
    return `<div class="stats-grid course-summary" aria-label="${h(t.grade_summary_label)}">
  <div class="stat"><span class="stat__value">${withResults.length} / ${rs.length}</span><span class="stat__label">${t.grade_summary_graded}</span></div>
  <div class="stat"><span class="stat__value">${accepted}</span><span class="stat__label">${t.grade_summary_accepted}${helpHint(t.help_verdict, t.help_label)}</span></div>
  <div class="stat"><span class="stat__value">${scoreText}</span><span class="stat__label">${t.grade_summary_score}</span>${progress}</div>
  <div class="stat"><span class="stat__value text-small">${h(fmtTime(latest))}</span><span class="stat__label">${t.grade_summary_latest}</span></div>
</div>`;
  };

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
    ? `<div class="course-list">${courseOrder
        .map((cid) => {
          const rs = gradesByCourse.get(cid) ?? [];
          const parts: string[] = [];
          const meet = meetByCourse[cid];
          if (meet) parts.push(`<p>${linkOrText(meet, t.meet_join)}</p>`);
          if (rs.length) parts.push(courseSummary(rs), courseBlock(rs));
          const fhtml = formsFor(cid);
          if (fhtml) parts.push(fhtml);
          const inner = parts.length ? parts.join("") : `<p class="empty-state">${t.course_no_data}</p>`;
          return `<article class="course-card"><h3>${h(courseName(cid))}${rs.length ? helpHint(t.help_grade_summary, t.help_label) : ""}</h3>\n${inner}</article>`;
        })
        .join("\n")}</div>`
    : `<p class="empty-state">${t.no_grades}</p>`;

  const okFlash = flash.bound ? t.flash_bound_ok : flash.gbound ? t.flash_gbound_ok : "";
  const flashHtml = okFlash
    ? `<p class="alert alert--success" role="status">${okFlash}</p>`
    : flash.error
      ? `<p class="alert alert--danger" role="alert">${t.flash_error_prefix}${h(flash.error)}</p>`
      : "";

  const adminHtml = admin
    ? `<p style="margin-top:1.5rem"><a class="button" href="/admin">${t.admin_link}</a></p>`
    : "";

  const orgHtml = orgJoins.length
    ? `<p class="alert alert--warning">${t.join_org_prompt} ` +
      orgJoins
        .map((j) => `<a href="${h(j.url)}" target="_blank" rel="noopener"><b>${h(j.org)}</b></a>`)
        .join("　") +
      `</p>`
    : "";

  return `${documentStart(lang, t.acct_title, UI_CSS)}
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
<header class="topbar"><div>${langToggle("/me", lang)}</div><div class="topbar__actions"><a href="/logout">${t.logout}</a></div></header>
<div class="identity"><h1>${t.acct_heading}</h1><p class="identity__meta">${t.student_id}：<b>${h(nycu.id)}</b>${nycu.name ? ` · ${h(nycu.name)}` : ""}</p></div>
${flashHtml}
${accountCards}
${orgHtml}
<h2>${t.my_courses_heading}</h2>
${table}
<p class="muted text-small">${t.privacy_note}</p>
${adminHtml}
${uiEnhancements(t)}
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
        ? `<a href="${h(url)}" target="_blank" rel="noopener">${t.exam_go_solve} ↗</a>${helpHint(t.help_exam_repo, t.help_label)}`
        : `<span class="muted">${t.exam_no_repo}</span>`;
      return `<tr><td data-label="${h(t.col_problem)}">${h(g.problem_id)}</td><td data-label="repo">${repoCell}</td>
  <td data-label="${h(t.col_result)}">${verdictBadge(g.verdict)}</td>
  <td data-label="${h(t.col_score)}">${g.score == null ? "-" : h(g.score)} / ${g.max_score == null ? "-" : h(g.max_score)}</td></tr>`;
    })
    .join("\n");
  return `${documentStart(lang, h(title), UI_CSS)}
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
${langToggle(`/me/exam/${encodeURIComponent(assignmentId)}`, lang)}
<p style="font-size:.9em"><a href="/me">← ${t.acct_heading}</a></p>
<h1>${h(title)}</h1>
<p class="muted text-small">${t.exam_intro}</p>
<table class="mobile-card-table" border="1" cellpadding="6" cellspacing="0">
<thead><tr><th>${t.col_problem}</th><th>repo</th><th>${t.col_result}</th><th>${t.col_score}</th></tr></thead>
<tbody>
${trs}
</tbody></table>
<p class="muted text-small">${t.privacy_note}</p>
${uiEnhancements(t)}
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
  const okFlash = flash.bound ? t.flash_bound_ok : flash.gbound ? t.flash_gbound_ok : "";
  const flashHtml = okFlash
    ? `<p class="alert alert--success" role="status">${okFlash}</p>`
    : "";
  const formsHtml = forms.length
    ? `<ul>${forms.map((f) => `<li>${linkOrText(f.url, f.title)}</li>`).join("")}</ul>`
    : `<p class="empty-state">${t.forms_none}</p>`;
  return `${documentStart(lang, h(courseName), UI_CSS)}
<body style="font-family:system-ui;max-width:760px;margin:2rem auto;padding:0 1rem;line-height:1.6">
<header class="topbar"><div>${langToggle(`/me/${encodeURIComponent(courseId)}`, lang)}</div><div class="topbar__actions"><a href="/me">${t.acct_heading}</a><a href="/logout">${t.logout}</a></div></header>
<div class="identity"><h1>${h(courseName)}</h1><p class="identity__meta">${t.student_id}：<b>${h(nycu.id)}</b>${nycu.name ? ` · ${h(nycu.name)}` : ""}</p></div>
<p style="color:#555">${t.prejoin_intro}</p>
${flashHtml}
<div class="account-grid" aria-label="${t.acct_heading}">
${accountStatusCard(t, t.github, binding?.github_login, "/auth/github/start", t.bind_action, t.help_account_binding)}
${accountStatusCard(t, t.google, binding?.google_email, "/auth/google/start", t.bind_google_action, t.help_account_binding)}
</div>
<h2 class="with-help">${t.forms_student_heading}${helpHint(t.help_forms, t.help_label)}</h2>
${formsHtml}
${uiEnhancements(t)}
</body></html>`;
}
