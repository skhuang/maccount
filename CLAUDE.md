# CLAUDE.md

專案脈絡，供 Claude Code 在此 repo 工作時參考。

## 這是什麼

**maccount** —— 把 NYCU 帳號（`id.nycu.edu.tw`）對應到 GitHub 帳號的服務。使用者先用 NYCU OAuth 登入確認身分，再授權 GitHub，系統記錄「NYCU ↔ GitHub」對應；用途為課程/作業（取得學生 GitHub）與可匯出的對應名單。

完整設計與實作計畫見 `docs/superpowers/`（spec + plan）。

## 架構（重點）

- **前端**：靜態 `index.html` / `done.html`，由 GitHub Pages 服務於 `https://skhuang.github.io/maccount/`。只負責入口與結果頁，不呼叫 API（沒有 CORS/cookie 問題）。
- **後端**：Cloudflare Worker（TypeScript），`src/index.ts` 是路由 + 所有 handler。用**整頁跳轉**主導兩段 OAuth（NYCU → GitHub），session cookie 對 Worker 網域是第一方的，避開第三方 cookie 封鎖。
- **儲存**：Cloudflare D1（SQLite），table `bindings`（schema 在 `migrations/0001_init.sql`）。
- **為什麼需要後端**：github.io 是純靜態，無法保管 OAuth `client_secret`、也無資料庫；token 交換與儲存必須在伺服器端。

### 流程（單一 NYCU 登入 → 儀表板）
入口頁 → `/auth/nycu/start` → NYCU 登入 → `/auth/nycu/callback`（驗 state、換 token、取 `username`、設定登入 session）→ **`/me` 儀表板**。在 `/me` 可：
- **綁定 GitHub**：`/auth/github/start`（需登入）→ GitHub 授權 → `/auth/github/callback`（驗 gstate、upsert D1）→（若設 `COURSE_ORG`+`ORG_INVITE_TOKEN`）**綁定後 best-effort 自動邀請進 org**（`inviteOrgMember`,失敗不影響綁定)→ 回 `/me?bound=1`(衝突 → `/me?error=github_already_bound`)。`ORG_INVITE_TOKEN` 是 org 範圍 token,用 `wrangler secret put` 設(失敗的補網由 dsjudge `invite_org` 負責)。
- **查成績**：列出自己的 OJ 結果（只顯示分數+判定）。
- **管理功能**：`nycu_id ∈ ADMIN_IDS` 時 `/me` 顯示連到 `/admin` 的連結。

沒有 `purpose`、沒有獨立的 admin 登入：登入後是同一個 session，admin 權限由 `isAdmin()` 在每個 admin 請求即時判定。OAuth provider 錯誤（NYCU/GitHub 回 `error=`）仍導回 `done.html?status=err`。

**替代登入（Sign in with GitHub / Google）**：已綁定該帳號者，可不經 NYCU、直接用 GitHub 或 Google 登入。入口 `/auth/github/login`、`/auth/google/login`（**免 session**，只設 CSRF state）。共用同一組 callback；callback 以「session 是否有 `nycu`」判斷模式：**有 nycu = 綁定**（連到目前帳號），**無 nycu = 登入**（用 OAuth 身分反查 `bindings` → 找到就以該 `nycu_id` 開 session 進 `/me`，找不到 → `done.html?status=err&reason={github,google}_not_bound`）。安全性等同「已連結帳號登入」：該綁定當初是由 NYCU 已驗證的 session 建立的。Google 登入只要 `openid email`（不要 Drive/offline，也**不覆寫**已存的 Drive token）。

## 原始碼地圖（`src/`）

