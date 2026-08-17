# App-SSO 三方登入選擇頁 設計文件 — relying app 可用 NYCU/GitHub/Google 登入

- 日期:2026-08-16
- Repo:`maccount`(主要;Cloudflare Worker + D1)+ `dsvisual`(小幅文案調整)
- Branch:maccount `feat/app-sso-login-chooser`
- 動機:relying-app SSO(B1)目前未登入時**只導向 NYCU 登入**(`startApp` 硬寫 `/auth/nycu/start`)。但 maccount 已支援以**已綁定的 NYCU / GitHub / Google 帳號**登入(首頁「替代登入」)。dsvisual 使用者應能用這三種任一方式登入。經查:`app_return` 的**帶入/取出管線已對三種方式全部就緒**(`startNycu` 與 `startOAuthLogin` 都會保留 `app_return`,三個 callback 都會經 `postLoginDestination` 帶 `#mtoken` 回 app)。唯一寫死 NYCU 的是 `startApp` 未登入分支的重導目標。

## 0. 範圍與決策(已與使用者確認)

- **做法 = maccount worker 自建登入選擇頁**:`startApp` 未登入時,仍先把 `app_return` 存進 pre-login session cookie,然後**回傳一個登入方式選擇頁(200 HTML)**,提供三顆按鈕(NYCU / GitHub / Google),而非直接 302 到 NYCU。三顆按鈕都連到同源 worker 的既有登入路由,session cookie(含 `app_return`)隨之送出,登入後由既有 callback 帶 `#mtoken` 回 app。**單一 repo、無 dsvisual 依賴、未來所有 relying app 皆受惠。**
- **不採用**:(a) `?method=` 參數把按鈕 UI 推給每個 relying app(較不 DRY);(b) 導回靜態首頁(那是完整綁定入口,對「只想登入」情境過重、且耦合前端 repo)。兩者列為未來可選,不在本次範圍。
- **dsvisual 小幅文案**:登入按鈕文案由「以 NYCU 帳號登入 / Sign in with NYCU」改為方法中性的「登入 / Sign in」(方法改在 maccount 選擇頁挑),並把 `cloud.signin-note` 提及 NYCU 之處改為 NYCU/GitHub/Google。
- **不動既有登入/綁定/`/me`/admin**;純新增選擇頁 + 改 `startApp` 一處重導 + 更新受影響測試。

## 1. 現況(已查證,file:line)

- `startApp`(`src/index.ts:268-283`):驗 `allowedReturn`;已登入(`session.nycu.id`)→ `appTokenRedirect`(mint + 302 帶 `#mtoken`);**未登入 → 存 `app_return` 進 pre-login session,`302` 到 `/auth/nycu/start`(硬寫)**。
- 三個登入入口(`src/index.ts:80-88`):`/auth/nycu/start`→`startNycu`(155);`/auth/github/login`→`startOAuthLogin(...,"github")`;`/auth/google/login`→`startOAuthLogin(...,"google")`(221-247)。這是「替代登入」(反查既有綁定),不需既有 session。
- `app_return` 帶入:`startNycu`(165-166)與 `startOAuthLogin`(231-232)都 `if (prev?.app_return) session.app_return = prev.app_return;`。取出:`nycuCallback`(195-196)、`githubCallback` login 分支(361-362)、`googleCallback` login 分支(492-493、502-503)都呼叫 `postLoginDestination(env, nycu_id, session.app_return)`(291-298)→ `appTokenRedirect`(255-263)帶 `#mtoken` 回 app。
- 靜態首頁(`index.html:67-77`)的三顆按鈕連 `WORKER_BASE + /auth/{nycu/start,github/login,google/login}?lang=<lang>`;標籤(34-48)zh「用 GitHub 登入」「用 Google 登入」,alt-label「已綁定過的人,也可以改用:」。
- worker 內頁渲染慣例:`pickLang(url, cookieHeader)`(`src/i18n.ts:5`)取語言、`langCookie(lang)`(12)寫回;`documentStart(lang, title, css)`(`src/ui/layout.ts:7`)做 HTML 頭;回應 `new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": ... } })`。字串表 `T`(`src/i18n.ts:268`)。
- 現有測試斷言 NYCU-only 重導:`test/app_start.test.ts`(未登入 → 302 `/auth/nycu/start` + Set-Cookie);`test/app_sso_flow.test.ts:42-43`(302 到 `/auth/nycu/start`)。

