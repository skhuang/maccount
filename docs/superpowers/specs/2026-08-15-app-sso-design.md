# maccount App SSO 設計文件 — 讓第三方 app(dsvisual)以 maccount 帳號登入

- 日期:2026-08-15
- Repo:`maccount`(Cloudflare Worker + D1;branch `feat/app-sso`)
- 動機:sub-project B(dsvisual 認證改用 maccount)的前置 B1。maccount 目前是**自足的帳號綁定入口**:session cookie 對 Worker 網域為第一方、前端刻意不呼叫 API(無 CORS)、`?next=` 只允許站內 `/me/...`。因此**第三方 app 無法把使用者導來 maccount 登入、再帶身分回去**。B1 為 maccount 新增一條**relying-app SSO**:app 導向 `/auth/app/start` → maccount(必要時登入)→ 帶一枚**短效簽章身分 token** 導回 app → app 以 CORS 的 `POST /api/app/verify` 換得 `{student_id, providers}`。首個 relying app 為 **dsvisual**;之後 sub-project C 用它 gate「Practice on dsjudge」。

## 0. 範圍與決策(已與使用者確認)

- **機制 = 重導 + 簽章 token**(非 CORS `/me`):`/auth/app/start` 於 fragment 帶回 `#mtoken=<signed>`;app 再以 CORS `POST /api/app/verify` 換身分。適合純靜態 GitHub Pages app、無第三方 cookie 問題、app 端不需保管任何祕密或做瀏覽器內密碼學。
- **只認 allowlist 的 app + return URL**:防 open-redirect 與 token 外洩;dsvisual 首發。
- **token 只揭露身分**(`student_id` + 已綁 provider 旗標),**不含**任何 Google/Drive token、成績或敏感資料(維持 OJ 鐵則 2 精神)。
- **B1 只做 maccount 端**;dsvisual 端(取代 Firebase/Drive 的 auth 模組)是 B2,獨立 spec/plan。
- **維持既有登入不變**:NYCU/GitHub/Google 綁定與 `/me` 儀表板行為不動;新增純為 additive。

## 1. 現況(已查證)

- **架構**(CLAUDE.md):後端 Cloudflare Worker(`src/index.ts` 路由 + handler);整頁跳轉主導 OAuth;**session cookie 對 Worker 網域第一方**(`session.ts`,HMAC-SHA256 簽章,`SESSION_SECRET`)。前端(`skhuang.github.io/maccount`)純靜態、不呼叫 API。
- **session.ts**:`interface SessionData { exp; next?; nycu?{id,name}; ... }`;`signSession(data, secret)` / `verifySession(token, secret)`(Web Crypto HMAC-SHA256,回 `{ok,data}`);cookie:`setCookie/clearCookie/readCookie`。
- **router `src/index.ts`**:`const p = url.pathname; if (p === "/auth/nycu/start") ...`。既有登入:`/auth/nycu/start`(接受 `?next=`,經 `safeNext` 僅允許 `^/me/[A-Za-z0-9_-]+$`)、`/auth/nycu/callback`、`/auth/{github,google}/start|login|callback`、`/me`、`/logout`。
- **`nycuCallback`**:登入後 `const dest = safeNext(session.next) ?? "/me"`。替代登入 `startOAuthLogin`(免 session,反查 bindings 開 session)。
- **env.ts**:`Env` 型別集中設定;`SESSION_SECRET`、`PUBLIC_BASE_URL`、`GOOGLE_TOKEN_KEY` 等;`[vars]` 放非機密、`wrangler secret put` 放機密。
- **綁定資料**:`db/bindings.ts` `getBinding(nycu_id)` 可查該帳號的 GitHub/Google 綁定狀態(給 `providers` 旗標)。

## 2. 設計

### 2.1 設定(env.ts + wrangler.toml/secret)

- `APP_ALLOWLIST`(`[vars]`,非機密):relying app 白名單,格式 `app_id=return_url_prefix`,多筆以 `;` 分隔。首發:`dsvisual=https://skhuang.github.io/dsvisual`。
- `APP_TOKEN_SECRET`(secret,`wrangler secret put`):簽 app 身分 token 的 HMAC 金鑰,**獨立**於 `SESSION_SECRET`。
- 解析輔助:`appAllowlist(env) -> Map<app_id, return_prefix>`;`allowedReturn(env, app, return) -> boolean`(return 必須以該 app 的 prefix 起頭)。

### 2.2 `GET /auth/app/start?app=<id>&return=<url>`

- 驗 `app ∈ allowlist` 且 `return` 以該 app 的 prefix 起頭(否則 `400`,不重導——防開放重導)。
- 讀 session:
  - **已登入**(`session.nycu` 存在)→ `mintAppToken(env, student_id, providers, app)` → `302` 到 `<return>#mtoken=<token>`(用 URL fragment,token 不進伺服器 log / referrer)。
  - **未登入** → 把已驗證的 `{app, return}` 存進 pre-login session 的 `app_return` 欄 → `302` 到 `/auth/nycu/start`(維持既有 provider 選擇/SSO)。
- `SessionData` 新增 `app_return?: { app: string; return: string }`(已驗證值)。

### 2.3 登入後回 app(擴充既有 callback)

- `nycuCallback`(與 `startOAuthLogin` 的 github/google 登入分支)在開好登入 session 後:**若 `session.app_return` 存在** → `mintAppToken(...)` → `302` 到 `<return>#mtoken=<token>`(取代原本 `/me`);否則維持既有 `safeNext(next) ?? "/me"`。
- 回 app 前**再驗一次** `allowedReturn`(防 session 遭竄改)。

