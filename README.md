# maccount — NYCU ↔ GitHub 帳號對應服務

> 用 Claude Code CLI 開發：`cd` 到本專案後執行 `claude`，會自動讀入 `CLAUDE.md` 取得專案脈絡。

前端（靜態）部署於 `skhuang.github.io/maccount`；後端為 Cloudflare Worker (TypeScript) + D1。
設計與計畫見 `docs/superpowers/`。

## 開發

```bash
npm install
npm test          # 跑所有 vitest 測試
npx playwright install chromium  # 首次執行 UI 測試前安裝瀏覽器
npm run test:ui   # Chromium 互動、手機版與 axe 無障礙測試
npm run dev       # 本機 wrangler dev
```

## 部署步驟

> **先後順序很重要（雞生蛋）**：OAuth 的 redirect URL 需要 Worker 的網址，但 `*.workers.dev` 網址要先部署一次才會由 Cloudflare 分配。因此順序是：**先部署拿到網址 → 再去註冊 OAuth client 填 redirect → 回填憑證後重新部署**。下面以 `<worker>` 代表 Worker 的 base URL（例如 `https://maccount-api.<你的子網域>.workers.dev`，或你綁定的自訂網域）。

> **本機設定檔（每台機器各自保存）**：`wrangler.toml` **不進版控**（避免多機同步衝突）；版控的是 `wrangler.toml.example` 模板。在每台要部署的機器上先複製一份再填真實值：
> ```bash
> cp wrangler.toml.example wrangler.toml
> ```
> 之後 `git pull` 不會再因 `wrangler.toml` 修改而衝突。新增設定項時請同步更新 `wrangler.toml.example`（模板），各機器再手動補進自己的 `wrangler.toml`。

### 1. 建立 D1 並套用 schema
```bash
npx wrangler d1 create maccount
# 把輸出的 database_id 填進 wrangler.toml 的 [[d1_databases]]
npx wrangler d1 migrations apply maccount --remote
```

### 2. 先部署一次以取得 Worker 網址
```bash
npx wrangler deploy
```
記下輸出的 Worker URL，即上面的 `<worker>`。此時 OAuth 還沒設定、流程還不能跑，這一步只是為了拿到網址。
（若改用自訂網域，先在 Cloudflare 綁好，`<worker>` 就用自訂網域。）

### 3. 註冊 OAuth client（兩邊，redirect 都指向 `<worker>`）
- **NYCU**（向 `id.nycu.edu.tw` 申請）：
  - **Client type：Confidential**（token 交換在 Worker 後端用 client_secret 完成）
  - **Authorization grant type：Authorization Code**
  - **Redirect URL：`<worker>/auth/nycu/callback`** —— 必須完全吻合（scheme/網域/路徑，**無結尾斜線**）。本機開發若要測可另加 `http://localhost:8787/auth/nycu/callback`。
  - 取得 `client_id` / `client_secret`。
  - NYCU 是**純 OAuth2（非 OpenID Connect）**，端點與 scope 已依官方文件填好（見下表），通常不需更動：
    - authorize：`https://id.nycu.edu.tw/o/authorize/`、token：`/o/token/`、使用者資料：`/api/profile/`
    - scope：`profile`（非敏感，回傳 `username` + `email`）。`name`（姓名）、`status` 等屬**敏感資料、需向 NYCU 申請核准**。
    - `/api/profile/` 回傳 `username`（= NYCU 帳號，即對應表主鍵）與 `email`；`src/oauth/nycu.ts` 的 `fetchNycuUser` 已對應 `username`。若日後加 `name` scope 取真實姓名，於該處調整映射。
- **GitHub**（Settings → Developer settings → OAuth Apps → New）：
  - **Authorization callback URL：`<worker>/auth/github/callback`**
  - 取得 Client ID / Client secret。