| 檔 | 責任 |
|---|---|
| `index.ts` | 路由 + handler（startNycu / nycuCallback / **startGithub** / githubCallback / **mePage**=儀表板 / **gradesIngest** / admin*） |
| `session.ts` | HMAC-SHA256 簽章 session cookie（`SessionData`、sign/verify、cookie 讀寫；`student` 旗標 = 學生登入 /me） |
| `util.ts` | `randomState()`（CSRF state） |
| `env.ts` | `Env` 型別、`nycuConfig()`、`isAdmin()`；新增 `GRADES_INGEST_TOKEN` |
| `oauth/nycu.ts` | NYCU authorize URL / token 交換 / `fetchNycuUser`（取 `username` = 學號 = student_id） |
| `oauth/github.ts` | GitHub authorize URL / token 交換 / 取 user(id+login) |
| `oauth/google.ts` | Google OAuth2/OIDC：authorize URL（`access_type=offline`+`prompt=consent select_account`→拿 refresh token）、`exchangeGoogleCode`（回 `{access,refresh,scope,expiresIn}`）、`refreshGoogleAccessToken`（用 refresh token 換新 access token，供日後 Drive 呼叫）、`fetchGoogleUser`（取 `sub`+`email`）。scope 由 `GOOGLE_SCOPE` 決定，預設 `DEFAULT_GOOGLE_SCOPE` = `openid email + drive.file`（per-file、非受限 scope，免 Google 安全審查） |
| `oauth/drive.ts` | Drive 分享：`shareFileWithUser`（`permissions.create` 以 email 授權，`supportsAllDrives`）、`scopeHasFullDrive`（檢查是否拿到完整 `drive` scope）、`parseDriveFileId`（從分享連結抽 id）、`asDriveRole`、`DRIVE_SCOPE`/`STAFF_GOOGLE_SCOPE` |
| `crypto.ts` | AES-256-GCM `encryptSecret`/`decryptSecret`（金鑰由 `GOOGLE_TOKEN_KEY` 經 SHA-256 派生）。用來把 Google refresh token 加密後存 D1（at-rest），輸出 `base64(iv‖ct)` |
| `db/bindings.ts` | D1：`upsertBinding`（一 GitHub 只綁一 NYCU）/ `upsertGoogleBinding`（一 Google 只綁一 NYCU；只動 `google_*` 欄、不蓋 GitHub 綁定；refresh token 用 `COALESCE` 保留、無新 token 時不清掉）/ `getGoogleTokenRow`（讀加密 refresh token+scope，**刻意獨立**於 `getBinding`/`listBindings`，避免 token 漏進 CSV/admin）/ list / delete / `getBinding` / `getBindingByGithubId`+`getBindingByGoogleSub`（替代登入反查）。Google 欄位：`google_sub`(UNIQUE)+`google_email`（遷移 `0009_google`）；`google_refresh_token`(加密)+`google_scope`+`google_token_updated_at`（遷移 `0010_google_tokens`） |
| `db/grades.ts` | D1：OJ 成績鏡像 `grades`（**score+verdict only**；鍵 `(course_id,student_id,problem_id)`）— `upsertGrades` / `listGradesFor` / `listGradesForProblem(…, course_id?)` |
| `db/staff.ts` | D1：TA/助教名單 `staff`（per-course；owner 管理）— `listStaff(db,course)` / `addStaff` / `removeStaff` / `isStaffMember(db,course,id)` / `isStaffAnywhere(db,id)`（access gate） |
| `db/forms.ts` | D1：課程的 Google 問卷 `course_forms`（`id,course_id,title,url,form_id`，遷移 `0011`+`0012`）— `listCourseForms` / `listFormsForCourses`(IN 查多課，給 /me) / `addCourseForm`(可帶 `form_id`) / `removeCourseForm`(依 id+course_id 刪)。`form_id` 由 API 建立時填，用來組「編輯」連結 |
| `oauth/google_forms.ts` | Google Forms API：`createGoogleForm(accessToken, title)` → `POST forms.googleapis.com/v1/forms`，回 `{formId, responderUri}`。用 staff 連結的 Google token（完整 `drive` 即可建表，`STAFF_GOOGLE_SCOPE` 另含 `forms.body`）。需在 GCP 啟用 Forms API |
| `db/courses.ts` | D1：開課登錄 `courses`（多租戶；`course_id`↔`moodle_course_id`↔`github_org`）— `listCourses` / `getCourse` |
| `db/enrollments.ts` | D1：每門課選課名單 `enrollments`（真相來源 = Moodle）— `listEnrollments` / `isEnrolled` / `coursesForStudent` / `enroll` / `bulkEnroll` / `replaceEnrollments`(同步) / `removeEnrollment` / `enrollmentCount` / `listEnrolledWithBinding`(join 綁定看已綁/未綁) |
| `csv.ts` | `BindingRow` + `toCsv`（完整綁定）+ `toRosterCsv`（`github_login,student_id`） |
| `html.ts` | 管理後台 + **學生 `/me` 儀表板** HTML（已做 XSS 跳脫；字串走 i18n） |
| `i18n.ts` | 雙語（zh-Hant 預設 / en）：`pickLang`（?lang>cookie>zh）、`langCookie`、字串表 `T`、`langToggle` |