## 2. 設計

### 2.1 `startApp` 未登入分支改為回選擇頁(`src/index.ts`)

未登入時:
1. 一如現況,建立 pre-login session(`{ exp, app_return: { app, return } }`)、`signSession`、`setCookie`。
2. 取 `lang = pickLang(url, req.headers.get("Cookie"))`。
3. **回傳選擇頁**:`new Response(appLoginChooserPage(lang, app), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": <session cookie>, ... langCookie(lang) } })`。
   - 注意 `Set-Cookie` 要同時帶 **session cookie**(存 `app_return`,必要)與 `langCookie(lang)`(用 `headers.append`,兩個 Set-Cookie)。
   - 已登入分支不變(直接 `appTokenRedirect`)。
   - `allowedReturn` 400 分支不變。

### 2.2 選擇頁渲染 `appLoginChooserPage(lang, appId)`(新 `src/ui/app_login.ts`)

- 用 `documentStart(lang, title, css)` 產生頁首;標題如 zh「登入 maccount」/ en「Sign in to maccount」。
- 內文:一句「登入以繼續使用 <appId> / Sign in to continue to <appId>」(`appId` 需 HTML-escape,用既有 `escapeHtml`),再三顆連結按鈕:
  - NYCU → `/auth/nycu/start?lang=<lang>`
  - GitHub → `/auth/github/login?lang=<lang>`
  - Google → `/auth/google/login?lang=<lang>`
  - 皆為同源相對路徑;因 session cookie(含 `app_return`)已於 2.1 設定,點任一顆都會把它帶去對應 start handler。
- 樣式沿用 layout 既有 CSS 類別(與首頁按鈕一致即可,無需新樣式檔)。
- 純伺服器渲染、無 JS 必要。

### 2.3 i18n(`src/i18n.ts`)

在 `T` 的 zh/en 各新增選擇頁字串鍵(沿用首頁措辭):
- `appLogin.title`:zh「登入 maccount」/ en「Sign in to maccount」
- `appLogin.subtitle`:zh「登入以繼續使用 {app}」/ en「Sign in to continue to {app}」(`{app}` 於渲染時替換 + escape)
- `appLogin.nycu`:zh「以 NYCU 帳號登入」/ en「Sign in with NYCU」
- `appLogin.github`:zh「用 GitHub 登入」/ en「Sign in with GitHub」
- `appLogin.google`:zh「用 Google 登入」/ en「Sign in with Google」
- `appLogin.note`:zh「GitHub / Google 需為已在 maccount 綁定過的帳號」/ en「GitHub / Google must be an account already linked in maccount.」

(若 `T` 型別為固定 `Strings` interface,於該 interface 補上對應欄位。)

## 3. 檔案清單

**maccount:**
- 新增:`src/ui/app_login.ts`(`appLoginChooserPage(lang, appId)`)。
- 修改:`src/index.ts`(`startApp` 未登入分支改回選擇頁;import 新渲染 + `pickLang`/`langCookie` 若尚未在該檔範圍)、`src/i18n.ts`(新增 `appLogin.*` 字串,zh/en;必要時補型別)。
- 測試:`test/app_start.test.ts`(未登入 → 200 選擇頁,含三個登入連結 + Set-Cookie 帶 `app_return`)、`test/app_sso_flow.test.ts`(未登入落到選擇頁;新增 GitHub、Google 兩路徑的端到端:選擇頁 →(帶 cookie)登入 → callback → 帶 `#mtoken` 回 app);可加 `test/ui/app_login` 單元測試渲染三連結。
- 不動:既有 OAuth 綁定/登入、`/me`、admin、grades、既有 `appTokenRedirect`/`postLoginDestination`/`/api/app/verify`。

