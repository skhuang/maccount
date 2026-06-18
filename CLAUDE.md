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

## 原始碼地圖（`src/`）

| 檔 | 責任 |
|---|---|
| `index.ts` | 路由 + handler（startNycu / nycuCallback / **startGithub** / githubCallback / **mePage**=儀表板 / **gradesIngest** / admin*） |
| `session.ts` | HMAC-SHA256 簽章 session cookie（`SessionData`、sign/verify、cookie 讀寫；`student` 旗標 = 學生登入 /me） |
| `util.ts` | `randomState()`（CSRF state） |
| `env.ts` | `Env` 型別、`nycuConfig()`、`isAdmin()`；新增 `GRADES_INGEST_TOKEN` |
| `oauth/nycu.ts` | NYCU authorize URL / token 交換 / `fetchNycuUser`（取 `username` = 學號 = student_id） |
| `oauth/github.ts` | GitHub authorize URL / token 交換 / 取 user(id+login) |
| `db/bindings.ts` | D1：`upsertBinding`（一 GitHub 只綁一 NYCU）/ list / delete / `getBinding` |
| `db/grades.ts` | D1：OJ 成績鏡像 `grades`（**score+verdict only**；鍵 `(course_id,student_id,problem_id)`）— `upsertGrades` / `listGradesFor` / `listGradesForProblem(…, course_id?)` |
| `db/staff.ts` | D1：TA/助教名單 `staff`（per-course；owner 管理）— `listStaff(db,course)` / `addStaff` / `removeStaff` / `isStaffMember(db,course,id)` / `isStaffAnywhere(db,id)`（access gate） |
| `db/courses.ts` | D1：開課登錄 `courses`（多租戶；`course_id`↔`moodle_course_id`↔`github_org`）— `listCourses` / `getCourse` |
| `db/enrollments.ts` | D1：每門課選課名單 `enrollments`（真相來源 = Moodle）— `listEnrollments` / `isEnrolled` / `coursesForStudent` / `enroll` / `bulkEnroll` / `replaceEnrollments`(同步) / `removeEnrollment` / `enrollmentCount` / `listEnrolledWithBinding`(join 綁定看已綁/未綁) |
| `csv.ts` | `BindingRow` + `toCsv`（完整綁定）+ `toRosterCsv`（`github_login,student_id`） |
| `html.ts` | 管理後台 + **學生 `/me` 儀表板** HTML（已做 XSS 跳脫；字串走 i18n） |
| `i18n.ts` | 雙語（zh-Hant 預設 / en）：`pickLang`（?lang>cookie>zh）、`langCookie`、字串表 `T`、`langToggle` |