### 端點（新增）
- `GET /me` — 登入後的**儀表板**：自己的綁定（GitHub + Google 兩條，各有綁定/重綁按鈕）、**「我的課程」清單**、admin 連結（若是 admin）、以及（若 `COURSE_ORG` 有設）「加入課程 org」邀請連結。**課程清單 = 選課（enrollment）∪ 有成績的課**：被放進某課選課名單者，即使還沒有成績也會列出該課；每門課底下分「作業」(lab 平面表，含每題 repo「去解題」連結+分數)、「考試」(連 `/me/exam/<id>`) 與「問卷」(該課的 Google 表單連結)；沒資料的課顯示「目前沒有作業或成績」。只顯示分數與判定（OJ 鐵則 2）。`COURSE_ORG` 放 `wrangler.toml [vars]`（非機密）。
- `GET /auth/github/start` — 從 `/me` 發動 GitHub 綁定（需登入 session）。
- `GET /auth/github/login`、`GET /auth/google/login` — **替代登入**入口（免 session，設 gstate/gostate）。共用 `/auth/{github,google}/callback`，callback 無 `nycu` 時走登入分支（`getBindingByGithubId`/`getBindingByGoogleSub` 反查 → 開 session）。`db/bindings.ts` 加了這兩個反查函式。
- `GET /auth/google/start`、`GET /auth/google/callback` — 從 `/me` 發動 **Google 綁定**（需登入 session，CSRF state = `gostate`）。start 帶 `access_type=offline`+`prompt=consent select_account` 取得 refresh token；callback 驗 state、換 token、取 `sub`+`email`，**refresh token 先用 `GOOGLE_TOKEN_KEY` 加密**再 `upsertGoogleBinding` 進 D1（連同 granted scope）→ 成功回 `/me?gbound=1`（同一 Google 已綁他人 → `/me?error=google_already_bound`）。存下的 refresh token 供日後 Drive/Cloud 檔案操作（用 `refreshGoogleAccessToken` 換 access token）。config：`GOOGLE_CLIENT_ID`／`GOOGLE_SCOPE` 放 `wrangler.toml [vars]`；`GOOGLE_CLIENT_SECRET`、`GOOGLE_TOKEN_KEY` 用 `wrangler secret put`。
  - **`GET /auth/google/start?drive=1`（staff「連結 Drive」）**：改要求完整 `drive` scope（`STAFF_GOOGLE_SCOPE`），讓 staff 用自己的 token 分享既有檔案。學生一般綁定維持最小 scope（分享只需 email）。
  - **`POST /c/<course_id>/admin/drive/share`（model：staff 檔案 → 學生）**：以**登入 staff 自己**連結的 Drive，把指定檔案／資料夾（`file_id`，吃 id 或分享連結）分享給「選課∩已綁」學生的 Google email（`role` reader/commenter/writer，`notify` 選送通知）。流程：`getGoogleTokenRow`(acting staff)→驗 `scopeHasFullDrive`→解密 refresh→`refreshGoogleAccessToken`→逐位 `shareFileWithUser`。`requireCourseStaff`（owner 或該課 staff；用自己 token，無提權）。回 `/c/<id>/admin?drive_msg=done:<shared>:<errors>:<skipped>`（或 `no-file`/`no-drive`/`token-error`）。未綁 Google 的學生略過。**沒用到學生的 refresh token，只用其 email**。
