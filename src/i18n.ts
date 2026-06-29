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
  google: string;
  bound: string;
  rebind: string;
  not_bound: string;
  bind_action: string;
  bind_google_action: string;
  grades_heading: string;
  my_courses_heading: string;
  assignments_heading: string;
  course_no_data: string;
  grade_summary_label: string;
  grade_summary_graded: string;
  grade_summary_accepted: string;
  grade_summary_score: string;
  grade_summary_latest: string;
  grade_summary_progress: string; // "{score}" and "{max}" placeholders
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
  flash_gbound_ok: string;
  flash_error_prefix: string;
  admin_title: string;
  admin_bindings: string; // "{n}" placeholder
  export_full: string;
  export_roster: string;
  admin_courses_heading: string;
  no_courses: string;
  no_bindings: string;
  table_search_label: string;
  table_search_placeholder: string;
  table_filter_label: string;
  table_filter_all: string;
  table_filter_unbound: string;
  table_showing: string; // {visible} {total}
  table_no_results: string;
  course_create: string;
  course_create_expand: string;
  course_count: string; // {n}
  course_manage: string;
  course_active: string;
  course_archived: string;
  course_create_note: string;
  ph_course_id: string;
  ph_course_name: string;
  ph_course_term: string;
  ph_course_moodle: string;
  ph_course_org: string;
  ph_course_classroom: string;
  ph_course_meet: string;
  ph_course_group: string;
  meet_join: string;
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
  exam_list_heading: string;
  exam_go_solve: string;
  exam_no_repo: string;
  exam_intro: string;
  course_settings: string;
  course_status: string;
  course_save: string;
  enroll_heading: string; // "{n}" placeholder
  enroll_note: string; // "{bound}" placeholder
  enroll_show_list: string;
  enroll_unbound: string;
  enroll_ids_label: string;
  enroll_placeholder: string;
  enroll_replace: string;
  enroll_import: string;
  th_name: string;
  th_github_id: string;
  th_updated: string;
  th_actions: string;
  delete: string;
  confirm_delete: string;
  confirm_delete_detail: string; // "{id}" placeholder
  confirm_dialog_title: string;
  confirm_cancel: string;
  confirm_continue: string;
  enroll_replace_confirm: string;
  enroll_replace_confirm_detail: string;
  staff_heading: string;
  staff_note: string;
  staff_added_by: string;
  staff_id_label: string;
  staff_id_placeholder: string;
  staff_add: string;
  staff_remove: string;
  staff_remove_confirm: string;
  staff_remove_confirm_detail: string; // "{id}" placeholder
  staff_sync_ok: string;
  staff_sync_nobinding: string;
  staff_sync_error: string;
  drive_heading: string;
  drive_note: string;
  drive_connect: string;
  drive_file_label: string;
  drive_file_placeholder: string;
  drive_role_label: string;
  drive_role_reader: string;
  drive_role_commenter: string;
  drive_role_writer: string;
  drive_notify: string;
  drive_share_btn: string;
  drive_msg_done: string; // {shared} {errors} {skipped}
  drive_msg_nofile: string;
  drive_msg_nodrive: string;
  drive_msg_tokenerror: string;
  forms_heading: string;
  forms_note: string;
  forms_title_label: string;
  forms_title_ph: string;
  forms_url_label: string;
  forms_url_ph: string;
  forms_add: string;
  forms_remove: string;
  forms_remove_confirm: string;
  forms_remove_confirm_detail: string; // "{title}" placeholder
  forms_none: string;
  forms_msg_bad: string;
  forms_msg_nodrive: string;
  forms_msg_tokenerror: string;
  forms_msg_createerror: string;
  forms_msg_groupmissing: string;
  forms_msg_groupscope: string;
  forms_msg_grouperror: string;
  forms_msg_groupdone: string; // {added} {removed} {kept} {protected} {errors}
  forms_create_note: string;
  forms_create_title_ph: string;
  forms_create_btn: string;
  forms_edit: string;
  forms_student_heading: string;
  forms_pre_enroll_label: string;
  forms_pre_enroll_badge: string;
  forms_responder_heading: string; // "{n}" placeholder
  forms_responder_note: string;
  forms_responder_empty: string;
  forms_responder_source_moodle: string;
  forms_responder_source_google: string;
  forms_group_heading: string;
  forms_group_missing: string;
  forms_group_ready: string; // "{n}" placeholder
  forms_group_next: string;
  forms_group_sync: string;
  forms_group_sync_confirm: string;
  forms_group_sync_confirm_detail: string;
  prejoin_link_label: string;
  copy_link: string;
  copied: string;
  copy_failed: string;
  help_label: string;
  help_account_binding: string;
  help_grade_summary: string;
  help_verdict: string;
  help_exam_repo: string;
  help_course_create: string;
  help_bindings: string;
  help_exports: string;
  help_table_search: string;
  help_enrollment: string;
  help_roster_replace: string;
  help_drive: string;
  help_forms: string;
  help_forms_responders: string;
  help_forms_group: string;
  help_prejoin_link: string;
  help_classroom: string;
  help_staff: string;
  help_settings: string;
  prejoin_intro: string;
  classroom_heading: string;
  classroom_note: string;
  classroom_no_id: string;
  classroom_invite_btn: string;
  classroom_msg_done: string; // {invited} {already} {errors} {skipped}
  classroom_msg_noid: string;
  classroom_msg_nodrive: string;
  classroom_msg_tokenerror: string;
}