### 端點（新增）
- `GET /me` — 登入後的**儀表板**：自己的綁定（+綁定 GitHub 按鈕）、OJ 成績（只顯示分數與判定）、admin 連結（若是 admin）、以及（若 `COURSE_ORG` 有設）一條「加入課程 org」邀請連結 `https://github.com/orgs/<org>/invitation`（學生接受一次,之後 P4 的 repo 授權即時、免 email）。`COURSE_ORG` 放 `wrangler.toml [vars]`（非機密）。
- `GET /auth/github/start` — 從 `/me` 發動 GitHub 綁定（需登入 session）。
- `GET /logout` — 清掉 maccount session cookie 並導向 `/auth/nycu/start?prompt=login`（強制 NYCU 重新輸入帳密,否則 NYCU SSO 會直接沿用同一帳號）。`prompt=login` 只在登出/切換時加,一般登入仍走 SSO。**切換 GitHub 帳號(綁定不同 GitHub)仍需用無痕視窗** —— GitHub OAuth 沒有可靠的重新選帳號參數。`/me` 右上有「登出（換帳號）」連結。成績的更新時間以 `fmtTime` 顯示為可讀的 Asia/Taipei `YYYY/MM/DD HH:MM`(而非原始 epoch)。
- `POST /api/grades/ingest` — 受信任的 OJ runner 推送成績；`Authorization: Bearer <GRADES_INGEST_TOKEN>`，body 為 `[{student_id,problem_id,verdict,score,max_score,updated_at,course_id?}]`，upsert 進 `grades`。`course_id` 選填（Phase 2 起 dsjudge 會帶；未帶則 fall back `DEFAULT_COURSE_ID`）。**只存分數+判定，其餘欄位忽略**（OJ 鐵則 2：學生只看分數+verdict，測資不外洩）。
- **`/admin` 課程選擇器 + `/c/<course_id>/admin`（Phase 1b）**：`GET /admin` 列課程（owner 看全部 + 建立課程表單；staff 只看自己的課）；`POST /admin/courses`（owner）建立/更新一門課（`course_id,name,term,moodle_course_id,github_org`）。每門課的後台在 `/c/<course_id>/admin`，含綁定名單 + 選課名單(enrollment) + 該課 staff 管理 + 課程設定 + 匯出；子端點 `GET …/export.csv`(`bindings-<course>.csv`)、`GET …/roster.csv`(`roster-<course>.csv`)、`POST …/delete`(owner)、`POST …/staff/{add,remove}`(owner)、`POST …/enroll`(owner)。檢視/匯出 = owner 或該課 staff（`requireCourseStaff`）；刪除/管理 staff/建課/匯入選課 = owner（`requireAdmin`）。`/c/<id>/...` 會 `getCourse` 驗證課程存在（不存在→404）。
- **編輯課程**：`POST /admin/courses` 是 upsert（同 `course_id` 再送即更新；`created_at` 只在新建時設）。課程後台的「課程設定」表單(owner)預填 `name/term/moodle_course_id/github_org/status(active|archived)` → 再送即改。
- **匯入選課名單（enrollment）**：真相來源 = Moodle。兩條路徑：(1) **手動**：課程後台「選課名單」貼上學號(逗號/空白/換行分隔)`POST /c/<id>/admin/enroll`，勾「取代整份名單」= `replaceEnrollments`(與 Moodle 同步、未列出者移除)，否則 `bulkEnroll`(累加、idempotent)。(2) **API**：`POST /api/enrollments/ingest`(`Authorization: Bearer <GRADES_INGEST_TOKEN>`，body `{course_id, student_ids:[…], replace?}`)供 seminar-moodle 自動把 Moodle 參與者推進來。**一旦某課有選課名單,該課的綁定名單表/`export.csv`/`roster.csv` 會縮到「選課∩已綁」**(空名單則 fall back 全域,向後相容)。選課名單會顯示每位學號的「已綁/未綁 GitHub」狀態。
- `GET /api/roster` — 同樣的 `github_login,student_id`，但用 `Authorization: Bearer <GRADES_INGEST_TOKEN>`（無需 NYCU session），供 OJ 主機的 roster-sync 定時器自動拉取。
- `GET /api/grades?problem_id=<id>` — 該題所有學生的 `{student_id,problem_id,verdict,score,max_score,updated_at}`（Bearer token）。供 seminar-moodle 的「程式作業自動批改」拉取後填進 Moodle 評分表。只回分數+判定。

## 常用指令

```bash
npm install
npm test            # vitest，全部測試（目前 64 passed）
npx tsc --noEmit    # 型別檢查
npm run dev         # wrangler dev（本機，預設埠 8787）
npx wrangler deploy # 部署 Worker（vars 變更也要重新 deploy 才生效）
```

改任何 `src/` 或設定後，務必跑 `npm test` 與 `npx tsc --noEmit`，全綠才算完成。

## 慣例與重要注意

- **機密不進版控**：`SESSION_SECRET`、`GITHUB_CLIENT_SECRET`、`NYCU_CLIENT_SECRET` 只透過 `npx wrangler secret put` 設定，**絕不**寫進 `wrangler.toml`。
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