- `GET /logout` — 清掉 maccount session cookie 並導向 `/auth/nycu/start?prompt=login`（強制 NYCU 重新輸入帳密,否則 NYCU SSO 會直接沿用同一帳號）。`prompt=login` 只在登出/切換時加,一般登入仍走 SSO。**切換 GitHub 帳號(綁定不同 GitHub)仍需用無痕視窗** —— GitHub OAuth 沒有可靠的重新選帳號參數。`/me` 右上有「登出（換帳號）」連結。成績的更新時間以 `fmtTime` 顯示為可讀的 Asia/Taipei `YYYY/MM/DD HH:MM`(而非原始 epoch)。
- `POST /api/grades/ingest` — 受信任的 OJ runner 推送成績；`Authorization: Bearer <GRADES_INGEST_TOKEN>`，body 為 `[{student_id,problem_id,verdict,score,max_score,updated_at,course_id?,repo?}]`，upsert 進 `grades`。`course_id` 選填（Phase 2 起 dsjudge 會帶；未帶則 fall back `DEFAULT_COURSE_ID`）。`repo` 選填＝該生此題的 repo（full_name 或完整 URL；`/me` 連到它，遷移 `0007_grades_repo`）。`assignment_id/assignment_type(lab|exam)/assignment_title` 選填（dsjudge provision 推送,遷移 `0008_grades_assignment`）。**provision 在建好 repo 時就推一列(只有 repo+assignment,score/verdict 留 null)** → `/me` 解題前就看得到 repo。upsert 用 COALESCE 保留(provision 設 repo/assignment、judge 後補 score,互不清掉)。`/me`：**lab 平面列**(每題 repo「去解題」連結+分數)；**exam 群組成考試清單** → 連到 `GET /me/exam/<assignment_id>`(該生該場各程式題的 repo 連結+分數,只露自己的)。**只存分數+判定，其餘欄位忽略**（OJ 鐵則 2：學生只看分數+verdict，測資不外洩）。
- **`/admin` 課程選擇器 + `/c/<course_id>/admin`（Phase 1b）**：`GET /admin` 列課程（owner 看全部 + 建立課程表單；staff 只看自己的課）；`POST /admin/courses`（owner）建立/更新一門課（`course_id,name,term,moodle_course_id,github_org`）。每門課的後台在 `/c/<course_id>/admin`，含綁定名單 + 選課名單(enrollment) + 該課 staff 管理 + 課程設定 + 匯出；子端點 `GET …/export.csv`(`bindings-<course>.csv`)、`GET …/roster.csv`(`roster-<course>.csv`)、`POST …/delete`(owner)、`POST …/staff/{add,remove}`(owner)、`POST …/enroll`(owner)。檢視/匯出 = owner 或該課 staff（`requireCourseStaff`）；刪除/管理 staff/建課/匯入選課 = owner（`requireAdmin`）。`/c/<id>/...` 會 `getCourse` 驗證課程存在（不存在→404）。
- **查詢綁定（兩種:依課程 / 依 GitHub org）**：`/admin` 除了課程列表,另有「查詢綁定」區。`GET /admin/bindings`＝**全部綁定總表**(學號/姓名/github_login,與選課無關 → 綁定後還沒選課的學生也查得到)。`GET /admin/org/<org>`(org 限 effective orgs：各課 `github_org` 或 `COURSE_ORG`)＝**依 org 查**:即時抓該 org 的 GitHub 成員+待接受邀請(`listOrgMembers`/`listPendingOrgInvites`,各一次分頁呼叫,需 `ORG_INVITE_TOKEN`),用 `orgBindingView`(純函式)以 github_login join 綁定 → 每筆標 `已加入/待接受/未加入`,並另列「已在 org、未在 maccount 綁定」的帳號。皆 `requireStaff`。
- **編輯課程**：`POST /admin/courses` 是 upsert（同 `course_id` 再送即更新；`created_at` 只在新建時設）。課程後台的「課程設定」表單(owner)預填 `name/term/moodle_course_id/github_org/status(active|archived)` → 再送即改。
- **匯入選課名單（enrollment）**：真相來源 = Moodle。兩條路徑：(1) **手動**：課程後台「選課名單」貼上學號(逗號/空白/換行分隔)`POST /c/<id>/admin/enroll`，勾「取代整份名單」= `replaceEnrollments`(與 Moodle 同步、未列出者移除)，否則 `bulkEnroll`(累加、idempotent)。(2) **API**：`POST /api/enrollments/ingest`(`Authorization: Bearer <GRADES_INGEST_TOKEN>`，body `{course_id, student_ids:[…], replace?}`)供 seminar-moodle 自動把 Moodle 參與者推進來。**一旦某課有選課名單,該課的綁定名單表/`export.csv`/`roster.csv` 會縮到「選課∩已綁」**(空名單則 fall back 全域,向後相容)。選課名單會顯示每位學號的「已綁/未綁 **GitHub 與 Google**」狀態（`listEnrolledWithBinding` join 出 `github_login`+`google_email`）。綁定總表（`/admin/bindings`）與各課綁定名單也都多了 **Google** 欄（`google_email`）。
- **課程 Google 問卷**：課程後台「Google 問卷」區，課程 staff（`requireCourseStaff`）可：
  - **貼連結**：`POST /c/<id>/admin/forms/add`（僅收 `http(s)`，非法→`?forms_msg=bad`）。
  - **直接建立**：`POST /c/<id>/admin/forms/create`（標題）→ 用 staff 連結的 Google 帳號呼叫 Forms API 建表（`createGoogleForm`），存 `responderUri`(學生填)+`form_id`(編輯連結 `…/forms/d/<form_id>/edit`)。需先「連結 Google Drive（完整權限）」(`staffGoogleAccessToken` 共用 Drive 分享那套 token；未連結→`forms_msg=no-drive`、權杖失敗→`token-error`、API 失敗→`create-error`)。GCP 需啟用 **Forms API**。
  - **移除**：`POST /c/<id>/admin/forms/remove`（依 id+course_id）。
  學生端在 `/me` 對應課程下看到問卷清單並開啟填寫；登入與收 email 由 Google 表單自身設定（「收集電子郵件／需登入」）負責，再以綁定的 Google email 對應回學號。貼連結模式不需 Forms API；建立模式才需要。
