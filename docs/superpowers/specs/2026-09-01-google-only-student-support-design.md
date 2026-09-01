# Google-only（無 GitHub / 無 repo）學生的跨服務支援 — 設計文件

- 日期：2026-09-01
- 狀態：設計討論完成，待審 → 寫實作計畫（僅 maccount 側）
- repo：`github.com/skhuang/maccount`（本 spec 只實作 maccount 側；dsjudge 側為消費者契約）

## 1. 問題

maccount 有三種帳號提供方式，其中「手動綁定」的學生可能**只有 Google、沒有 GitHub**（`bindings.github_login = NULL`）。
dsjudge / ds2026summer（GitHub-based OJ）目前只能透過 `/api/roster`（`github_login,student_id`，**故意跳過無 GitHub 者**）得知課程成員，
並以 GitHub 為主鍵。因此 google-only 學生（如 `AT9337`）即使已選課，dsjudge 也看不到他 → 學生在 dsjudge 看不到自己的課程。

實例：`AT9336`（有 GitHub）與 `AT9337`（手動、google-only）都選了 `mk-2026`，但只有 `AT9336` 在 dsjudge 看得到。

## 2. 目標與範圍

讓 google-only 學生能在 dsjudge：**看到自己的課程、看成績、繳交「非程式」作業**（無 repo 的上傳／問卷／紙筆登錄）。

### 邊界（重要）
- **maccount 維持「只鏡像成績」**（OJ 鐵則 2）：交件與儲存由 **dsjudge 負責**；成績照現有 `POST /api/grades/ingest` 推回，**不改**。
- 程式題（需要 repo）本質上需要 GitHub，不在此範圍：google-only 學生不做需要 repo 的題目。
- **本 spec 只實作 maccount 側 API**。dsjudge 側（另一個 repo）為消費者，另行實作；本文件把 dsjudge 需要的契約寫清楚。

## 3. maccount 側改動（三項，皆 `Authorization: Bearer <GRADES_INGEST_TOKEN>`）

### 3.1 修正 `GET /api/resolve-google` — 加 email fallback
現況（`src/index.ts` `apiResolveGoogle`）：
```ts
const row = sub ? await getBindingByGoogleSub(env.DB, sub)
                : await getBindingByGoogleEmail(env.DB, email!);
```
問題：帶了 `sub` 就只查 sub；google-only 學生在 maccount 尚未認領 `google_sub`（NULL），故查不到 → 404。

改為「先 sub 後 email」：
```ts
const row =
  (sub ? await getBindingByGoogleSub(env.DB, sub) : null) ??
  (email ? await getBindingByGoogleEmail(env.DB, email) : null);
```
- 行為：`sub` 命中優先；未命中且有 `email` 就用 email 反查（大小寫不敏感，`getBindingByGoogleEmail` 已具備）。
- 安全：email 命中 = 呼叫方（dsjudge）已用自己的 Google OAuth 驗證該 email，信任模型同 maccount 既有的「手動綁定登入」。
- 回傳不變：命中 `{ student_id }` 200；否則 `{ student_id: null }` 404。

### 3.2 新增 `GET /api/courses?student_id=<id>`
- 授權：`bearerOk`（同一把 `GRADES_INGEST_TOKEN`）。
- 缺 `student_id` → 400 `{ error: "need student_id" }`。
- 實作：`coursesForStudent(db, student_id)`（回 `course_id[]`）＋以 `listCourses` 建 `course_id→name` 對照，組出課名。
- 回傳：
  ```json
  { "student_id": "AT9337", "courses": [ { "course_id": "mk-2026", "name": "行銷 2026" } ] }
  ```
  查無選課 → `{ "student_id": "AT9337", "courses": [] }`（200，非 404；學生存在但沒選課是合法狀態）。
- 用途：dsjudge 以 resolve 得到 `student_id` 後，用這支列出該生課程 → google-only 學生就能在 dsjudge 看到 `mk-2026`。

