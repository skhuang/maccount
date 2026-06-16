# maccount — NYCU ↔ GitHub 帳號對應服務

前端（靜態）部署於 `skhuang.github.io/maccount`；後端為 Cloudflare Worker (TypeScript) + D1。
設計與計畫見 `docs/superpowers/`。

## 開發

```bash
npm install
npm test          # 跑所有 vitest 測試
npm run dev       # 本機 wrangler dev
```

## 部署步驟

> **先後順序很重要（雞生蛋）**：OAuth 的 redirect URL 需要 Worker 的網址，但 `*.workers.dev` 網址要先部署一次才會由 Cloudflare 分配。因此順序是：**先部署拿到網址 → 再去註冊 OAuth client 填 redirect → 回填憑證後重新部署**。下面以 `<worker>` 代表 Worker 的 base URL（例如 `https://maccount-api.<你的子網域>.workers.dev`，或你綁定的自訂網域）。

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
  - 取得 `client_id` / `client_secret`，以及實際的 authorize / token / userinfo 端點與 scope；確認 userinfo 回傳的帳號欄位名稱（若與 `src/oauth/nycu.ts` 的 `username ?? sub ?? id` 預設不同，改 `fetchNycuUser` 的映射）。
- **GitHub**（Settings → Developer settings → OAuth Apps → New）：
  - **Authorization callback URL：`<worker>/auth/github/callback`**
  - 取得 Client ID / Client secret。

### 4. 設定 vars 與 secrets
編輯 `wrangler.toml` 的 `[vars]`：`PUBLIC_BASE_URL = "<worker>"`、`FRONTEND_DONE_URL = "https://skhuang.github.io/maccount/done.html"`、`GITHUB_CLIENT_ID`、`NYCU_CLIENT_ID`、`ADMIN_IDS`（以逗號分隔的 NYCU 帳號）。
NYCU 端點（`NYCU_AUTHORIZE_URL`、`NYCU_TOKEN_URL`、`NYCU_USERINFO_URL`、`NYCU_SCOPE`）已預填 `id.nycu.edu.tw` 的值，若步驟 3 取得的端點不同再修改。
secrets 用指令設定（不進版控）：
```bash
npx wrangler secret put SESSION_SECRET        # 隨機長字串
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put NYCU_CLIENT_SECRET
```

### 5. 重新部署讓設定生效
```bash
npx wrangler deploy
```
並把 `index.html` 內的 `WORKER_BASE` 換成 `<worker>`。

> **注意**：`wrangler.toml` 已設定 `compatibility_flags = ["nodejs_compat"]`，這是 Worker 運行所必要的，請勿移除。

### 6. 啟用 GitHub Pages
repo Settings → Pages → 由 `main` 分支根目錄發佈 → 服務在 `https://skhuang.github.io/maccount/`。

## 使用
- 學生：開 `https://skhuang.github.io/maccount/` → 開始綁定。
- 管理員（`ADMIN_IDS` 內的 NYCU 帳號）：開 `https://<worker>/admin` → 用 NYCU 登入 → 看名單 / 匯出 CSV / 刪除綁定。
