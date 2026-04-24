# 測試執行報告 — 2026-04-24（Riding 背景播放 + 鎖屏 Media Session 控制）

## 執行環境

- 本機 dev server（Python http.server，port 51914）
- Claude Preview 內嵌 webview（`preview_eval`）
- 對應最新 commit：`490e529` — Media Session: register lock-screen title + play/pause/prev/next handlers
- 版本：`v0.70`
- 執行日期：2026-04-24

---

## 結果總覽

| 層 | 案例數 | Pass | Fail | Deferred |
|---|---|---|---|---|
| L1 Unit（TC-U-001~050） | 50 | 50 | 0 | 0 |
| L2 Integration（TC-I-060~062） | 3 | 3 | 0 | 0 |
| L4 E2E（TC-E-060~063） | 4 | 4 | 0 | 0 |
| L5 Manual（TC-M-030~041） | 12 | 0 | 0 | 12 |
| **合計** | **69** | **57** | **0** | **12** |

**57 of 69 passed，12 deferred to manual iPhone verification。**

---

## L1 Unit 結果（TC-U-001 ~ TC-U-050）

執行方式：`preview_eval` 導航至 `http://localhost:51914/srs.test.html`，讀取頁面最終統計行。

```
50 passed, 0 failed
```

> 本功能未修改 `srs.js`；全 50 TC-U 通過，確認純邏輯模組未被污染。

---

## L2 Integration 結果

### TC-I-060 — Media Session Feature detection
- **狀態：PASS**
- `'mediaSession' in navigator` 為 true；`typeof navigator.mediaSession.setActionHandler === 'function'` 為 true。
- `typeof has === 'boolean'` assert 通過。環境（Chrome in webview）完整支援 Media Session API。

### TC-I-061 — 四個靜音 MP3 可取得
- **狀態：PASS**
- `audio/_silence/sil-10.mp3`：HTTP 200 OK
- `audio/_silence/sil-12.mp3`：HTTP 200 OK
- `audio/_silence/sil-25.mp3`：HTTP 200 OK
- `audio/_silence/sil-50.mp3`：HTTP 200 OK
- 四個 HEAD 請求全數回傳 `response.ok === true`。

### TC-I-062 — `playMp3` 不再使用 `.onended =`
- **狀態：PASS**
- `String(playMp3).includes('addEventListener')` → true（assert a 通過）
- `!String(playMp3).includes('.onended =')` → true（assert b 通過）
- 確認 `playMp3` 已完全改用 `addEventListener('ended', onDone, {once:true})`。

---

## L4 E2E 結果

### TC-E-060 — Riding Start 後 Media Session metadata 含正確題號格式
- **狀態：PASS**
- `enterRiding()` → `primeAndStart()` → 等 800ms → `navigator.mediaSession.metadata`：
  - `title: "Question 1 / 10"` — 符合 `/Question \d+ \/ \d+/` 格式 ✓
  - `artist: "UL2755 §1.1"` — 正確帶入 `q.source` ✓
  - `album: "UL2755 Sprint · 🏍️ Riding"` ✓
  - `playbackState: "playing"` ✓

### TC-E-061 — Stop 後 Media Session 完整清空
- **狀態：PASS**
- `stopAudio()` 後等 300ms：
  - `navigator.mediaSession.metadata === null` ✓
  - `navigator.mediaSession.playbackState === 'none'` ✓
- `clearMediaSession()` 在 `stopAudioCleanup` 中正確執行。

### TC-E-062 — `advanceBySkip` 依 `State.skipTo` 正確移動 idx
- **狀態：PASS**
- `idx=3, skipTo='next'` → `idx===4, skipTo===null` ✓（next 正向進位）
- `idx=5, skipTo='prev'` → `idx===4` ✓（prev 倒退）
- `idx=0, skipTo='prev'` → `idx===0` ✓（邊界夾住，不 wrap 到負數）

### TC-E-063 — `playLoop` 使用靜音 MP3、不使用 `wait()`
- **狀態：PASS**
- `String(playLoop).includes('await wait(')` → false ✓（無 await wait 呼叫）
- `String(playLoop).includes('_silence/sil-')` → true ✓（已改用靜音 MP3）

---

## L5 Manual 結果（TC-M-030 ~ 041）

以下 12 條案例需要 iPhone 上已安裝的 PWA（加到主畫面）方能驗證，超出自動化測試範圍。

### TC-M-030 — Riding Think 鎖屏
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 iOS throttle 規避效果（靜音 MP3 填充後 5 秒 Think 不凍結）。

### TC-M-031 — 切 Google Maps 30 秒
- **狀態：DEFERRED** — 需 iPhone 實機。驗證背景切換時音訊連續性。

### TC-M-032 — 鎖屏 ⏸ → ▶️ 原位恢復
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 play/pause action handler 效果。

### TC-M-033 — 播 q 時按 ⏭ 跳下一題
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 nexttrack → `forceEndCurrentClip` → skipTo='next' 流程。

### TC-M-034 — 播 ans 時按 ⏮ 跳回前一題
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 previoustrack → skipTo='prev' 流程。

### TC-M-035 — AirPods 雙擊暫停 / 恢復
- **狀態：DEFERRED** — 需 AirPods + iPhone 實機。驗證藍牙 HID 按鈕映射至 Media Session pause/play。

### TC-M-036 — 來電打斷 → 掛斷 → ▶️ 恢復
- **狀態：DEFERRED** — 需 iPhone 實機 + 來電。

### TC-M-037 — 播放中藍牙斷線不炸
- **狀態：DEFERRED** — 需 iPhone + 藍牙耳機。

### TC-M-038 — 鎖屏顯示題號 + source
- **狀態：DEFERRED** — 需 iPhone 實機。驗證鎖屏 `Question X / N` + `UL2755 §X.X.X` 顯示正確。

### TC-M-039 — 0.75x 時 Think ≈ 6.7 秒
- **狀態：DEFERRED** — 需 iPhone 實機（或 DevTools Rendering 觀察）。

### TC-M-040 — 最後一題按 ⏭ 觸發 reshuffle
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 idx 越界 → reshuffle 不 crash。

### TC-M-041 — 第一題按 ⏮ 留在第一題
- **狀態：DEFERRED** — 需 iPhone 實機。驗證 idx=0 時 `Math.max(0, idx-1)` 夾住。

---

## 修正記錄

本次執行無任何 Fail。執行過程中無需修正。

| 項目 | 說明 |
|---|---|
| TC-E-061 `stopAudio` vs `stopAudioCleanup` | 測試腳本優先嘗試 `stopAudio`（window 暴露名稱），再 fallback `stopAudioCleanup`；兩者均存在且功能一致 |
| TC-E-060 metadata.title 計數 | 回傳 `"Question 1 / 10"` 反映 dev 環境今日到期題數（10 題）；格式符合規格，題號隨使用者進度不同而異 |