**dsvisual(小幅文案,獨立小 PR):**
- 修改:`js/i18n.js`——`cloud.signin-cta` 由「Sign in with NYCU / 以 NYCU 帳號登入」改「Sign in / 登入」;`cloud.signin-note` 由「以你的 NYCU 帳號登入…」改為「以你在 maccount 綁定的 NYCU / GitHub / Google 帳號登入…」。`lab.dsjudgeSignin`(「Sign in to practice on dsjudge」)已中性,不改。無生成檔、無需 rebuild。

## 4. 測試

- **選擇頁(未登入)**:`GET /auth/app/start?app=dsvisual&return=<allowed>` → `200`,body 含三個連結 `href` 指向 `/auth/nycu/start`、`/auth/github/login`、`/auth/google/login`(皆帶 `lang`);回應 `Set-Cookie` 含 `maccount_session`,且該 session verify 後 `app_return` = `{app:"dsvisual", return:<...>}`。
- **已登入**:帶有效 nycu session → 仍 `302` 帶 `#mtoken`(既有行為不變)。
- **allowlist**:非白名單 app/return → `400`(不變)。
- **端到端 × 3**:自選擇頁分別點 NYCU / GitHub / Google(帶 pre-login cookie)→ 模擬各自 callback 成功 → `302` 回 `<return>#mtoken=…`,且 `verifyAppToken` 解出正確 `sub`/`aud`/`providers`。GitHub、Google 走「替代登入」(反查既有綁定)。
- **lang 保留**:`?lang=en` → 選擇頁英文、三連結帶 `lang=en`。
- **回歸**:既有 vitest 全綠(更新兩個原本斷言 NYCU-only 重導的測試);`/me`、綁定、admin、grades 不變。
- **dsvisual**:`npm run test:all` 綠;既有 cloud-drawer / lab-dsjudge 測試不因文案改動而壞(若測試比對文字需同步更新)。

## 5. 驗收標準

- dsvisual(或任一 allowlist app)未登入按登入 → 落在 maccount 選擇頁,可選 NYCU / GitHub / Google;三者皆能登入並帶 `#mtoken` 回 app。
- 已綁定 GitHub/Google 的使用者可免走 NYCU 直接登入。
- 已登入、allowlist、token 短效/`aud` 綁定等既有安全性質不變。
- maccount vitest 全綠;dsvisual `npm run test:all` 綠。

## 6. 風險與緩解

- **未綁定的 GitHub/Google 帳號**:「替代登入」callback 對查不到綁定者的既有處理不變(導到 done 頁提示先用 NYCU 綁定);選擇頁加 `appLogin.note` 事先提示。app-SSO 情境下,若替代登入失敗,使用者退回選擇頁改用 NYCU;`app_return` 仍在 cookie。
- **多個 Set-Cookie**:選擇頁需同時 append session cookie 與 langCookie,勿互相覆蓋(用 `headers.append("Set-Cookie", ...)` 兩次)。
- **cookie 帶入**:選擇頁與三個登入路由同源(worker 網域),cookie 必送;`app_return` 由 start handler 既有邏輯帶入、callback 既有邏輯取出——不需改動管線。
- **測試契約變更**:兩個原斷言 302→NYCU 的測試改為斷言選擇頁;屬預期行為變更。
- **XSS**:`appId` 來自 URL,渲染前必須 escape(用既有 `escapeHtml`)。app 已受 `allowedReturn` 白名單約束,但仍一律 escape。
- **範圍**:僅新增選擇頁 + 改一處重導 + 文案;不動 token/CORS/verify 與既有登入。
