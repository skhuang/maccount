// Minimal bilingual support (zh-Hant default, en selectable).
// Language is chosen by `?lang=` (zh|en), else a `lang` cookie, else zh.
export type Lang = "zh" | "en";

export function pickLang(url: URL, cookieHeader: string | null): Lang {
  const q = url.searchParams.get("lang");
  if (q === "en" || q === "zh") return q;
  const m = (cookieHeader || "").match(/(?:^|;\s*)lang=(en|zh)\b/);
  return m ? (m[1] as Lang) : "zh";
}

export function langCookie(lang: Lang): string {
  // Not HttpOnly: a non-secret UI preference the static pages may also read.
  return `lang=${lang}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export interface Strings {
  acct_title: string;
  acct_heading: string;
  student_id: string;
  github: string;
  bound: string;
  rebind: string;
  not_bound: string;
  bind_action: string;
  grades_heading: string;
  col_problem: string;
  col_result: string;
  col_score: string;
  col_updated: string;
  no_grades: string;
  privacy_note: string;
  admin_link: string;
  logout: string;
  join_org_prompt: string;
  join_org_link: string;
  flash_bound_ok: string;
  flash_error_prefix: string;
  admin_title: string;
  admin_bindings: string; // "{n}" placeholder
  export_full: string;
  export_roster: string;
  admin_courses_heading: string;
  no_courses: string;
  course_create: string;
  course_create_note: string;
  ph_course_id: string;
  ph_course_name: string;
  ph_course_term: string;
  ph_course_moodle: string;
  ph_course_org: string;
  bindings_query_heading: string;
  bindings_all_link: string;
  bindings_query_note: string;
  org_status_col: string;
  org_status_member: string;
  org_status_pending: string;
  org_status_none: string;
  org_unbound_heading: string;
  org_unbound_note: string;
  org_fetch_error: string;
  course_settings: string;
  course_status: string;
  course_save: string;
  enroll_heading: string; // "{n}" placeholder
  enroll_note: string; // "{bound}" placeholder
  enroll_show_list: string;
  enroll_unbound: string;
  enroll_placeholder: string;
  enroll_replace: string;
  enroll_import: string;
  th_name: string;
  th_github_id: string;
  th_updated: string;
  th_actions: string;
  delete: string;
  confirm_delete: string;
  staff_heading: string;
  staff_note: string;
  staff_added_by: string;
  staff_id_placeholder: string;
  staff_add: string;
  staff_remove: string;
  staff_remove_confirm: string;
  staff_sync_ok: string;
  staff_sync_nobinding: string;
  staff_sync_error: string;
}

export const T: Record<Lang, Strings> = {
  zh: {
    acct_title: "我的帳號",
    acct_heading: "我的帳號",
    student_id: "學號",
    github: "GitHub",
    bound: "已綁定",
    rebind: "重新綁定",
    not_bound: "尚未綁定",
    bind_action: "綁定 GitHub →",
    grades_heading: "我的成績",
    col_problem: "題目",
    col_result: "結果",
    col_score: "分數",
    col_updated: "更新時間",
    no_grades: "目前沒有成績資料。送出程式並完成評分後，結果會顯示在這裡。",
    privacy_note: "僅顯示分數與判定結果（AC/WA/TLE…）。測資內容不對外公開。",
    admin_link: "🔧 管理功能（綁定名單、匯出 CSV / roster）",
    logout: "登出（換帳號）",
    join_org_prompt: "尚未加入課程 GitHub 組織?（需先用你綁定的 GitHub 登入;已加入可忽略）",
    join_org_link: "接受邀請加入課程組織 →",
    flash_bound_ok: "GitHub 綁定成功。",
    flash_error_prefix: "操作未完成：",
    admin_title: "maccount 管理",
    admin_bindings: "綁定名單 ({n})",
    admin_courses_heading: "課程列表",
    no_courses: "尚無課程。",
    course_create: "建立／更新課程",
    course_create_note: "course_id 為英數與 - _（如 ds-2026）；moodle_course_id 為 Moodle 課程數字 id（之後對應選課/成績用）。再次送出相同 course_id 即更新。",
    ph_course_id: "course_id（如 ds-2026）",
    ph_course_name: "課程名稱（如 資料結構 2026）",
    ph_course_term: "學期（如 2026 / 2026-fall）",
    ph_course_moodle: "moodle_course_id（選填）",
    ph_course_org: "github_org（選填）",
    bindings_query_heading: "查詢綁定（依 GitHub org）",
    bindings_all_link: "所有綁定",
    bindings_query_note: "學生綁定 GitHub 後、還沒選課時，可由此查；點 org 可即時比對誰已加入該 org。",
    org_status_col: "org 狀態",
    org_status_member: "已加入",
    org_status_pending: "待接受",
    org_status_none: "未加入",
    org_unbound_heading: "已在 org、未在 maccount 綁定",
    org_unbound_note: "這些 GitHub 帳號在 org 內，但沒有對應的 maccount 綁定（請其到 /me 綁定學號）。",
    org_fetch_error: "讀取 org 成員失敗",
    course_settings: "課程設定",
    course_status: "狀態",
    course_save: "儲存課程設定",
    enroll_heading: "選課名單（{n}）",
    enroll_note: "已綁定 GitHub：{bound}。匯入後，此課的綁定名單與 roster 匯出會縮到「選課∩已綁」。",
    enroll_show_list: "顯示選課名單",
    enroll_unbound: "未綁定",
    enroll_placeholder: "貼上學號，一行一個（或以逗號／空白分隔）",
    enroll_replace: "取代整份名單（與 Moodle 同步；未列出者移除）",
    enroll_import: "匯入選課名單",
    export_full: "⬇ 匯出 CSV（完整綁定）",
    export_roster: "⬇ 匯出 roster.csv（github_login,student_id）",
    th_name: "姓名",
    th_github_id: "GitHub id",
    th_updated: "更新時間",
    th_actions: "",
    delete: "刪除",
    confirm_delete: "確定刪除此綁定？",
    staff_heading: "TA／助教管理",
    staff_note: "助教（NYCU 帳號）可檢視名單與匯出；只有 ADMIN_IDS 內的擁有者能新增/移除助教或刪除綁定。",
    staff_added_by: "加入者",
    staff_id_placeholder: "NYCU 帳號（學號/教職員帳號）",
    staff_add: "新增助教",
    staff_remove: "移除",
    staff_remove_confirm: "確定移除此助教？",
    staff_sync_ok: "已同步到 GitHub org 與 staff team。",
    staff_sync_nobinding: "此助教尚未綁定 GitHub；請他先到 /me 綁定，再加入一次以同步。",
    staff_sync_error: "GitHub org/team 同步失敗（請檢查 ORG_INVITE_TOKEN 權限與 STAFF_TEAM）。",
  },
  en: {
    acct_title: "My Account",
    acct_heading: "My Account",
    student_id: "Student ID",
    github: "GitHub",
    bound: "Bound",
    rebind: "Re-bind",
    not_bound: "Not bound yet",
    bind_action: "Bind GitHub →",
    grades_heading: "My Grades",
    col_problem: "Problem",
    col_result: "Result",
    col_score: "Score",
    col_updated: "Updated",
    no_grades: "No grades yet. Results appear here after you submit and it is graded.",
    privacy_note: "Only the score and verdict (AC/WA/TLE…) are shown; test data is never disclosed.",
    admin_link: "🔧 Admin (bindings list, export CSV / roster)",
    logout: "Sign out (switch account)",
    join_org_prompt: "Not in the course GitHub org yet? (sign in with your linked GitHub first; ignore if already joined)",
    join_org_link: "Accept the invite to join the course org →",
    flash_bound_ok: "GitHub bound successfully.",
    flash_error_prefix: "Action not completed: ",
    admin_title: "maccount Admin",
    admin_bindings: "Bindings ({n})",
    admin_courses_heading: "Courses",
    no_courses: "No courses yet.",
    course_create: "Create / update course",
    course_create_note: "course_id is alphanumeric + - _ (e.g. ds-2026); moodle_course_id is the Moodle numeric course id (used later for enrollment/grade mapping). Submitting the same course_id again updates it.",
    ph_course_id: "course_id (e.g. ds-2026)",
    ph_course_name: "Course name (e.g. Data Structures 2026)",
    ph_course_term: "Term (e.g. 2026 / 2026-fall)",
    ph_course_moodle: "moodle_course_id (optional)",
    ph_course_org: "github_org (optional)",
    bindings_query_heading: "Query bindings (by GitHub org)",
    bindings_all_link: "All bindings",
    bindings_query_note: "For students who bound GitHub but aren't enrolled yet; click an org to cross-check who has joined it.",
    org_status_col: "org status",
    org_status_member: "member",
    org_status_pending: "pending",
    org_status_none: "not joined",
    org_unbound_heading: "In the org, not bound on maccount",
    org_unbound_note: "These GitHub accounts are in the org but have no maccount binding (ask them to bind at /me).",
    org_fetch_error: "failed to read org members",
    course_settings: "Course settings",
    course_status: "Status",
    course_save: "Save course settings",
    enroll_heading: "Enrollment ({n})",
    enroll_note: "Bound to GitHub: {bound}. Once imported, this course's bindings list and roster export narrow to enrolled ∩ bound.",
    enroll_show_list: "Show roster",
    enroll_unbound: "not bound",
    enroll_placeholder: "Paste 學號, one per line (or comma/space separated)",
    enroll_replace: "Replace the whole roster (sync with Moodle; drop those not listed)",
    enroll_import: "Import roster",
    export_full: "⬇ Export CSV (full bindings)",
    export_roster: "⬇ Export roster.csv (github_login,student_id)",
    th_name: "Name",
    th_github_id: "GitHub id",
    th_updated: "Updated",
    th_actions: "",
    delete: "Delete",
    confirm_delete: "Delete this binding?",
    staff_heading: "TA / staff",
    staff_note: "Staff (by NYCU id) can view bindings and export; only owners (ADMIN_IDS) can add/remove staff or delete bindings.",
    staff_added_by: "Added by",
    staff_id_placeholder: "NYCU id",
    staff_add: "Add staff",
    staff_remove: "Remove",
    staff_remove_confirm: "Remove this staff member?",
    staff_sync_ok: "Synced to the GitHub org and staff team.",
    staff_sync_nobinding: "This TA hasn't bound GitHub yet; have them bind at /me, then add again to sync.",
    staff_sync_error: "GitHub org/team sync failed (check ORG_INVITE_TOKEN permissions and STAFF_TEAM).",
  },
};

// A "中文 | English" switch; the current language is plain text, the other is a
// link to the same path with ?lang= set.
export function langToggle(path: string, lang: Lang): string {
  const link = (l: Lang, label: string) =>
    l === lang ? `<b>${label}</b>` : `<a href="${path}?lang=${l}">${label}</a>`;
  return `<p style="text-align:right;font-size:.9em">${link("zh", "中文")} | ${link("en", "English")}</p>`;
}