- `GET /api/roster` — 同樣的 `github_login,student_id`，但用 `Authorization: Bearer <GRADES_INGEST_TOKEN>`（無需 NYCU session），供 OJ 主機的 roster-sync 定時器自動拉取。
- `GET /api/grades?problem_id=<id>` — 該題所有學生的 `{student_id,problem_id,verdict,score,max_score,updated_at}`（Bearer token）。供 seminar-moodle 的「程式作業自動批改」拉取後填進 Moodle 評分表。只回分數+判定。

## 常用指令

```bash
npm install
npm test            # vitest，全部測試（目前 140 passed）
npx tsc --noEmit    # 型別檢查
npm run dev         # wrangler dev（本機，預設埠 8787）
npx wrangler deploy # 部署 Worker（vars 變更也要重新 deploy 才生效）
```

改任何 `src/` 或設定後，務必跑 `npm test` 與 `npx tsc --noEmit`，全綠才算完成。

## 慣例與重要注意

- **機密不進版控**：`SESSION_SECRET`、`GITHUB_CLIENT_SECRET`、`NYCU_CLIENT_SECRET`、`GOOGLE_CLIENT_SECRET`、`GOOGLE_TOKEN_KEY` 只透過 `npx wrangler secret put` 設定，**絕不**寫進 `wrangler.toml`。
- **Google refresh token 視同機密**：存 D1 前先 AES-GCM 加密（`crypto.ts`，金鑰 `GOOGLE_TOKEN_KEY`），且只經 `getGoogleTokenRow` 讀取——**不要**把 `google_refresh_token` 加進 `BindingRow`/`BINDING_COLS`/`toCsv`/admin 表，否則會隨匯出外洩。換 `GOOGLE_TOKEN_KEY` 會使既存 token 無法解密（須重新授權）。
- **`wrangler.toml` 是「模板」**：committed 版本用 placeholder（client_id 空、`PUBLIC_BASE_URL` 為 `<subdomain>`）。本機 working tree 填入真實部署值（client_id、`ADMIN_IDS`、worker 網域），**保持未提交**，所以 `git status` 會長期顯示它被修改——這是預期的，提交前不要把真實 client_id / `ADMIN_IDS` 推進公開 repo。`package.json`/`package-lock.json`（wrangler v4）同理為本機未提交。
- **NYCU 是純 OAuth2（非 OpenID Connect）**：scope 用 `profile`（不是 `openid`）；使用者資料端點是 `https://id.nycu.edu.tw/api/profile/`（不是 `/o/userinfo/`），回傳 `username`（= 對應表主鍵）+ `email`。`name`（真實姓名）、`status` 屬敏感資料、需向 NYCU 申請核准。官方文件：https://id.nycu.edu.tw/docs/
- **OAuth client 註冊**：NYCU 與 GitHub 的 redirect 都指向 Worker（`<worker>/auth/{nycu,github}/callback`），不是 github.io。NYCU client type = Confidential、grant = Authorization Code。
- 安全要點：兩段 OAuth 都驗 CSRF `state`；session cookie `HttpOnly; Secure; SameSite=Lax`；admin 端點每次都重驗 `ADMIN_IDS` 白名單；500 回應用通用訊息不洩漏細節。

## 部署 / 線上資訊