export const T: Record<Lang, Strings> = {
  zh: {
    acct_title: "我的帳號",
    acct_heading: "我的帳號",
    student_id: "學號",
    github: "GitHub",
    google: "Google",
    bound: "已綁定",
    rebind: "重新綁定",
    not_bound: "尚未綁定",
    bind_action: "綁定 GitHub →",
    bind_google_action: "綁定 Google →",
    grades_heading: "我的成績",
    my_courses_heading: "我的課程",
    assignments_heading: "作業",
    course_no_data: "此課程目前沒有作業或成績。",
    grade_summary_label: "課程成績摘要",
    grade_summary_graded: "已有結果",
    grade_summary_accepted: "已通過",
    grade_summary_score: "總分",
    grade_summary_latest: "最後更新",
    grade_summary_progress: "總分 {score} / {max}",
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
    flash_gbound_ok: "Google 綁定成功。",
    flash_error_prefix: "操作未完成：",
    admin_title: "maccount 管理",
    admin_bindings: "綁定名單 ({n})",
    admin_courses_heading: "課程列表",
    no_courses: "尚無課程。",
    no_bindings: "目前沒有綁定資料。",
    table_search_label: "搜尋名單",
    table_search_placeholder: "搜尋學號、姓名、GitHub 或 Google",
    table_filter_label: "篩選狀態",
    table_filter_all: "全部狀態",
    table_filter_unbound: "未完整綁定",
    table_showing: "顯示 {visible} / {total} 筆",
    table_no_results: "沒有符合目前條件的資料。",
    course_create: "建立／更新課程",
    course_create_expand: "新增或更新課程",
    course_count: "共 {n} 門課程",
    course_manage: "管理課程",
    course_active: "進行中",
    course_archived: "已封存",
    course_create_note: "course_id 為英數與 - _（如 ds-2026）；moodle_course_id 為 Moodle 課程數字 id（之後對應選課/成績用）。再次送出相同 course_id 即更新。",
    ph_course_id: "course_id（如 ds-2026）",
    ph_course_name: "課程名稱（如 資料結構 2026）",
    ph_course_term: "學期（如 2026 / 2026-fall）",
    ph_course_moodle: "moodle_course_id（選填）",
    ph_course_org: "github_org（選填）",
    ph_course_classroom: "google_classroom_id（選填，可貼課程連結）",
    ph_course_meet: "google_meet_url（選填，課程的 Meet 連結）",
    ph_course_group: "google_group_email（選填，課程問卷 Google Group）",
    meet_join: "加入 Google Meet",
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
    exam_list_heading: "考試",
    exam_go_solve: "去解題",
    exam_no_repo: "repo 尚未建立",
    exam_intro: "點各題的「去解題」開啟你的 repo，clone 後 git push 即由 OJ 評分；概念題在 Moodle 測驗作答。",
    course_settings: "課程設定",
    course_status: "狀態",
    course_save: "儲存課程設定",
    enroll_heading: "選課名單（{n}）",
    enroll_note: "已綁定 GitHub：{bound}／Google：{gbound}。匯入後，此課的綁定名單與 roster 匯出會縮到「選課∩已綁」。",
    enroll_show_list: "顯示選課名單",
    enroll_unbound: "未綁定",
    enroll_ids_label: "學生學號",
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
    confirm_delete: "刪除帳號綁定？",
    confirm_delete_detail: "將刪除 {id} 的全域 GitHub／Google 帳號綁定，所有課程都會受影響；成績與選課資料不會刪除。",
    confirm_dialog_title: "確認管理操作",
    confirm_cancel: "取消",
    confirm_continue: "確認執行",
    enroll_replace_confirm: "覆蓋整份選課名單？",
    enroll_replace_confirm_detail: "新名單將取代目前整份名單；未列出的學生會從本課移除。此操作不會刪除帳號綁定或成績。",
    staff_heading: "TA／助教管理",
    staff_note: "助教（NYCU 帳號）可檢視名單與匯出；只有 ADMIN_IDS 內的擁有者能新增/移除助教或刪除綁定。",
    staff_added_by: "加入者",
    staff_id_label: "助教 NYCU 帳號",
    staff_id_placeholder: "NYCU 帳號（學號/教職員帳號）",
    staff_add: "新增助教",
    staff_remove: "移除",
    staff_remove_confirm: "移除助教權限？",
    staff_remove_confirm_detail: "將移除 {id} 的本課管理權限，並嘗試同步移出 GitHub staff team 與課程組織。",
    staff_sync_ok: "已同步到 GitHub org 與 staff team。",
    staff_sync_nobinding: "此助教尚未綁定 GitHub；請他先到 /me 綁定，再加入一次以同步。",
    staff_sync_error: "GitHub org/team 同步失敗（請檢查 ORG_INVITE_TOKEN 權限與 STAFF_TEAM）。",
    drive_heading: "用 Google Drive 分享檔案給全班",
    drive_note: "以你自己的 Google Drive 將檔案／資料夾分享給「選課∩已綁 Google」的學生（用其綁定的 Google email）。需先連結你的 Drive（完整權限）：",
    drive_connect: "連結我的 Google Drive（完整權限）→",
    drive_file_label: "Drive 檔案或資料夾",
    drive_file_placeholder: "Drive 檔案／資料夾 ID 或分享連結",
    drive_role_label: "分享權限",
    drive_role_reader: "檢視者（reader）",
    drive_role_commenter: "可註解（commenter）",
    drive_role_writer: "編輯者（writer）",
    drive_notify: "寄送通知 email",
    drive_share_btn: "分享給全班",
    drive_msg_done: "已分享 {shared} 人；失敗 {errors}；略過（未綁 Google）{skipped}。",
    drive_msg_nofile: "請填入 Drive 檔案／資料夾 ID 或連結。",
    drive_msg_nodrive: "尚未連結你的 Google Drive（完整權限）。請先點上方「連結我的 Google Drive」並授權。",
    drive_msg_tokenerror: "無法取得 Google 存取權杖（請重新連結 Drive）。",
    forms_heading: "Google 問卷",
    forms_note: "貼上 Google 表單的連結，學生會在 /me 對應課程看到並填寫。請在表單設定開啟「收集電子郵件地址／需登入」，學生即以綁定的 Google 帳號作答、可對應回學號。",
    forms_title_label: "問卷標題",
    forms_title_ph: "問卷標題（如 課程意見調查）",
    forms_url_label: "Google 表單連結",
    forms_url_ph: "Google 表單連結（https://docs.google.com/forms/…）",
    forms_add: "新增問卷",
    forms_remove: "移除",
    forms_remove_confirm: "移除課程問卷？",
    forms_remove_confirm_detail: "將從本課移除「{title}」連結；Google Drive 中的原始表單不會被刪除。",
    forms_none: "目前沒有問卷。",
    forms_msg_bad: "請填標題與有效的 https 連結。",
    forms_msg_nodrive: "尚未連結你的 Google（完整權限），無法建立表單。請先點上方「連結我的 Google Drive」並授權。",
    forms_msg_tokenerror: "無法取得 Google 存取權杖（請重新連結 Drive）。",
    forms_msg_createerror: "建立 Google 表單失敗（請確認 Google Cloud 專案已啟用 Forms API，並已連結 Drive）。",
    forms_msg_groupmissing: "尚未設定課程 Google Group，無法同步成員。",
    forms_msg_groupscope: "你的 Google 授權尚未包含 Google Group 成員管理權限；請重新點「連結我的 Google Drive」授權一次。",
    forms_msg_grouperror: "同步 Google Group 失敗（請確認帳號有 Workspace 管理群組成員權限，且 Admin SDK 已啟用）。",
    forms_msg_groupdone: "Google Group 同步完成：新增 {added}、移除 {removed}、保留 {kept}、受保護略過 {protected}、錯誤 {errors}。",
    forms_create_note: "或直接建立新的 Google 表單（用你連結的 Google 帳號建立；建立後點「編輯」到 Google 加題目）：",
    forms_create_title_ph: "新表單標題（如 第一週小考）",
    forms_create_btn: "直接新增 Google 表單",
    forms_edit: "編輯",
    forms_student_heading: "問卷",
    forms_pre_enroll_label: "給尚未選課的學生（報到問卷，顯示於 /me/<課程>）",
    forms_pre_enroll_badge: "（尚未選課）",
    forms_responder_heading: "問卷建議允許名單（{n}）",
    forms_responder_note: "第一階段先列出應允許填答的 Google 帳號：Moodle email 與學生綁定的 Google email。建立或貼上問卷後，請在 Google Forms 的發布/管理權限中加入這些帳號，或未來改加入課程 Google Group。",
    forms_responder_empty: "目前沒有可用 email；請先匯入 Moodle 選課名單，或請學生綁定 Google。",
    forms_responder_source_moodle: "Moodle",
    forms_responder_source_google: "綁定 Google",
    forms_group_heading: "課程 Google Group",
    forms_group_missing: "尚未設定課程 Google Group。請擁有者先填入 group email。",
    forms_group_ready: "已設定；目前建議同步 {n} 個填答帳號到此 group。",
    forms_group_next: "同步後，請在 Google Forms 的填答權限中開放此 group。系統只會移除不在目前名單內的一般 MEMBER，OWNER／MANAGER／巢狀群組會保留。",
    forms_group_sync: "同步 Google Group 成員",
    forms_group_sync_confirm: "同步 Google Group 成員？",
    forms_group_sync_confirm_detail: "會把目前建議允許名單加入課程 Google Group，並移除 group 中不在名單內的一般 MEMBER；OWNER、MANAGER 與巢狀群組會保留。",
    prejoin_link_label: "尚未選課學生入口",
    copy_link: "複製連結",
    copied: "已複製",
    copy_failed: "無法複製",
    help_label: "說明",
    help_account_binding: "把你的 NYCU 身分連到 GitHub / Google；課程邀請、repo 與問卷會用這些帳號對應。",
    help_grade_summary: "摘要只統計目前已同步到 maccount 的結果；若剛交作業，請等 OJ 或匯入流程更新。",
    help_verdict: "AC/PASS 代表通過；WA/RE/TLE 等代表尚未通過或執行異常；只顯示判定與分數，不顯示測資內容。",
    help_exam_repo: "開啟你的個人 repo 後 clone、提交並 push；OJ 會依課程設定評分。",
    help_course_create: "相同 course_id 再送出會更新既有課程，不會建立第二門；course_id 建議固定且不要隨意更名。",
    help_bindings: "綁定名單是學生全域帳號對應；刪除綁定會影響所有課程，但不會刪除成績或選課資料。",
    help_exports: "完整 CSV 含所有綁定欄位；roster.csv 只輸出 github_login 與 student_id，適合匯入評分或課程工具。",
    help_table_search: "可搜尋目前表格中的學號、姓名、GitHub、Google 等文字；搭配篩選可快速找未綁定學生。",
    help_enrollment: "選課名單控制本課 roster；已綁定且在選課名單中的學生會出現在課程匯出。",
    help_roster_replace: "勾選後，新名單會覆蓋整份本課選課名單；未出現在貼上內容中的學生會從本課移除。",
    help_drive: "以你授權的 Google Drive 分享給已選課且已綁定 Google 的學生；未綁定者會被略過。",
    help_forms: "學生會在 /me 對應課程看到這些表單；請在 Google 表單設定要求登入並收集 email。",
    help_forms_responders: "這份名單用來避免問卷只開給 Workspace 帳號時擋住 @gmail.com 學生；可同步到課程 Google Group 後，再把 Google Forms 權限開給該 group。",
    help_forms_group: "將 Moodle email 與綁定 Google email 同步到此 group 後，Google Forms 可把填答權限開給這個 group。同步需要 Workspace 管理群組成員權限。",
    help_prejoin_link: "給尚未正式選課的學生使用；他們可先綁定帳號並填寫報到問卷。",
    help_classroom: "用已綁定的 Google email 邀請學生加入 Classroom；你本人需要是該 Classroom 的老師。",
    help_staff: "助教可檢視與匯出本課資料；擁有者才能新增/移除助教或刪除全域綁定。",
    help_settings: "修改課程名稱、學期、Moodle/GitHub/Google 設定；封存課程會在列表中標示但保留資料。",
    prejoin_intro: "尚未選課也沒關係！請先綁定你的 GitHub / Google 帳號，並填寫下方問卷，老師會據此將你加入課程。",
    classroom_heading: "Google Classroom",
    classroom_note: "把「選課∩已綁 Google」的學生以其 Google email 邀請加入本課的 Google Classroom（你需先「連結我的 Google Drive（完整權限）」一次，且你本人須為該 Classroom 的老師）。Classroom ID 請於上方設定區填寫。",
    classroom_no_id: "尚未設定 Google Classroom ID（請於上方設定區填入後再邀請）。",
    classroom_invite_btn: "邀請學生加入 Classroom",
    classroom_msg_done: "已邀請 {invited} 人；已在班 {already}；失敗 {errors}；略過（未綁 Google）{skipped}。",
    classroom_msg_noid: "尚未設定 Google Classroom ID（請先於上方設定區填入）。",
    classroom_msg_nodrive: "尚未連結你的 Google（完整權限）。請先點「連結我的 Google Drive」並授權。",
    classroom_msg_tokenerror: "無法取得 Google 存取權杖（請重新連結 Drive）。",
  },
  en: {
    acct_title: "My Account",
    acct_heading: "My Account",
    student_id: "Student ID",
    github: "GitHub",
    google: "Google",
    bound: "Bound",
    rebind: "Re-bind",
    not_bound: "Not bound yet",
    bind_action: "Bind GitHub →",
    bind_google_action: "Bind Google →",
    grades_heading: "My Grades",
    my_courses_heading: "My Courses",
    assignments_heading: "Assignments",
    course_no_data: "No assignments or grades in this course yet.",
    grade_summary_label: "Course grade summary",
    grade_summary_graded: "With results",
    grade_summary_accepted: "Accepted",
    grade_summary_score: "Total score",
    grade_summary_latest: "Last updated",
    grade_summary_progress: "Total score {score} / {max}",
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
    flash_gbound_ok: "Google bound successfully.",
    flash_error_prefix: "Action not completed: ",
    admin_title: "maccount Admin",
    admin_bindings: "Bindings ({n})",
    admin_courses_heading: "Courses",
    no_courses: "No courses yet.",
    no_bindings: "No account bindings yet.",
    table_search_label: "Search list",
    table_search_placeholder: "Search student ID, name, GitHub, or Google",
    table_filter_label: "Filter status",
    table_filter_all: "All statuses",
    table_filter_unbound: "Missing a binding",
    table_showing: "Showing {visible} of {total}",
    table_no_results: "No rows match the current filters.",
    course_create: "Create / update course",
    course_create_expand: "Add or update a course",
    course_count: "{n} courses",
    course_manage: "Manage course",
    course_active: "Active",
    course_archived: "Archived",
    course_create_note: "course_id is alphanumeric + - _ (e.g. ds-2026); moodle_course_id is the Moodle numeric course id (used later for enrollment/grade mapping). Submitting the same course_id again updates it.",
    ph_course_id: "course_id (e.g. ds-2026)",
    ph_course_name: "Course name (e.g. Data Structures 2026)",
    ph_course_term: "Term (e.g. 2026 / 2026-fall)",
    ph_course_moodle: "moodle_course_id (optional)",
    ph_course_org: "github_org (optional)",
    ph_course_classroom: "google_classroom_id (optional; a class link works too)",
    ph_course_meet: "google_meet_url (optional, the course's Meet link)",
    ph_course_group: "google_group_email (optional, course Forms Google Group)",
    meet_join: "Join Google Meet",
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
    exam_list_heading: "Exams",
    exam_go_solve: "go solve",
    exam_no_repo: "repo not created yet",
    exam_intro: "Open your repo via each problem's “go solve”, clone, and git push — the OJ grades it; concept questions are in the Moodle quiz.",
    course_settings: "Course settings",
    course_status: "Status",
    course_save: "Save course settings",
    enroll_heading: "Enrollment ({n})",
    enroll_note: "Bound to GitHub: {bound} / Google: {gbound}. Once imported, this course's bindings list and roster export narrow to enrolled ∩ bound.",
    enroll_show_list: "Show roster",
    enroll_unbound: "not bound",
    enroll_ids_label: "Student IDs",
    enroll_placeholder: "Paste student IDs, one per line (or comma/space separated)",
    enroll_replace: "Replace the whole roster (sync with Moodle; drop those not listed)",
    enroll_import: "Import roster",
    export_full: "⬇ Export CSV (full bindings)",
    export_roster: "⬇ Export roster.csv (github_login,student_id)",
    th_name: "Name",
    th_github_id: "GitHub id",
    th_updated: "Updated",
    th_actions: "",
    delete: "Delete",
    confirm_delete: "Delete account binding?",
    confirm_delete_detail: "This deletes {id}'s global GitHub/Google account binding and affects every course. Grades and enrollment data are kept.",
    confirm_dialog_title: "Confirm admin action",
    confirm_cancel: "Cancel",
    confirm_continue: "Confirm action",
    enroll_replace_confirm: "Replace the entire roster?",
    enroll_replace_confirm_detail: "The new roster replaces the current one. Students not listed will be removed from this course. Account bindings and grades are kept.",
    staff_heading: "TA / staff",
    staff_note: "Staff (by NYCU id) can view bindings and export; only owners (ADMIN_IDS) can add/remove staff or delete bindings.",
    staff_added_by: "Added by",
    staff_id_label: "Staff NYCU ID",
    staff_id_placeholder: "NYCU id",
    staff_add: "Add staff",
    staff_remove: "Remove",
    staff_remove_confirm: "Remove staff access?",
    staff_remove_confirm_detail: "This removes {id}'s admin access to this course and attempts to remove them from the GitHub staff team and course organization.",
    staff_sync_ok: "Synced to the GitHub org and staff team.",
    staff_sync_nobinding: "This TA hasn't bound GitHub yet; have them bind at /me, then add again to sync.",
    staff_sync_error: "GitHub org/team sync failed (check ORG_INVITE_TOKEN permissions and STAFF_TEAM).",
    drive_heading: "Share a Drive file with the class",
    drive_note: "Share a file/folder from your own Google Drive with enrolled students who bound Google (by their bound Google email). Connect your Drive (full access) first:",
    drive_connect: "Connect my Google Drive (full access) →",
    drive_file_label: "Drive file or folder",
    drive_file_placeholder: "Drive file/folder ID or share link",
    drive_role_label: "Sharing permission",
    drive_role_reader: "Viewer (reader)",
    drive_role_commenter: "Commenter",
    drive_role_writer: "Editor (writer)",
    drive_notify: "Send notification email",
    drive_share_btn: "Share with the class",
    drive_msg_done: "Shared with {shared}; failed {errors}; skipped (no Google) {skipped}.",
    drive_msg_nofile: "Enter a Drive file/folder ID or link.",
    drive_msg_nodrive: "Your Google Drive (full access) isn't connected. Click “Connect my Google Drive” above and authorize first.",
    drive_msg_tokenerror: "Couldn't get a Google access token (please reconnect Drive).",
    forms_heading: "Google Forms",
    forms_note: "Paste a Google Form link; enrolled students see it under the matching course on /me. In the form's settings enable “Collect email addresses / require sign-in” so students answer with their bound Google account and responses map back to a student id.",
    forms_title_label: "Form title",
    forms_title_ph: "Form title (e.g. Course feedback)",
    forms_url_label: "Google Form link",
    forms_url_ph: "Google Form link (https://docs.google.com/forms/…)",
    forms_add: "Add form",
    forms_remove: "Remove",
    forms_remove_confirm: "Remove course form?",
    forms_remove_confirm_detail: "This removes the “{title}” link from this course. The original form in Google Drive is not deleted.",
    forms_none: "No forms yet.",
    forms_msg_bad: "Enter a title and a valid https link.",
    forms_msg_nodrive: "Your Google (full access) isn't connected, so a form can't be created. Click “Connect my Google Drive” above and authorize first.",
    forms_msg_tokenerror: "Couldn't get a Google access token (please reconnect Drive).",
    forms_msg_createerror: "Failed to create the Google Form (enable the Forms API in the Google Cloud project and connect Drive).",
    forms_msg_groupmissing: "No course Google Group is configured, so members can't be synced.",
    forms_msg_groupscope: "Your Google authorization doesn't include Google Group member management yet. Click “Connect my Google Drive” again and authorize once.",
    forms_msg_grouperror: "Google Group sync failed (check that the account can manage Workspace group members and that the Admin SDK is enabled).",
    forms_msg_groupdone: "Google Group sync complete: added {added}, removed {removed}, kept {kept}, protected skipped {protected}, errors {errors}.",
    forms_create_note: "Or create a new Google Form directly (created with your connected Google account; click “Edit” afterwards to add questions in Google):",
    forms_create_title_ph: "New form title (e.g. Week 1 quiz)",
    forms_create_btn: "Create Google Form",
    forms_edit: "Edit",
    forms_student_heading: "Forms",
    forms_pre_enroll_label: "For not-yet-enrolled students (shown on /me/<course>)",
    forms_pre_enroll_badge: "(prospective)",
    forms_responder_heading: "Suggested form responder allowlist ({n})",
    forms_responder_note: "Phase 1 lists the Google accounts that should be allowed to respond: Moodle emails and students' bound Google emails. After creating or attaching a form, add these accounts in Google Forms publish/access settings, or later add the course Google Group.",
    forms_responder_empty: "No usable emails yet. Import the Moodle roster or ask students to bind Google first.",
    forms_responder_source_moodle: "Moodle",
    forms_responder_source_google: "Bound Google",
    forms_group_heading: "Course Google Group",
    forms_group_missing: "No course Google Group is configured yet. Ask an owner to add the group email first.",
    forms_group_ready: "Configured. Currently {n} responder accounts should be synced to this group.",
    forms_group_next: "After syncing, grant this group responder access in Google Forms. The app removes only ordinary MEMBER users that are no longer in the current list; OWNER/MANAGER and nested groups are kept.",
    forms_group_sync: "Sync Google Group members",
    forms_group_sync_confirm: "Sync Google Group members?",
    forms_group_sync_confirm_detail: "This adds the current suggested allowlist to the course Google Group and removes ordinary MEMBER users that are no longer listed; OWNER, MANAGER, and nested group members are kept.",
    prejoin_link_label: "Prospective-student entry",
    copy_link: "Copy link",
    copied: "Copied",
    copy_failed: "Couldn't copy",
    help_label: "Help",
    help_account_binding: "Links your NYCU identity to GitHub / Google; course invites, repos, and forms use these accounts for matching.",
    help_grade_summary: "The summary only counts results currently synced to maccount. If you just submitted, wait for the OJ/import job to update.",
    help_verdict: "AC/PASS means accepted. WA/RE/TLE and similar verdicts are not accepted or had runtime issues. Only verdicts and scores are shown; test data is not exposed.",
    help_exam_repo: "Open your personal repo, clone it, commit, and push. The OJ grades according to the course setup.",
    help_course_create: "Submitting the same course_id updates the existing course instead of creating another one. Keep course_id stable.",
    help_bindings: "Bindings are global student-account mappings. Deleting one affects every course, but keeps grades and enrollment data.",
    help_exports: "The full CSV includes all binding fields; roster.csv contains only github_login and student_id for grading/course tools.",
    help_table_search: "Search within the current table by student ID, name, GitHub, Google, and other visible text. Combine with filters to find missing bindings.",
    help_enrollment: "The roster controls this course's enrollment. Bound students on the roster are included in course exports.",
    help_roster_replace: "When checked, the pasted list replaces the entire roster for this course; students not listed are removed from this course.",
    help_drive: "Shares from your authorized Google Drive to enrolled students who bound Google. Students without Google binding are skipped.",
    help_forms: "Students see these forms under the matching course on /me. Configure the Google Form to require sign-in and collect email.",
    help_forms_responders: "Use this list to avoid blocking @gmail.com students when a form is restricted to Workspace users. It can be synced into a course Google Group, then Google Forms can grant access to that group.",
    help_forms_group: "After Moodle emails and bound Google emails are synced into this group, Google Forms can grant responder access to the group. Syncing requires Workspace permission to manage group members.",
    help_prejoin_link: "For students not officially enrolled yet. They can bind accounts and fill in the pre-enrollment form first.",
    help_classroom: "Invites students by their bound Google email. You must be a teacher in that Classroom.",
    help_staff: "Staff can view and export this course's data. Only owners can add/remove staff or delete global bindings.",
    help_settings: "Edit course name, term, Moodle/GitHub/Google settings. Archiving marks the course in lists while keeping data.",
    prejoin_intro: "Not enrolled yet? No problem — bind your GitHub / Google account and fill in the form below; the instructor will enroll you based on it.",
    classroom_heading: "Google Classroom",
    classroom_note: "Invite enrolled students who bound Google (by their Google email) into this course's Google Classroom. Connect your Google Drive (full access) once first, and you must be a teacher of that Classroom. Set the Classroom ID in “Course settings” above.",
    classroom_no_id: "No Google Classroom ID set yet (add one in “Course settings”, then invite).",
    classroom_invite_btn: "Invite students to Classroom",
    classroom_msg_done: "Invited {invited}; already in {already}; failed {errors}; skipped (no Google) {skipped}.",
    classroom_msg_noid: "No Google Classroom ID set (add one in “Course settings” first).",
    classroom_msg_nodrive: "Your Google (full access) isn't connected. Click “Connect my Google Drive” and authorize first.",
    classroom_msg_tokenerror: "Couldn't get a Google access token (please reconnect Drive).",
  },
};

// A "中文 | English" switch; the current language is plain text, the other is a
// link to the same path with ?lang= set.
export function langToggle(path: string, lang: Lang): string {
  const link = (l: Lang, label: string) =>
    l === lang
      ? `<span aria-current="true">${label}</span>`
      : `<a href="${path}?lang=${l}" lang="${l === "zh" ? "zh-Hant" : "en"}">${label}</a>`;
  return `<nav class="lang-toggle" aria-label="Language">${link("zh", "中文")}<span aria-hidden="true">·</span>${link("en", "English")}</nav>`;
}
