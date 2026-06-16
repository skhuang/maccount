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

### 1. 建立 D1 並套用 schema
```bash
npx wrangler d1 create maccount
# 把輸出的 database_id 填進 wrangler.toml 的 [[d1_databases]]
npx wrangler d1 migrations apply maccount --remote
```

### 2. 註冊 OAuth app
- **GitHub**：Settings → Developer settings → OAuth Apps → New。
  Authorization callback URL = `https://<worker>/auth/github/callback`。
  取得 Client ID / Client secret。
- **NYCU**：向 `id.nycu.edu.tw` 申請 client，登記 callback `https://<worker>/auth/nycu/callback`。
  取得 client id/secret 與實際 authorize/token/userinfo 端點 → 填入 `wrangler.toml` 的 `NYCU_*` vars。
  若 userinfo 的 claim 名稱與預設不同，調整 `src/oauth/nycu.ts` 的 `fetchNycuUser` 映射。

### 3. 設定 vars 與 secrets
編輯 `wrangler.toml` 的 `[vars]`（`PUBLIC_BASE_URL`、`FRONTEND_DONE_URL`、`GITHUB_CLIENT_ID`、`NYCU_CLIENT_ID`、`ADMIN_IDS` 以逗號分隔的 NYCU 帳號）。
NYCU 端點（`NYCU_AUTHORIZE_URL`、`NYCU_TOKEN_URL`、`NYCU_USERINFO_URL`、`NYCU_SCOPE`）已預填 `id.nycu.edu.tw` 的值，若端點不同再修改。
secrets 用指令設定（不進版控）：
```bash
npx wrangler secret put SESSION_SECRET        # 隨機長字串
npx wrangler secret put GITHUB_CLIENT_SECRET
npx wrangler secret put NYCU_CLIENT_SECRET
```

### 4. 部署 Worker
```bash
npx wrangler deploy
```
部署後把 `index.html` 內的 `WORKER_BASE` 換成實際 Worker 網址。

> **注意**：`wrangler.toml` 已設定 `compatibility_flags = ["nodejs_compat"]`，這是 Worker 運行所必要的，請勿移除。

### 5. 啟用 GitHub Pages
repo Settings → Pages → 由 `main` 分支根目錄發佈 → 服務在 `https://skhuang.github.io/maccount/`。

## 使用
- 學生：開 `https://skhuang.github.io/maccount/` → 開始綁定。
- 管理員（`ADMIN_IDS` 內的 NYCU 帳號）：開 `https://<worker>/admin` → 用 NYCU 登入 → 看名單 / 匯出 CSV / 刪除綁定。