- **Google**（[console.cloud.google.com](https://console.cloud.google.com) → APIs & Services → Credentials → Create OAuth client ID → Web application）：
  - **Authorized redirect URI：`<worker>/auth/google/callback`**
  - 取得 Client ID / Client secret。**學生**綁定的預設 scope = `openid email` + `drive.file`（`GOOGLE_SCOPE` 可調；分享給學生其實只需 email）。**staff**「連結 Drive」(`/auth/google/start?drive=1`) 會自動要求完整 `drive` + `forms.body` scope，才能分享既有檔案並直接建立 Google 表單。
  - 在 **Enabled APIs** 啟用 **Google Drive API**（檔案分享用）與 **Google Forms API**（從後台直接建立問卷用）。兩者都要啟用在**與此 OAuth client 同一個專案**（建立表單失敗、log 顯示 `Forms API has not been used in project <n>` 多半是啟用錯專案）。
  - OAuth consent screen 設 External。完整 `drive` 為**受限 scope**：自用／少量帳號可加「測試使用者」直接用；要對外大量使用才需送 Google 審查。
  - 綁定流程要求 offline 存取（`access_type=offline`+`prompt=consent`），取得並**加密存下** refresh token。

### 4. 設定 vars 與 secrets
編輯 `wrangler.toml` 的 `[vars]`：`PUBLIC_BASE_URL = "<worker>"`、`FRONTEND_DONE_URL = "https://skhuang.github.io/maccount/done.html"`、`GITHUB_CLIENT_ID`、`GOOGLE_CLIENT_ID`、`NYCU_CLIENT_ID`、`ADMIN_IDS`（以逗號分隔的 NYCU 帳號）。

> **`GOOGLE_CLIENT_ID`**：填 Google OAuth client 的完整 Client ID（形如 `<數字>-<雜湊>.apps.googleusercontent.com`）。它**非機密**，放 `[vars]`（committed 模板裡是空字串 placeholder，本機填真實值並維持 `skip-worktree` 不提交，與 `GITHUB_CLIENT_ID`/`NYCU_CLIENT_ID`/`ADMIN_IDS` 同）。對應的 `GOOGLE_CLIENT_SECRET` 與加密金鑰 `GOOGLE_TOKEN_KEY` 走 `wrangler secret put`（見下）。`GOOGLE_SCOPE` 已有預設（`openid email` + `drive.file`），一般不需改。

NYCU 端點（`NYCU_AUTHORIZE_URL`、`NYCU_TOKEN_URL`、`NYCU_USERINFO_URL = /api/profile/`、`NYCU_SCOPE = profile`）已依官方文件填好，一般不需更動。
secrets 用指令設定（不進版控）：
```bash
npx wrangler secret put SESSION_SECRET        # 隨機長字串
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_TOKEN_KEY     # 隨機長字串；用來加密存放 Google refresh token（換金鑰會讓既存 token 失效）
npx wrangler secret put NYCU_CLIENT_SECRET
npx wrangler secret put GRADES_INGEST_TOKEN   # 隨機長字串；OJ runner 推成績時帶在 Authorization: Bearer
```

### 5. 重新部署讓設定生效
```bash
npx wrangler deploy
```
並把 `index.html` 內的 `WORKER_BASE` 換成 `<worker>`。

> **注意**：`wrangler.toml` 已設定 `compatibility_flags = ["nodejs_compat"]`，這是 Worker 運行所必要的，請勿移除。

### 6. 啟用 GitHub Pages
repo Settings → Pages → 由 `main` 分支根目錄發佈 → 服務在 `https://skhuang.github.io/maccount/`。

> **新增資料表**：學生成績鏡像 `grades` 在 `migrations/0002_grades.sql`。部署新版前先套用：
> `npx wrangler d1 migrations apply maccount --remote`。

## 使用
- 學生：開 `https://skhuang.github.io/maccount/` → 開始綁定；綁定後可「查詢我的上傳/評分狀態」(`/me`，NYCU 登入後只顯示自己的分數與判定)。
- **替代登入**：已綁定過 GitHub／Google 的人，首頁也可改用「用 GitHub 登入／用 Google 登入」，免再走 NYCU。系統用該 OAuth 帳號反查綁定，登入成同一個 NYCU 身分（含 admin 權限）。尚未綁定的帳號會被導到 done 頁提示「請先用 NYCU 登入並綁定」。
- 管理員（`ADMIN_IDS` 內的 NYCU 帳號）：開 `https://<worker>/admin` → 用 NYCU 登入 → 看名單 / 匯出 CSV / 匯出 `roster.csv`（`github_login,student_id`，給 dsjudge P4）/ 刪除綁定。
- **用 Google Drive 分享檔案給全班**：在課程後台（`/c/<course_id>/admin`）的「用 Google Drive 分享檔案給全班」區，staff 先點「連結我的 Google Drive（完整權限）」授權一次，再貼上檔案／資料夾的 ID 或分享連結、選權限（reader/commenter/writer）送出。系統以該 staff 自己的 Drive，把檔案分享給「選課∩已綁 Google」學生的 email（未綁 Google 的學生略過）。若該檔案是資料夾，學生會一併取得夾內檔案的存取。
- **課程 Google 問卷**：課程後台「Google 問卷」區，兩種方式加入：(1) **貼連結**——貼上現成 Google 表單的標題與連結；(2) **直接建立**——填標題按「直接新增 Google 表單」，系統用你連結的 Google 帳號透過 Forms API 建立新表單（需先「連結我的 Google Drive（完整權限）」一次），建立後點「編輯」到 Google 加題目。學生在 `/me` 對應課程下會看到並開啟填寫。請在 Google 表單設定開啟「收集電子郵件地址／需登入」，學生即以綁定的 Google 帳號作答，回應可用 email 對應回學號。
  - **直接建立**需在 Google Cloud 專案啟用 **Google Forms API**（Console → APIs & Services → Enable APIs → Google Forms API）。
  - 新增問卷時可勾「**給尚未選課的學生**」：這類「報到問卷」會顯示在 `/me/<course_id>` 報到頁（而非一般 `/me`）。
- **尚未選課學生報到（`/me/<course_id>`）**：把此連結發給還沒選課的學生。他們用 NYCU 登入後（會自動回到此頁），可在頁面綁定 GitHub/Google 並填寫報到問卷；老師據此把他們加入課程。後台「Google 問卷」區會顯示該課的報到連結。
- **邀請學生加入 Google Classroom**：先在「課程設定」填 `google_classroom_id`，再到課程後台「Google Classroom」區按「邀請學生加入 Classroom」。系統用你連結的 Google（須先「連結我的 Google Drive（完整權限）」一次，且你本人是該 Classroom 老師）把「選課∩已綁 Google」學生以 email 邀請加入；已在班者計為「已在班」、未綁 Google 者略過。需在專案啟用 **Google Classroom API**。
- **課程 Google Meet 連結**：Classroom API 不提供班級 Meet link，因此在「課程設定」另填選填欄位 `google_meet_url`；學生在 `/me` 對應課程下會看到「加入 Google Meet」連結。

## OJ 成績整合（與 dsjudge）
- **roster**：`maccount` 是 `github_login ↔ 學號` 的權威來源（兩邊都驗證過）。`/admin/roster.csv` 直接產生 dsjudge `app/roster.py` 讀的 `roster.csv`，取代原本的 GitHub Classroom 匯出。
- **成績狀態**：OJ runner（dsjudge，主機端）把每位學生的 `(student_id, problem_id, verdict, score, max_score, updated_at)` POST 到 `POST /api/grades/ingest`（帶 `GRADES_INGEST_TOKEN`）。**只傳分數+判定**，學生在 `/me` 看到的也只有這些（測資永不外流）。`student_id` = NYCU `username` = 學號，所以登入即對應。