- Worker：`https://maccount-api.skhuang.workers.dev`
- 前端：`https://skhuang.github.io/maccount/`（Pages 從 `main` 根目錄發佈）
- 管理後台：`https://maccount-api.skhuang.workers.dev/admin`。兩種角色：**owner**＝`ADMIN_IDS`（env）→ 可管理 TA + 刪除綁定；**staff/TA**＝D1 `staff` 表(owner 在 /admin 新增/移除)→ 可檢視名單 + 匯出,但不能管理 TA 或刪除(無提權)。端點 `POST /admin/staff/{add,remove}`(owner-only)。新增資料表 `migrations/0003_staff.sql`(部署前 `wrangler d1 migrations apply maccount --remote`)。
- **staff→GitHub 同步(scope: team+org)**：owner 在 /admin 新增/移除 TA 時,若 `COURSE_ORG`+`ORG_INVITE_TOKEN`+`STAFF_TEAM`(=dsjudge `OJ_PROVISION_TEAM`,放 `wrangler.toml [vars]`)皆設,會用該 TA 綁定的 `github_login` best-effort 同步 GitHub(`syncStaffToGitHub`,失敗不影響 D1 `staff` 寫入)：**add** → `inviteOrgMember`(org)+`addTeamMembership`(staff team)；**remove** → `removeTeamMembership`+`removeOrgMember`(整個踢出 org)。/admin 以 `?staff_msg=ok|no-binding|error` 回 flash。TA 須**先綁定 GitHub** 才能同步(未綁 → `no-binding`,D1 仍寫入,請其綁定後再加一次)。`ORG_INVITE_TOKEN` 需具 org members + team 管理權限。
- **GitHub org 模型（Phase 3a；model A + per-course 覆寫）**：每門課的 *effective org* = `courses.github_org`（有填就用）否則共用的 `COURSE_ORG`。大多數課留空、共用一個 org（學生只加一次）；想獨立的課填自己的 org。`/me` 依學生**選課**列出去重後的 effective org 加入連結（沒選課 → fall back 單一 `COURSE_ORG`，不破壞舊行為）；綁定後 best-effort 邀進這些 org（`studentOrgs(env, studentId)`；`effectiveOrg()`）。選課後才綁定 → 綁定時就邀進該課 org；綁定後才被選課（自訂 org）→ 由 /me 連結自助加入或 dsjudge `invite_org` 補。詳見記憶 `github-org-model`。
- **多課程 / 多租戶（Phase 1a，地基）**：頂層租戶是「開課」`course_id`（如 `ds-2026`、`swtest-2027`），存在 `courses` 表並帶 `moodle_course_id`（Moodle 橋）與 `github_org`。**identity（`bindings`）維持全域**（一人一個 GitHub 綁定跨課共用）；`staff`/`grades` 已加 `course_id`（PK 含之，跨年重用同 problem_id 不撞），`enrollments` 為每門課選課名單（真相來源 = Moodle，Phase 3 同步）。題目維持**共用題庫**（扁平 id），靠成績鍵的 `course_id` 區分。遷移 `0004_courses`/`0005_enrollments`/`0006_course_id_staff_grades`（既有資料 backfill 進 `ds-2026`）。Phase 1a 完全向後相容（資料層）；**Phase 1b（已完成）** 加了 course-scoped 路由：`/admin` 課程選擇器、`/c/<course_id>/admin` 每課後台（綁定/staff/匯出）、`POST /admin/courses` 建課、`/me` 依課程分組顯示成績。未帶 `course_id` 的成績 ingest 仍 fall back 到 `DEFAULT_COURSE_ID`（`wrangler.toml [vars]`，碼內預設 `ds-2026`），供 Phase 2 前的 dsjudge 使用。待辦：**Phase 2** dsjudge 推成績帶 `(course_id, assignment_id)`；**Phase 3** Moodle 對應（選課/成績寫回）；**Phase 4** 競賽/考試記分板。
- D1：database `maccount`
- 完整部署步驟在 `README.md`（順序：先 deploy 拿 worker 網址 → 註冊 OAuth client 填 redirect → 回填 vars/secrets → 再 deploy → 開 Pages）。

## 測試方式

Vitest 跑在 `@cloudflare/vitest-pool-workers`（真實 workerd runtime + D1）。D1 測試在 `beforeAll` 用 `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` 套 migration。OAuth 模組以可注入的 `fetcher` 參數測試；router 整合測試用 `vi.stubGlobal("fetch", ...)` 擋外部呼叫。