### 2.4 App 身分 token(`mintAppToken` / 驗證)

- claims:`{ sub: <student_id>, providers: { github: bool, google: bool }, aud: <app_id>, iat, exp: iat + 5min }`。
- 簽章:比照 `session.ts` 的 `signSession` 風格(HMAC-SHA256,Web Crypto),但用 `APP_TOKEN_SECRET`;輸出 `base64url(payload).base64url(sig)`。放 `src/app_sso.ts`(`mintAppToken`, `verifyAppToken`)。
- 短效(5 分鐘)、`aud` 綁定(dsvisual 的 token 不能被拿去對別的 app 用)。token 只揭露身分,不需單次性(短效 + aud 已足夠)。

### 2.5 `POST /api/app/verify`(CORS,給 allowlist app 的 origin)

- 預檢 `OPTIONS`:回 CORS 標頭(`Access-Control-Allow-Origin: <若 origin 屬 allowlist app 的 origin>`、`Allow-Methods: POST, OPTIONS`、`Allow-Headers: Content-Type`)。
- `POST` body `{ token }`:`verifyAppToken(env, token)` → 驗簽 + `exp` 未過 + `aud ∈ allowlist` → 回 `{ student_id, providers }`(加 CORS 標頭)。失敗回 `401`(過期/簽章錯/aud 不符)。
- CORS origin 由 `APP_ALLOWLIST` 的 return prefix 推導出允許的 origin 集合;非白名單 origin 不給 `Access-Control-Allow-Origin`。
- **只回身分**,無 Google/Drive token、無成績。

### 2.6 Logout

- 不改 maccount `/logout`(仍清 maccount session)。dsvisual(B2)自行清除本地身分;需要時可連 maccount `/logout`。

## 3. 檔案清單(maccount)

- 新增:`src/app_sso.ts`(`appAllowlist`/`allowedReturn`/`mintAppToken`/`verifyAppToken`)。
- 修改:`src/index.ts`(router 加 `/auth/app/start`、`/api/app/verify`;`nycuCallback` + `startOAuthLogin` 的登入分支支援 `app_return` 回 app)、`src/session.ts`(`SessionData.app_return?`)、`src/env.ts`(`APP_ALLOWLIST`、`APP_TOKEN_SECRET`)、`wrangler.toml.example`(`[vars] APP_ALLOWLIST` 佔位 + 註記 `APP_TOKEN_SECRET` 走 secret)。
- 測試:`test/`(vitest)涵蓋 allowlist 驗證、start(已登入→token 重導;未登入→存 app_return 去 NYCU 登入)、callback 回 app、token mint/verify(簽章、exp、aud)、`/api/app/verify`(CORS 預檢 + 成功 + 過期/aud 錯 401)。
- 不動:既有 OAuth 綁定/登入、`/me`、admin、grades、Drive/Classroom/Forms。

## 4. 測試

- **allowlist**:`allowedReturn` 只接受 app 的 prefix；非白名單 app 或不符 prefix 的 return → `/auth/app/start` 回 400。
- **start(已登入)**:有 session → 302 到 `<return>#mtoken=...`,token 可被 `verifyAppToken` 解出正確 `sub/aud/providers`。
- **start(未登入)**:無 session → 存 `app_return` 並 302 到 `/auth/nycu/start`;模擬 NYCU 登入 callback 後 → 302 回 `<return>#mtoken=...`。
- **token**:`mintAppToken`→`verifyAppToken` roundtrip 成功;竄改 payload/簽章 → 驗證失敗;`exp` 過期 → 失敗;`aud` 不符 → 失敗。
- **/api/app/verify**:合法 token(白名單 origin)→ 200 `{student_id, providers}` + CORS 標頭;過期/aud 錯/亂 token → 401;`OPTIONS` 預檢回正確 CORS。
- **回歸**:既有 vitest 全綠;`/me`、綁定、登入、admin、grades 行為不變。

## 5. 驗收標準

- dsvisual(或任一 allowlist app)可 `GET /auth/app/start?app=dsvisual&return=<允許的 dsvisual URL>` → 未登入則走 maccount 登入、已登入則直接 → 帶 `#mtoken` 回 app。
- app 以 `POST /api/app/verify`(CORS)用該 token 換得 `{student_id, providers}`;token 短效、aud 綁定、只含身分。
- 非白名單 app/return/origin 一律拒絕;既有 maccount 功能不退化;vitest 全綠。

## 6. 風險與緩解

- **Open redirect / token 外洩**:return 必須符合 allowlist prefix;token 走 fragment(不進 log/referrer)、短效、aud 綁定。
- **CORS 面**:只有 `/api/app/verify` 開 CORS,且只對白名單 app 的 origin;只回身分,無祕密。
- **session 竄改**:回 app 前再驗一次 `allowedReturn`;token 以獨立 `APP_TOKEN_SECRET` 簽,與 session secret 分離。
- **replay**:短 exp(5min)+ aud 綁定;token 僅揭露使用者本已擁有的身分,風險低(如需更嚴可日後加單次 nonce/D1 記錄)。
- **相容**:純 additive(新路由 + 新 session 欄位 + 新 env),不動既有登入/綁定/`/me`。
- **範圍界線**:B1 僅 maccount。dsvisual 的 auth 模組(取代 Firebase/Drive,讀 `#mtoken` → verify → 身分)為 B2。
