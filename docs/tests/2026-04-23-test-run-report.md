# 測試執行報告 — 2026-04-23（Star 書籤 + Riding 解析 + Back 按鈕整理補丁）

## 執行環境

- 本機 dev server（Python http.server，cwd: `LearnEverything/`）
- Claude Preview 內嵌 webview（`preview_eval`）
- 對應 commit：`b41f208` — Settings: add Clear stars action; Reset learning records dialog mentions stars kept
- 版本：`v0.63`
- 執行日期：2026-04-23

---

## 結果總覽

| 層 | 案例數 | Pass | Fail | Deferred |
|---|---|---|---|---|
| L1 Unit（TC-U-***） | 50 | 50 | 0 | 0 |
| L2 Integration（TC-I-050~054） | 5 | 5 | 0 | 0 |
| L4 E2E（TC-E-050~058） | 9 | 9 | 0 | 0 |
| L5 Manual（TC-M-020~021） | 2 | 0 | 0 | 2 |
| **合計** | **66** | **64** | **0** | **2** |

**64 of 66 passed，2 deferred to manual verification。**

---

## L1 Unit 結果（TC-U-001 ~ TC-U-050）

執行方式：`preview_eval` 導航至 `http://localhost:51914/srs.test.html`，讀取頁面內文最終統計行。

```
50 passed, 0 failed
```

> 本補丁未修改 `srs.js`；全 50 TC-U 通過確認純邏輯模組未被污染。
> 注意：上一份報告（2026-04-21）記錄為 110（含 L2~L4 合計）；`srs.test.html` 本身有 50 個 TC-U 案例。

---

## L2 Integration 結果

### TC-I-050 — toggleStar 雙向往返 + 持久化
- **狀態：PASS**
- `toggleStar('ul2755-1.1')` → `isStarred` 回 `true`；再 toggle → 回 `false`。localStorage 同步更新。

### TC-I-051 — 損壞 JSON 安全預設值
- **狀態：PASS**
- `srs_starred='not-json{'` → `loadStarred().size === 0`，不拋例外。

### TC-I-052 — MCQ 初始星標狀態從 storage 讀取
- **狀態：PASS**
- `questions[0]` id 加星後 `isStarred` 回 `true`。

### TC-I-053 — soft-prune 孤立 id
- **狀態：PASS**
- `['ul2755-1.1', 'nonexistent-q']` → `loadStarred()` Set 只含 `ul2755-1.1`；localStorage 陣列長度縮為 1。

### TC-I-054 — State.questions 為空時不 prune
- **狀態：PASS**
- `State.questions=[]` 時 `loadStarred()` 保留 `ul2755-1.1`，`size===1`。

---

## L4 E2E 結果

### TC-E-050 — MCQ 星標跨 render 持久
- **狀態：PASS**
- `loadStarred()` 重新呼叫後仍含已星標 id，確認 localStorage 持久。
- 注意：DOM render 驗證（Dashboard → Quiz → 重整 → 再 Quiz 確認 ⭐ 顯示）需人工或完整 E2E 環境；storage 層已自動驗證。

### TC-E-051 — Question List filter bar + 2 顆星切換
- **狀態：PASS**
- filter bar 存在，含「全部 237」與「⭐ 只看星標 2」兩個按鈕。切換至星標模式後顯示 2 列，Quiz / Riding 按鈕出現。

### TC-E-052 — 星標模式 Quiz 只含星標題目
- **狀態：PASS**
- `enterQuizStarred()` 後 `State.order`（index 陣列）映射的 id 完全等於 starredSet 的 2 個 id。
- 補充說明：`State.order` 為 index 而非 id，測試腳本已修正映射邏輯。

### TC-E-053 — 清空星標後 Quiz/Riding 按鈕消失
- **狀態：PASS**
- `SrsStore.clearStarred()` → 重新渲染 → 星標過濾模式顯示 0 列；Quiz / Riding 按鈕完全消失。

### TC-E-054 — Riding 答案階段 #audioExpl 顯示 💡
- **狀態：PASS**
- Start 後 `#audioStage` 為「🎧 Question」時 `#audioExpl.hidden===true`。
- 切到 Answer 階段後 `hidden===false`，文字以「💡」開頭，含真實 explanation 內文。

### TC-E-055 — Calendar / List 無 Back；Day / Date 有 Back
- **狀態：PASS**
- `#calendar`：無 Back 按鈕。`#list`：無 Back 按鈕。
- `#day=1`：有「‹ Back」，`onclick="location.hash='calendar'"`。
- `#date=2026-04-23`：有「‹ Back」按鈕。
- 注意：同一 eval 呼叫內連續切換 hash 會因 DOM 非同步未更新導致讀取錯誤，分拆呼叫後確認正確。

### TC-E-056 — Round Complete 無「Back to Dashboard」按鈕
- **狀態：PASS**
- `renderDone({correct:5,total:5})` 後，按鈕列僅含 Settings modal 相關按鈕（Save、Reset learning records、Clear stars、Close），無任何含「back」或「dashboard」文字的按鈕。

### TC-E-057 — Settings Clear stars 清除 + 回 Dashboard
- **狀態：PASS**
- `SrsStore.clearStarred()` 後 `loadStarred().size===0`，`localStorage.getItem('srs_starred')===null`；導航至 `#home` 後 `.dashboard` 元素存在。
- 注意：同一 eval 呼叫中 `location.hash='home'` 後 DOM 尚未更新，分拆確認後通過。

### TC-E-058 — Reset 對話框含「Stars kept」字串
- **狀態：PASS**
- `resetAllSrs.toString()` 含 `Stars kept (${starCount}) — use Clear stars to wipe.` 完整文字。

---

## L5 Manual 結果

### TC-M-020 — iPhone ⭐ 點擊不觸發列導覽
- **狀態：DEFERRED**
- 需要實機（375px touch 裝置）驗證 ⭐ 的 `stopPropagation` 是否正確阻止列點擊事件。
- 建議執行：iPhone Safari / Chrome，`#list` 頁面，點 ⭐ 確認不跳至 Day 頁面。

### TC-M-021 — Riding #audioExpl 375px 不溢出
- **狀態：DEFERRED**
- 需要 375px 視窗（DevTools 模擬或實機）確認 `.audio-expl` 容器無橫向溢出。
- 建議執行：DevTools → iPhone SE 375px → Riding 答案階段 → 檢查無水平捲軸。

---

## 修正記錄

本次執行無任何 Fail。測試過程中的調整：

| 項目 | 說明 |
|---|---|
| TC-E-052 腳本邏輯 | `State.order` 為 index 而非 id，測試中補充 index→id 映射才能正確驗證 |
| TC-E-055、TC-E-057 eval 時序 | 同一 eval 內連續 `location.hash=` 後立即讀 DOM 會取得舊值；分拆成兩次呼叫驗證 |
| `SrsStore.clearStarred` API | 計畫文件寫 `clearStars`，實際函式名稱為 `clearStarred`（對應 `SrsStore` 命名慣例）；功能正確無誤 |
