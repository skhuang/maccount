# 交接清單：dsjudge 側支援 google-only（無 repo）學生

- 日期：2026-09-01
- 對象：dsjudge / ds2026summer（`ds2026summer.cs.nycu.edu.tw`）維護者
- 相關：maccount 設計 spec [`docs/superpowers/specs/2026-09-01-google-only-student-support-design.md`](../specs/2026-09-01-google-only-student-support-design.md)
- **maccount 側已完成並上線**（本清單只列 dsjudge 要改的點）

## 背景（一句話）
有些學生是「手動綁定」——**只有 Google、沒有 GitHub 帳號、沒有 repo**（例：`AT9337`）。dsjudge 目前以 GitHub 為主鍵（`/api/roster` = `github_login,student_id`，故意跳過無 github 者），所以這些學生在 dsjudge 完全看不到自己的課。目標：讓他們**看得到課程、看成績、繳交「非程式」作業**（不碰 repo）。

## maccount 已提供的介面（都在 `https://maccount-api.skhuang.workers.dev`，全部 `Authorization: Bearer <GRADES_INGEST_TOKEN>`）

1. **`GET /api/resolve-google?sub=<sub>&email=<email>`** — 已改：**先 `sub` 後 `email` fallback**。
   - 回 `200 {"student_id":"AT9337"}`，查無 → `404 {"student_id":null}`，缺兩者 → `400`。
   - 對 google-only 學生用 **email** 就能解析（他們在 maccount 尚未認領 `google_sub`）。dsjudge 用自己的 Google OAuth 拿到 verified email 後帶進來即可。
2. **`GET /api/courses?student_id=<id>`** — 新：學生選了哪些課。
   - 回 `200 {"student_id":"AT9337","courses":[{"course_id":"mk-2026","name":"…"}]}`；沒選課 → `courses:[]`（200，非 404）。
3. **`GET /api/enrolled?course_id=<id>`** — 新：整份選課名冊，**含 google-only（`github_login` 為 null）**。
   - 回 `200 {"course_id":"mk-2026","students":[{"student_id,"name","github_login","google_email"}...]}`；未知課 → `404`。
   - 對照：`/api/roster`（維持不變）仍只回有 github 的人，供 repo provision 用。

不變：`POST /api/grades/ingest`（成績鏡像，含非程式作業成績照推）、`/api/roster`、登入流程。

## dsjudge 要改的點（Checklist）

- [ ] **認人（登入）改用 email**：dsjudge 的「用 Google 登入」在呼叫 `/api/resolve-google` 時，**同時帶 `email`**（不要只帶 `sub`）。這樣 google-only 學生（sub 未認領）也能解析出 `student_id`。GitHub 登入路徑（`/api/resolve-github`）維持不變。
- [ ] **課程可見性改用 `/api/courses`**：登入取得 `student_id` 後，用 `GET /api/courses?student_id=` 列出學生的課，**不要只靠 github roster 推斷課程**（那會漏掉 google-only 學生）。這是「AT9337 看不到 mk-2026」的直接修法。
- [ ] **名冊改用 `/api/enrolled`（需要含 google-only 時）**：要為整班（含無 github 者）建立作業／追蹤繳交時，改用 `GET /api/enrolled?course_id=`。**程式題 repo provision 仍用 `/api/roster`**（github-only，維持不變）——兩者分工：repo 題用 roster、非程式題用 enrolled。
- [ ] **新增「no-repo assignment」作業型別**（dsjudge 內部）：一種不需要 GitHub repo 的作業，交件方式為上傳／表單／紙筆登錄（由 dsjudge 自行實作與儲存；**maccount 不存交件**）。
- [ ] **交件 UI + 儲存**（dsjudge 內部）：google-only 學生能在 dsjudge 對 no-repo 作業繳交。儲存位置與機制由 dsjudge 決定。
- [ ] **provision 要跳過無 github 的學生**：現有「為每位學生建 repo」的流程，遇到 `github_login` 為 null 者要**略過**（不要嘗試建 repo／報錯）。用 `/api/enrolled` 分辨：`github_login=null` = google-only → 只給 no-repo 作業。
- [ ] **成績照舊回推**：no-repo 作業批改後，用**現有** `POST /api/grades/ingest` 推 `score+verdict`（可帶 `course_id`、`assignment_id`、`assignment_type`）。maccount `/me` 會照常顯示。**不需要新的成績端點**。
- [ ] **同時有 github+google 的學生不受影響**：`AT9336` 這類人 `github_login` 有值，走原本 github 流程即可；不要因為新邏輯改變他們的行為。

## 驗證（dsjudge 改完後）
- [ ] 用 `AT9337`（google-only）登入 dsjudge → 看得到 `mk-2026`。
- [ ] `AT9337` 能對某個 no-repo 作業繳交，且不觸發任何 repo 建立。
- [ ] `AT9336`（有 github）行為不變，程式題仍能建 repo/評分。
- [ ] no-repo 作業成績出現在 maccount `/me`（代表 ingest 正常）。
- [ ] maccount 端可自行驗證（需 token）：
  ```bash
  curl -H "Authorization: Bearer <GRADES_INGEST_TOKEN>" \
    "https://maccount-api.skhuang.workers.dev/api/courses?student_id=AT9337"
  curl -H "Authorization: Bearer <GRADES_INGEST_TOKEN>" \
    "https://maccount-api.skhuang.workers.dev/api/enrolled?course_id=mk-2026"
  ```

## 給 dsjudge 決定的開放問題
- no-repo 作業的**交件形式**（純上傳檔案？連到外部 Google 表單？純紙筆＝老師登錄分數？）與**儲存位置**（dsjudge DB／物件儲存）。
- no-repo 作業的**評分方式**（人工／自動）與誰負責推 `grades/ingest`。
- 是否要在 dsjudge 顯示「此學生為 google-only、無 repo」的標記，避免助教誤以為漏建 repo。