### 3.3 新增 `GET /api/enrolled?course_id=<id>`
- 授權：`bearerOk`。
- 缺 `course_id` → 400；課程不存在（`getCourse` 為 null）→ 404 `{ error: "course not found" }`。
- 實作：`listEnrolledWithBinding(db, course_id)`（`EnrolledStudent[]`）。
- 回傳（**包含沒有 GitHub 的人**）：
  ```json
  {
    "course_id": "mk-2026",
    "students": [
      { "student_id": "AT9336", "name": null, "github_login": "skhuang", "google_email": "kun6372@gmail.com" },
      { "student_id": "AT9337", "name": "黃測試", "github_login": null, "google_email": "skhuang@g2.nctu.edu.tw" }
    ]
  }
  ```
  欄位取 `EnrolledStudent` 的 `student_id / name / github_login / google_email`（**不含** `email`(Moodle)、`github_id`、`nycu_name`，避免多餘 PII 外流；如 dsjudge 需要再加）。
- 用途：dsjudge 建立/追蹤課程作業時，能看到 google-only 學生（`github_login=null`），為他們開「非程式作業」track。

### 為什麼不改 `/api/roster`
`/api/roster` 是固定 `github_login,student_id` CSV 且**故意跳過無 GitHub 者**；github-keyed 的既有消費者（repo provision、roster-sync）仰賴此形狀。**不動它**，改開 `/api/enrolled`（JSON、含 google-only）避免破壞既有整合。

## 4. 資料流（google-only 學生在 dsjudge）

1. 學生在 dsjudge 用自己的 Google 登入（dsjudge 端 OAuth）。
2. dsjudge → `GET /api/resolve-google?email=<verified email>`（或帶 sub）→ maccount 回 `student_id`（3.1 的 email fallback 讓 google-only 也解析得到）。
3. dsjudge → `GET /api/courses?student_id=<id>` → 列出該生課程（含 `mk-2026`）。
4. dsjudge 顯示課程與**非程式作業**；學生在 dsjudge 交件（上傳/問卷/紙筆登錄）。
5. dsjudge 批改後 → 照現有 `POST /api/grades/ingest` 把 `score+verdict` 推回 maccount（不變）。
6.（可選）dsjudge 用 `GET /api/enrolled?course_id=` 取得完整名冊（含 google-only）來建作業對象。

## 5. dsjudge 側（另一 repo，非本次實作；此為消費者契約）
- 認人：resolve-google 支援 email（不再要求已認領 sub）。
- 課程可見性：改用 `/api/courses?student_id=`（而非只靠 github roster）。
- 名冊：需要含 google-only 時改用 `/api/enrolled?course_id=`（JSON）；程式題 provision 仍用 `/api/roster`（github-only，維持不變）。
- 新增「no-repo assignment」型別 + 交件 UI（dsjudge 內部；maccount 不介入）。
- 成績照 `/api/grades/ingest` 推回。

## 6. 測試（maccount 側）
- resolve-google：sub 命中；sub 未命中但 email 命中（google-only，sub=NULL）→ 解析成功；兩者皆無 → 404；只帶 email 命中；缺參數 → 400。
- `/api/courses`：token 缺/錯 → 401；缺 student_id → 400；有選課回課名陣列；無選課回 `[]`；未知學生回 `[]`。
- `/api/enrolled`：token 缺/錯 → 401；缺 course_id → 400；課程不存在 → 404；回傳含 google-only（`github_login=null`）與有 github 者；欄位只含約定四欄。

## 7. 安全與相容
- 三支皆 token-auth（`GRADES_INGEST_TOKEN`），與現有 roster/ingest 同一把。
- 不改 `/api/roster`、不改 `/api/grades/ingest`、不改任何登入流程 → 對現有 github-based 整合零影響。
- email fallback 的信任邊界同「手動綁定登入」。

## 8. 待確認 / 已決定
- 授權：**用同一把 `GRADES_INGEST_TOKEN`**（已確認）。
- 交件儲存：**dsjudge 負責，maccount 只鏡像成績**（已確認）。
- google-only 學生做非程式作業（已確認範圍）。
