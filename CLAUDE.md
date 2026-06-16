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

### 流程
入口頁 → `/auth/nycu/start` → NYCU 授權 → `/auth/nycu/callback`（驗 state、換 token、取 `username`）→ `/auth/github/callback`（驗 state、換 token、取 GitHub id+login、upsert D1）→ 跳回 `done.html?status=ok`。管理員走 `/auth/nycu/start?purpose=admin`。

## 原始碼地圖（`src/`）

| 檔 | 責任 |
|---|---|
| `index.ts` | 路由 + handler（startNycu / nycuCallback / githubCallback / admin*） |
| `session.ts` | HMAC-SHA256 簽章 session cookie（`SessionData`、sign/verify、cookie 讀寫） |
| `util.ts` | `randomState()`（CSRF state） |
| `env.ts` | `Env` 型別、`nycuConfig()`、`isAdmin()` |
| `oauth/nycu.ts` | NYCU authorize URL / token 交換 / `fetchNycuUser`（取 `username`） |
| `oauth/github.ts` | GitHub authorize URL / token 交換 / 取 user(id+login) |
| `db/bindings.ts` | D1 存取：`upsertBinding`（含一 GitHub 只綁一 NYCU 的衝突保護）/ list / delete |
| `csv.ts` | `BindingRow` 型別 + CSV 匯出 |
| `html.ts` | 管理後台 HTML（已做 XSS 跳脫） |

## 常用指令

```bash
npm install
npm test            # vitest，全部測試（目前 35 passed）
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
- 管理後台：`https://maccount-api.skhuang.workers.dev/admin`（NYCU 登入 + `ADMIN_IDS` 白名單）
- D1：database `maccount`
- 完整部署步驟在 `README.md`（順序：先 deploy 拿 worker 網址 → 註冊 OAuth client 填 redirect → 回填 vars/secrets → 再 deploy → 開 Pages）。

## 測試方式

Vitest 跑在 `@cloudflare/vitest-pool-workers`（真實 workerd runtime + D1）。D1 測試在 `beforeAll` 用 `applyD1Migrations(env.DB, env.TEST_MIGRATIONS)` 套 migration。OAuth 模組以可注入的 `fetcher` 參數測試；router 整合測試用 `vi.stubGlobal("fetch", ...)` 擋外部呼叫。
