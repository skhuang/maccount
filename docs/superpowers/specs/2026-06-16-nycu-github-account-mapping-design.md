# NYCU ↔ GitHub 帳號對應服務 — 設計文件

- 日期：2026-06-16
- 狀態：設計已確認，待寫實作計畫
- repo：`github.com/skhuang/maccount`

## 1. 目標

讓使用者用 NYCU OAuth（`id.nycu.edu.tw`）登入確認身分後，再完成 GitHub OAuth 授權，
建立並保存「NYCU 帳號 ↔ GitHub 帳號」的對應表。主要用途：

- 課程/作業用 — 取得學生 GitHub 帳號，方便後續收 GitHub 作業、加進 repo/org（自動化加人**不在本次 MVP**）。
- 建立可匯出的對應名單供管理者使用。

### MVP 範圍
綁定 + 匯出（CSV）+ 管理介面。**不含** GitHub 自動發邀請加入 org/repo（列為後續迭代）。

## 2. 關鍵限制與架構選擇

### 2.1 github.io 是純靜態，需要一個後端
`skhuang.github.io` 只能託管靜態檔案，無法執行伺服器端程式碼。但本需求有兩件事必須在伺服器端做：

1. **OAuth token 交換需要 `client_secret`**，絕不能放進前端 JS。GitHub OAuth 不支援 PKCE，
   因此 GitHub 端一定要有伺服器端做 code→token 交換；NYCU 端同理。
2. **對應表需要持久化儲存**，靜態站沒有資料庫。

結論：前端可放 github.io，但 token 交換與儲存需要後端 → 採用 **Cloudflare Workers + D1**。

### 2.2 讓 Worker 用「整頁跳轉」主導整個 OAuth 流程
若前端（github.io）以 JS 跨網域帶 cookie 呼叫 Worker，會踩到瀏覽器第三方 cookie 封鎖。
因此設計上由 Worker 透過**整頁 top-level 跳轉**主導 OAuth，session cookie 對 Worker 網域是第一方的。
github.io 只負責入口/說明/結果頁；實際 OAuth 流程與管理後台由 Worker 伺服器端處理（可回傳 HTML）。

## 3. 元件與託管

| 元件 | 放哪 | 負責 |
|---|---|---|
| 入口/說明/結果頁 | `skhuang.github.io/maccount`（repo `skhuang/maccount`，靜態） | 「開始綁定」按鈕、結果顯示 |
| 後端 API + 動態頁 | Cloudflare Worker（先用 `*.workers.dev`，之後可自訂網域） | OAuth token 交換、寫 D1、管理後台 SSR |
| 對應表 | Cloudflare D1（SQLite） | 儲存 NYCU↔GitHub 對應 |
| 機密 | Workers Secrets | 兩組 client_secret、session 簽章金鑰、管理員白名單 |

## 4. 綁定資料流（全程整頁跳轉）

1. 學生在 github.io 入口頁按「開始」→ 跳到 `Worker /auth/nycu/start`
2. Worker 設 session cookie（含 CSRF `state`）→ 跳轉 `id.nycu.edu.tw` 授權端點
3. NYCU 回呼 `Worker /auth/nycu/callback?code&state` → 驗 `state` → 用 `client_secret` 換 token
   → 取得 NYCU 帳號（id + name）→ 存進 session
4. Worker 產新 `state`（存進 session）→ 直接跳轉 `github.com` 授權
   （實作上 GitHub 授權跳轉直接接在第 3 步的 NYCU 回呼中完成，未另設 `/auth/github/start` 路由）
5. GitHub 回呼 `Worker /auth/github/callback?code&state` → 驗 `state` → 換 token → 取得 GitHub `id` + `login`
6. Worker 以 session 中的 NYCU 身分 + GitHub 身分 **upsert** 寫入 D1，
   跳回 github.io 結果頁 `?status=ok`（或 `?status=err&reason=...`）

## 5. 資料模型（D1）

```sql
CREATE TABLE bindings (
  nycu_id      TEXT PRIMARY KEY,   -- NYCU 帳號（身分來源）
  nycu_name    TEXT,
  github_id    INTEGER UNIQUE,     -- GitHub 數字 id（穩定，不隨改名變）
  github_login TEXT,               -- GitHub 使用者名稱（可能會改）
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
```

- 一個 NYCU 帳號一列（PRIMARY KEY），重複登入覆蓋更新（更新 github_* 與 updated_at）。
- 一個 GitHub 帳號只能綁一個 NYCU 帳號（`UNIQUE(github_id)`）；若被別的 NYCU 帳號搶綁，回傳錯誤並提示。

## 6. 管理介面（Worker 伺服器端渲染）

- 管理員用**同一套 NYCU 登入**進入 `/admin`；Worker 比對 env 白名單 `ADMIN_IDS` 才放行。
- 功能：
  - 檢視綁定名單（NYCU id/name、GitHub login/id、時間）
  - **匯出 CSV**（`/admin/export.csv`）
  - 手動刪除/重置某人的綁定（讓該學生可重新綁）

## 7. 安全

- 兩步 OAuth 皆用 `state` 防 CSRF，存 session、回呼時驗證並一次性使用。
- session cookie：`HttpOnly; Secure; SameSite=Lax`（整頁 GET 回呼適用），內容經簽章防竄改、有過期時間。
- 最小授權範圍：GitHub `read:user`；NYCU 取 `profile`（純 OAuth2，非 OIDC；`/api/profile/` 回傳 `username` + `email`）。姓名等屬敏感 scope（`name`），需另向 NYCU 申請核准。
- 所有 secret 只存在 Workers Secrets，前端永遠取不到。
- 管理端點一律先驗 NYCU 登入 + 白名單。

## 8. 外部前置條件（依賴）

1. **NYCU OAuth client**：向 `id.nycu.edu.tw` 申請 `client_id`/`client_secret`，登記回呼網址（= Worker callback）。
   — 已確認**可申請**。實作前需取得：authorize / token / userinfo 端點 URL 與 scope 命名。
2. **GitHub OAuth App**：自行註冊，Authorization callback URL = Worker `/auth/github/callback`。
3. **Cloudflare 帳號**：免費方案；建立 Worker 與 D1 database。

## 9. 預設決定（可於審查時推翻）

- Worker 網域：先用免費 `*.workers.dev`，之後可加自訂網域。
- 管理員白名單：以 NYCU 帳號 (`ADMIN_IDS`) 認定。

## 10. 後續迭代（不在本次）

- 綁定成功後用 GitHub API 自動發邀請加入 organization / 課程 repo（需 org 管理員 token）。
- 自訂網域、稽核日誌、批次匯入名單比對。

## 11. 待確認 / 開放問題

- ~~NYCU OAuth 的實際端點與 scope/claims 格式~~ —— 已確認：純 OAuth2（非 OIDC），scope `profile`，使用者資料端點 `https://id.nycu.edu.tw/api/profile/`，回傳 `username` + `email`，對應表主鍵取 `username`。（依官方文件 https://id.nycu.edu.tw/docs/ ）

## 12. 技術決定

- **Worker 實作語言：TypeScript**（Cloudflare 原生 V8 isolate）。
- 部署工具：Wrangler。D1 以 SQL migration 管理 schema。
