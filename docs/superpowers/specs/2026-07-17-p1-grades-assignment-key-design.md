# P1 設計：maccount grades 納入 assignment_id 鍵

日期：2026-07-17
狀態：設計已確認，待 writing-plans
所屬 roadmap：`docs/superpowers/specs/2026-07-17-grades-assignment-key-roadmap.md`（P1）

## 目標

把 `grades` 的身分從 `(course_id, student_id, problem_id)` 擴成 **`(course_id, assignment_id, student_id, problem_id)`**，讓同一 `problem_id` 在同課被多個 assignment 使用時，成績不再在主鍵上互蓋。這是跨 repo 修復的地基（P2/P3 依賴它），本身即資料正確性修復。

非目標：不改 P3（seminar-moodle 拉法）、不改 P2（dsjudge 推送）；本 P1 對外**向後相容**。

## 已確認的決策

| 項目 | 值 | 說明 |
|------|-----|------|
| 新主鍵 | `(course_id, assignment_id, student_id, problem_id)` | assignment_id 從標籤升級為鍵 |
| 「無特定 assignment」bucket | **`on-line-bank`** | 未來題庫直解 + ingest 缺值的預設；具名、可在 `/me` 顯示為題庫練習 |
| legacy 回填值 | **`_legacy`** | migration 時舊 null 列回填；前綴底線 → 不可能撞真 assignment id（dsjudge id 正則首字須 `[a-z0-9]`） |
| `problem_id`-only route | 保留、純加參數 | 過渡相容；P3 更新前現有呼叫照常 |

**原則（來自使用者，驅動上述）**：
1. Moodle 評分一定帶 assignment_id（quiz/assignment 皆有）→ `problem_id`-only 純屬過渡。
2. 未來支援 problem_id-only online judge（學生從題庫直解），用共同 assignment_id `on-line-bank`。

## 架構

### 1. Schema 遷移（`migrations/0020_grades_assignment_key.sql`）

沿用 `0006` 的手法（SQLite 不能就地改 PK）：rename → 建新表 → `INSERT…SELECT` 回填 → drop。

```sql
-- grades: PK (course_id, student_id, problem_id)
--      -> (course_id, assignment_id, student_id, problem_id)
-- so one problem reused across assignments (lab + exam in a course) no longer
-- collides. Legacy rows (assignment_id NULL, pre-0008) backfill to '_legacy'
-- (leading underscore => can't collide with a real dsjudge assignment id).
ALTER TABLE grades RENAME TO grades_old;
CREATE TABLE grades (
  course_id        TEXT NOT NULL,
  assignment_id    TEXT NOT NULL DEFAULT 'on-line-bank',
  student_id       TEXT NOT NULL,
  problem_id       TEXT NOT NULL,
  verdict          TEXT,
  score            INTEGER,
  max_score        INTEGER,
  updated_at       TEXT NOT NULL,
  repo             TEXT,
  assignment_type  TEXT,
  assignment_title TEXT,
  PRIMARY KEY (course_id, assignment_id, student_id, problem_id)
);
INSERT INTO grades
  (course_id, assignment_id, student_id, problem_id, verdict, score, max_score,
   updated_at, repo, assignment_type, assignment_title)
  SELECT course_id, COALESCE(NULLIF(assignment_id, ''), '_legacy'),
         student_id, problem_id, verdict, score, max_score,
         updated_at, repo, assignment_type, assignment_title
  FROM grades_old;
DROP TABLE grades_old;
```

- 回填 `COALESCE(NULLIF(assignment_id,''),'_legacy')`：舊 null **與**空字串都收斂成 `_legacy`。
- **不會撞列**：舊 PK 不含 assignment_id，一組 `(course, student, problem)` 只有一列 → 一對一搬遷。
- 欄位順序把 `assignment_id` 提到 course_id 之後（鍵相鄰），其餘沿用 `0007`/`0008` 既有欄位。
- migrations 現有一個 `0016` 重號（`0016_assignment_visibility` + `0016_enrollments_email`）；本檔用 `0020`，不動既有。

### 2. `src/db/grades.ts`

