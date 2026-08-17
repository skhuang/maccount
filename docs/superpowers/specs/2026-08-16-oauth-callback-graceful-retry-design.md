# OAuth callback graceful-retry 設計文件 — state 不符時不再 dead-end 400

- 日期:2026-08-16
- Repo:`maccount`(Cloudflare Worker + D1);branch `fix/oauth-callback-graceful-retry`
- 動機:三個 OAuth callback(`nycuCallback`/`githubCallback`/`googleCallback`)在 **state 不符 / 缺 state session**(良性:過期或自動發起的 authorize、遺失的 state cookie、重複點擊、Google 靜默登入 `prompt=none`)時,直接回傳 `400 "Invalid … callback"`,把使用者卡死在死路頁。實際案例:app-SSO 選擇頁流程中,瀏覽器把**選擇頁 cookie(有 `app_return`、無 `gostate`)**送到 `/auth/google/callback` → state check 失敗 → 400。應改為**優雅重試**:若知道使用者要去哪(`app_return`),把他導回 `/auth/app/start` 重新開始(產生新 state);否則導到 done 頁提示重試。

## 0. 範圍與決策(已與使用者確認)

- **三個 callback 的 state-mismatch 分支**改為呼叫共用 `recoverLogin(env, session)`,取代 `400`。
- **不弱化 CSRF**:state 不符時**絕不完成登入**(不交換 code、不建立登入 session);只是把死路 400 換成友善導回。攻擊者偽造的 callback 只會被導回選擇頁/done 頁,無害。
- **不自動重打 OAuth**(避免迴圈):導回 `/auth/app/start` 只顯示選擇頁(200),需使用者再點一次方法才產生新 state;無伺服器端迴圈。
- **僅 maccount**;不動 dsvisual、不動 token/CORS/verify 與成功路徑。
- OAuth `error` 參數的既有處理(`redirectDone(env,"err",…)`)不變。

## 1. 現況(已查證,file:line)

- 三處相同型樣:
  - `nycuCallback`(`src/index.ts:185-187`):`if (!session || !session.nstate || session.nstate !== state || !code) return new Response("Invalid NYCU callback", {status:400});`
  - `githubCallback`(`351-353`):`session.gstate` 版。
  - `googleCallback`(`462-464`):`session.gostate` 版。
- 前面都已有 `if (oauthError) return redirectDone(env, "err", \`<p>_${oauthError}\`)`(OAuth 錯誤已優雅處理)。
- `redirectDone(env, status, reason?)`(`337-342`):導向 `FRONTEND_DONE_URL?status=&reason=`,並 `clearCookie()`。
- `redirect(location, cookie?)`(`142-146`):302 + Set-Cookie。
- `SessionData.app_return?: { app, return }`(`src/session.ts:9`)。`allowedReturn`(`src/app_sso.ts`,已 import 於 `index.ts:44`)驗 return 前綴。
- `/auth/app/start`(`268-288`):未登入 → 存 `app_return` 進 pre-login cookie(**覆蓋**舊 cookie)並回選擇頁;已登入 → mint token 導回 app。故導回 `/auth/app/start?app=&return=` 會以新鮮 state 重來。

## 2. 設計

### 2.1 共用 `recoverLogin(env, session)`(`src/index.ts`)

```ts
// A benign callback-state mismatch (stale or auto-initiated authorize, a lost
// state cookie, a double-submit, or Google silent `prompt=none` sign-in) is not
// an error to dead-end on. We never complete a login on a mismatched state, so
// CSRF protection is intact — this only replaces a raw 400 with a friendly path.
// If we know where the user was headed (app_return), bounce them back to
// /auth/app/start to restart cleanly with a fresh state (the chooser is a 200,
// so there is no auto-redirect loop); otherwise send them to the done page.
function recoverLogin(env: Env, session: SessionData | null): Response {
  const ar = session?.app_return;
  if (ar && allowedReturn(env, ar.app, ar.return)) {
    return redirect(
      `/auth/app/start?app=${encodeURIComponent(ar.app)}&return=${encodeURIComponent(ar.return)}`,
    );
  }
  return redirectDone(env, "err", "login_retry");
}
```

### 2.2 三個 callback 改用它

三處 `return new Response("Invalid … callback", { status: 400 });` 改為 `return recoverLogin(env, session);`。其餘不動(成功路徑、oauthError 分支、code 交換等皆不變)。

- 說明:失敗時的 `session` 可能是選擇頁 cookie(有 `app_return`、無 `gostate`)→ 走 app_return 分支導回選擇頁(正是使用者情境的自癒)。也可能是 `null` 或無 `app_return`(從首頁一般登入)→ 走 done 頁 `reason=login_retry`。

### 2.3 done 頁文案(選填,前端 repo,不阻斷)

`FRONTEND_DONE_URL` 的靜態 done 頁若對未知 `reason` 已有通用顯示,`login_retry` 可直接沿用;可日後在前端補一句「登入逾時或中斷,請再試一次」。本次 maccount 後端不依賴前端字串。

## 3. 檔案清單(maccount)

- 修改:`src/index.ts`(新增 `recoverLogin`;三個 callback 的 400 改呼叫它)。
- 測試:`test/`(vitest)新增 callback graceful-retry 案例(見 §4)。
- 不動:成功登入/綁定、token/CORS/verify、`/me`、admin、grades、dsvisual。

## 4. 測試

- **app_return 分支(核心,重現使用者情境)**:對 `/auth/google/callback?state=X&code=…` 帶一個 **有 `app_return`、`gostate` 缺或不符** 的 session cookie → **302 到 `/auth/app/start?app=dsvisual&return=<...>`**(非 400)。對 nycu(`nstate`)、github(`gstate`)各一。
- **done 分支**:session 為 `null`(無 cookie)或有 cookie 但**無 `app_return`** 且 state 不符 → **302 到 `FRONTEND_DONE_URL` 且 `status=err&reason=login_retry`**、含 `clearCookie`(非 400)。
- **成功路徑不變**:既有 nycu/github/google 成功登入與 app-SSO 端到端測試仍綠(state 相符時行為不變)。
- **無迴圈**:app_return 分支導向 `/auth/app/start`,該路由未登入時回選擇頁 200(不自動重打 OAuth)。
- **回歸**:`npm test` 全綠;`tsc --noEmit` clean。

## 5. 驗收標準

- app-SSO 流程中發生 state 不符(過期/自動/選擇頁 cookie 被送到 callback)時,使用者被導回選擇頁重試,而非看到 `400 Invalid … callback`。
- 一般首頁登入的 state 不符 → 導到 done 頁提示重試並清 cookie。
- state 相符的正常登入不受影響;不完成任何 state 不符的登入(CSRF 不弱化)。
- vitest 全綠。

## 6. 風險與緩解

- **CSRF**:state 不符一律不完成登入,只導回;維持既有保護。
- **開放重導**:app_return 分支導向站內 `/auth/app/start` 相對路徑,且 `allowedReturn` 已驗 `app`/`return` 前綴白名單;done 分支導向設定的 `FRONTEND_DONE_URL`。皆非任意外站。
- **迴圈**:選擇頁為 200 不自動重打;需使用者再點方法,無伺服器迴圈。極端(cookie 全禁)下使用者手動重試仍可能反覆,但非本修正引入。
- **範圍**:僅三個 callback 的失敗分支 + 一個 helper;成功路徑與其他一切不變。
