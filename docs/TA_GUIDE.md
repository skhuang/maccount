# 課程助教 / 授課老師 — maccount 使用說明(記分板 + Provisioning 遙控)

一頁看懂：在 maccount 上看**記分板**、遙控 dsjudge runner 做**部署 (provisioning)**，
全程在瀏覽器，不需 SSH 進評分機。私有測資永遠不會出現在這裡（只顯示分數、
判定、學生自己的 repo）。

## 誰能用
- 你必須是該課程的 **staff（助教）** 或 **owner（授課老師 / ADMIN）**。
- 入口：用 **NYCU 帳號**登入 → `https://<maccount>/c/<course_id>/admin`
  （例：`/c/ds-2026/admin`；助教只看得到自己被加入的課）。
- 加助教：owner 在同一頁的「助教」區塊，用助教的 **NYCU 學號**新增。

---

## 1. 記分板 / Scoreboard 📊（助教皆可）
路徑：`/c/<course_id>/admin` → **📊 記分板**。
1. 從下拉選單選一個**作業**。
2. 看到排名表：名次、學號、各題分數（點數字可到該生 repo）、總分。
3. 需要時按 **下載 CSV**。

排名為標準競賽制（同分同名次）；未提交者計 0。只顯示分數 / 判定 / 學生自己的
repo — 不含測資或 diff。

---

## 2. Provisioning 遙控 🚀（部署作業）
路徑：`/c/<course_id>/admin` → **🚀 Provisioning 遙控**。
每個作業一列，按按鈕即送出請求；runner 在後端執行後，下方「最近請求」會顯示
`queued → claimed → done` 與結果（**重新整理**看更新）。

| 按鈕 | 誰可用 | 作用 |
|---|---|---|
| **Plan (dry-run)** | 助教 | 預覽會建哪些 repo、對應哪些題。不動任何東西。 |
| **Status** | 助教 | 該作業各學生的成績狀態。 |
| **Create repos (APPLY)** | **僅 owner** | 真正建立每位學生的 repo（starter + 加協作者 + 上 /me）。**這步學生才看得到題目。** |
| **Push config** | **僅 owner** | 開啟評分：把 repo→題目對應 + 截止/限流寫進 course.yaml。 |

**建議部署順序（owner）：** 先 **Create repos (APPLY)** → 等 `done` → 再
**Push config**（先建 repo 再開評分，避免空 starter 被判 WA）。

**看懂結果：**
- `plan` → 會建的 repo 清單 + 對應。
- `repos_apply` → `counts`：`created`（新建）/ `exists`（已存在、冪等略過）/
  `error`（真失敗，附訊息）。
- `config` → `pushed` 幾筆對應寫入。

---

## 學生端（供你說明用）
學生登入 maccount `/me` → 該課程 → 點作業 repo 連結 → 在 GitHub `git clone` →
解題 → `git push` → 自動評分 → commit 狀態（✅/❌）+ 分數回到 `/me` 與記分板。
（考試則走專屬前端 oj-exam，另見考試文件。）

## 小提醒
- 「發布到題庫」是**內部**狀態，與學生無關；要學生看到題目一律靠
  **Provisioning → Create repos (APPLY)**。
- outside collaborator 的學生首次要**接受 GitHub 邀請 email** 才能 push。
- 一切遵守最小揭露：這些頁面只給老師 / 助教，且只顯示分數 + 判定 + repo。