- `GradeRow`/`GradeInput` 已含 `assignment_id`（型別不變）。
- `upsertGrades`：`ON CONFLICT` 改 **四鍵** `(course_id, assignment_id, student_id, problem_id)`；`assignment_id` 進 VALUES 時 `?? 'on-line-bank'`（ingest 端亦保險）；COALESCE 更新語義**維持**（provision 列設 repo/assignment、judge 列補 score，互不清）。
- `listGradesForProblem(db, problem_id, course_id?, assignment_id?)`：依帶到的參數逐步 `AND` 收窄；三者皆可選（除 problem_id 必填）。回傳型別不變。
- `listGradesForStudentAssignment` / `listGradesFor` / visibility 相關：**不改邏輯**（新鍵下 `/me`、`/me/exam` 自動修好，不再漏題）。

### 3. ingest route（`/api/grades/ingest`，`src/index.ts`）

- 每列 `assignment_id`：型別檢查後，**缺 / 空 / null → 落 `on-line-bank`**（不再視為可略；但也不拒收，符合原則 2 的預設 bucket）。
- 其餘欄位對應不變。

### 4. `GET /api/grades` route（`apiGrades`，`src/index.ts`）

- 新增可選 query：**`assignment_id`**、**`course_id`**。
- 呼叫 `listGradesForProblem(db, problemId, courseId ?? undefined, assignmentId ?? undefined)`。
- **保留 `problem_id` 必填、其餘可選**（純加參數，完全向後相容）。
- 順手修 bug：目前 `apiGrades` 沒把 `course_id` 傳進查詢（`index.ts:621`）；帶了就傳。
- 語義備註：`problem_id`-only 回所有符合列（可能跨 assignment）。同題**開始重用前**每題仍一場 → 舊呼叫安全；**重用啟用前必須先讓 P3 帶 assignment_id**（rollout 次序，寫進 roadmap）。

### 5. `/me` 與 `/me/exam`（不需改，驗證即可）

- `/me/exam/<assignment_id>`：新鍵下 `WHERE assignment_id=?` 不再漏題。
- `/me` flat summary：Σ 不再受撞列影響。
- `on-line-bank` / `_legacy` 是普通 assignment_id 值：`/me` flat 照列；exam 清單只列 exam-type，故這兩個 bucket 不會被當考試連出去。

## 錯誤處理

- ingest 缺 assignment_id → `on-line-bank`（預設，不拋）。
- route 未帶 assignment_id/course_id → 維持舊行為（problem_id-only）。
- 遷移失敗 → 交易回滾（wrangler d1 migration 單檔原子）；上線前 `--local` 演練 + production 備份。

## 測試（vitest，`test/`）

- `upsertGrades`：
  - 同 `(course, student, problem)` 不同 `assignment_id` → **兩列共存**（核心修復）。
  - 同四鍵、provision 列(repo+assignment，score null) 後接 judge 列(score，無 title) → COALESCE 合併、互不清（不分先後）。
  - 缺 assignment_id → 落 `on-line-bank`。
- `listGradesForProblem`：`problem_id`-only / `+course_id` / `+assignment_id` / 三者 各自過濾正確。
- ingest route：body 缺 assignment_id → `on-line-bank`；帶了 → 照用。
- `GET /api/grades`：`?problem_id=`（相容）、`?problem_id=&assignment_id=&course_id=` 過濾。
- 遷移：seed 舊列（含 null / '' assignment_id）跑遷移 → 收斂 `_legacy`、列數不變、其餘欄位保留。

## 向後相容 / rollout

- P1 上線 = 遷移 + 純加參數的 route → **不破**現有 seminar-moodle `problem_id`-only 呼叫。
- 之後 P3 改帶 assignment_id、P2 確認每 (assignment, problem) 各推一列 → 才實際啟用「同題跨 assignment」。
- 哨兵 `on-line-bank` / legacy `_legacy` 一旦上線即長期合約，三 repo 一致。

## 不做（YAGNI）

- 不加 assignment 級跨學生聚合端點（那是 P3 若走「assignment 總分」才需要，屆時再議）。
- 不改 `/me` / scoreboard 呈現。
- 不動 P2 / P3。
