# Roadmap：同題跨 assignment 的成績分離（跨 repo）

日期：2026-07-17
狀態：跨 repo 拆解草案。P1（maccount）先行；P2（dsjudge）、P3（seminar-moodle）後續。
相關 repo：`maccount`（本 repo）、`dsjudge`、`seminar-moodle`。

## 問題陳述（root cause）

maccount `grades` 主鍵 = `(course_id, student_id, problem_id)`，`assignment_id` 只是去正規化欄位（`src/db/grades.ts`，migration `0006`/`0008`）。同一 `problem_id` 若在同一門課被**多個 assignment** 使用（lab 與 exam 共用題庫題目），兩筆 upsert 撞進同一列：

- `ON CONFLICT(course_id, student_id, problem_id)` → score 被後來的判題覆蓋；
- `assignment_id = COALESCE(?, assignment_id)` → 停在先寫入的那個 assignment；
- `GET /api/grades?problem_id=`（`apiGrades`，`src/index.ts:619-621`）無 assignment 維度、且未傳 course_id → 回傳跨課該題所有列，無法分辨 assignment；
- `/me/exam/<assignment_id>`（`listGradesForStudentAssignment`，`WHERE assignment_id=?`）會漏題（該列 assignment_id 停在別場）。

**源頭（dsjudge）其實已帶 `assignment_id`**（`app/grader.py:204` 判題鏡像、provision 推送），成績是在 **maccount 的主鍵**這關被合掉的。

## 核心不變式變更（貫穿三 repo）

「成績的身分」從 `(course, student, problem)` → **`(course, assignment, student, problem)`**。`assignment_id` 從「標籤」升級為「鍵」。

## 子專案拆解

### P1 — maccount：把 assignment_id 納入鍵（地基，先做）

- **schema 遷移**：`grades` 主鍵改 `(course_id, assignment_id, student_id, problem_id)`。SQLite 改 PK 需**重建表 + 搬資料**（新表 → copy → swap）。
- **NULL 陷阱**：現有 ungrouped 列 `assignment_id` 為 null；SQLite 中 NULL 在 UNIQUE/PK 視為相異、無法當穩定鍵。→ 用**哨兵值**（如 `''` 或 `_ungrouped`）取代 null，遷移時一次性回填。
- **ingest**（`/api/grades/ingest`）：`assignment_id` 變必填（或缺省填哨兵）；`ON CONFLICT` 改新四鍵；COALESCE 語義維持（provision 列 vs judge 列互不清）。
- **route**：`GET /api/grades` 加 `assignment_id`（+ 真的把 `course_id` 傳進 `listGradesForProblem`，目前漏傳）。是否保留 `problem_id`-only 為 legacy（跨 assignment 加總）待定。
- **`/me` / `/me/exam`**：`listGradesForStudentAssignment` 已用 assignment_id 過濾 → 新鍵下**自動修好**（不再漏題）；`/me` flat summary 的 Σ 也不再受撞鍵影響。
- **關鍵決策**：哨兵值選什麼；`problem_id`-only 查詢保不保留、語義為何。
- **依賴**：無。其餘子專案都 depend on 它。

### P2 — dsjudge：確保每 (assignment, problem) 各推一列

- 已送 `assignment_id`。變更主要是語義確認：同題在兩 assignment 各自 provision/判題 → 對 maccount 是**兩列**（新鍵下自然共存）。
- 純 lab / ungrouped 題：送哨兵或明確 assignment_id（= manifest id）以統一。
- `scoreboard.build` 已是 assignment 級，無需改。
- **依賴**：P1 的 ingest 合約（必填 assignment_id + 哨兵約定）。

### P3 — seminar-moodle：拉成績帶 assignment 維度

- `fetchOjGrades` + `/api/grades` 呼叫加 `assignment_id`（+ `course_id`）。
- 對應表升級：`config/oj-moodle.json`（assign）與 `oj-moodle-quiz.json`（quiz slot）的值從 `problem_id` → `{assignment_id, problem_id}`。
- **未決策（粒度）**，P1/P2 不受影響，留到 brainstorm P3 再定：
  - (a) 維持逐題：Moodle 一活動 = 一 (assignment, problem)，拉法只多帶 assignment_id 消歧義。
  - (b) 改 assignment 總分：Moodle 一活動 = 整個 assignment 加權總分（權威 = dsjudge manifest `points`/`total_points`），需 maccount/dsjudge 提供跨學生的 assignment 聚合、Moodle max grade 設 `total_points`。
- **依賴**：P1（route 參數）；若走 (b) 還要一個 assignment 聚合來源。

## 建議順序

1. **P1**（地基，且本身即資料正確性修復——不修 P1，同題跨 assignment 成績就是壞的）。
2. **P2**（對齊推送語義，量小）。
3. **P3**（消費端，順便定 (a)/(b) 粒度）。

每個子專案各自一份 spec→plan→實作，於各自 repo 的 branch。

## 遷移 / 風險備註

- P1 遷移**無 undo**、動 production D1 → 先 `--local` 演練、備份、寫 rollback。
- 哨兵值一旦定案即長期合約，三 repo 一致。
- 上線順序：P1 遷移 + route 向後相容（保留 problem_id-only）先出 → P2/P3 再切，避免破現有 `/api/grades` 呼叫。

## 進度

- [x] 跨 repo 拆解（本文件）
- [ ] P1 spec（maccount）— brainstorm 中
- [ ] P1 plan / 實作
- [ ] P2（dsjudge）
- [ ] P3（seminar-moodle）
