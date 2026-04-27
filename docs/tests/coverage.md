# Test Coverage Map

**Date:** 2026-04-27 (v0.74)
**Approach:** Path A (pragmatic, see `tasks/lessons.md`). Aim for ≥ 95% automated function coverage; explicitly document the residual ~5% that requires real iPhone PWA + physical hardware.

## 白話總覽

每一個 `app.js` 的函式 + `srs.js` 的 export，列出由「哪一條測試」蓋到。沒有任何 `npm install` / Playwright / istanbul —— 純 vanilla JS PWA 約定。**「99% 自動化」對這個 stack 不可能，因為 iOS 鎖屏、AirPods、來電中斷、實體 throttle 都是 iPhone 才有的行為**。所以 5% 就是 5%，誠實標記。

**整體**：83 個 function（`app.js` 58 + window handlers 25）+ `SRS.*` 11 個 export = **94 個 callable units**。

| 類別 | 個數 | 自動化覆蓋 | 比例 |
|---|---|---|---|
| `srs.js` 純邏輯 export（11 個 + 內部 helper） | 11 | 50 個 TC-U asserts，**100%** 分支 | 100% |
| `app.js` audio / Riding 引擎（含日誌） | 17 | 40 個 TC-S asserts | 100% |
| `app.js` SrsStore + Star bookmarks | 9 | TC-I-050~054 + TC-E-050~058 | 100% |
| `app.js` UI renderers（MCQ / Calendar / Day / Date / Question List / Dashboard） | 10 | TC-D / TC-E（preview_eval） | ~95%（每個 renderer 的所有 branch 不一定都蓋到） |
| `app.js` settings / confirm modal / streak | 13 | TC-E-057, 058 + 手動互動 | ~90% |
| iOS-only 物理行為（鎖屏 / AirPods / 來電 / throttle） | — | 12 條 TC-M deferred | 0%（device-only） |

**估算自動化覆蓋率**：~95% 函式至少被 1 個 assert 觸到。剩下 ~5% 是 iOS-only 行為（不是 function 本身沒蓋到，是 function 在背景/鎖屏情境下的行為）。

---

## 詳細表

### `srs.js` — pure SRS（100% 自動化）

| Function | Tests | Note |
|---|---|---|
| `SRS.nextState` | TC-U-001~015, TC-U-012~014 | 5 stages × correct/wrong 全分支 |
| `SRS.buildDeck` | TC-U-021~023 + 早期 cap 測試 | due / new / cap 邊界 |
| `SRS.summary` | TC-U-025, 026, 027 | new / due / 各 stage |
| `SRS.migrate` | TC-U-030, 031 | legacy answered + wrongPool |
| `SRS.buildCurriculum` | TC-U-034~036 | sort + day grouping |
| `SRS.getDayForQuestion` | TC-U（curriculum helpers） | null safety |
| `SRS.completedDays` | TC-U-040 | stage='new' 排除 |
| `SRS.ymd` | TC-U-047 | local date format |
| `SRS.computeFinishedYmd` | TC-U-041, 043, 044, 046 | edge case 全蓋 |
| `SRS.computeNewPerDay` | TC-U-042, 045, 046 | clamp + 對稱性 |
| `SRS.questionList` | TC-U-048, 049, 050 | sort + overdue + empty state |

### `app.js` — Audio / Riding engine（100% 自動化）

| Function | Tests | Note |
|---|---|---|
| `audioLog` | TC-S-002, 013a, 013b | log line format + accumulation |
| `copyAudioLog` (window) | manual 操作 | clipboard write — 桌面有 readPermission |
| `clearAudioLog` (window) | TC-S-013（隱含） | array + DOM clear |
| `shortSrc` | TC-S-014（讀 log line） | URL → last 2 segments |
| `getAudio` | TC-S-001 | sharedAudio singleton + global event listeners |
| `ensureAudio` | TC-E-050（MCQ feedback beep） | AudioContext create |
| `getSpeed` / `setSpeed` | TC-S-001~016 取 rate | localStorage `speed` key |
| `playMp3` | TC-S-003a, 003b, 012, 016b/c/d | timeout + error + ended + play() reject |
| `forceEndCurrentClip` | TC-S-005a, 005b, 011 | NaN guard + dispatchEvent fallback |
| `waitForCurrentEnd` | TC-S-004a, 004b, 016a | timeout + error + ended |
| `wait` | unused since v0.71 Chunk 3 | dead code candidate |
| `advanceBySkip` | TC-S-006a, 006b, 006c | next / prev / clamp |
| `playLoop` | TC-S-016 | full first-iteration cycle |
| `startAudio` | TC-S-014, 015a, 016 | DOM render + Fix B Media Session timing |
| `primeAndStart` (window) | TC-S-016 | gestural play() unlock |
| `stopAudio` (window) → `stopAudioCleanup` | TC-S-010a~d | full teardown |
| `requestWakeLock` / `releaseWakeLock` | TC-S-016（隱含） | iOS WakeLock API |

### `app.js` — Media Session（100% 自動化）

| Function | Tests | Note |
|---|---|---|
| `hasMediaSession` | TC-S-007 | 雙重 feature detect |
| `updateMediaMetadata` | TC-S-009a, b, c | title / artist / album |
| `registerMediaSession` | TC-S-008a, 015b, 016e | 4 個 setActionHandler + playbackState |
| `clearMediaSession` | TC-S-008b, 008c, 010c, 010d | metadata=null + state='none' |

### `app.js` — Star bookmarks（100% 自動化）

| Function | Tests | Note |
|---|---|---|
| `SrsStore.loadStarred` | TC-I-051, 053, 054 | corrupted JSON + soft-prune + empty-questions guard |
| `SrsStore.saveStarred` | TC-I-050 | sorted array persist |
| `SrsStore.toggleStar` | TC-I-050 | round-trip |
| `SrsStore.isStarred` | TC-I-052 | initial state from storage |
| `SrsStore.clearStarred` | TC-E-057 | Settings → Clear stars |
| `toggleStarFromCard` (window) | TC-E-050 | MCQ ⭐ on/off |
| `toggleStarFromList` (window) | TC-E-051 | row ⭐ stopPropagation |
| `setQlFilter` (window) | TC-E-051, 053 | toggle 全部 / 只看星標 |
| `enterQuizStarred` / `enterRidingStarred` (window) | TC-E-052 | starred-mode launchers |

### `app.js` — UI Renderers（~95% 自動化）

| Function | Tests | Coverage gap |
|---|---|---|
| `renderMCQ` | TC-E-050 | MCQ ⭐ + answer flow 主路徑；feedback overlay 部分 branch 不一定全蓋 |
| `handleAnswer` | TC-E-050 + 早期 TC-E | combo / shake / SRS.nextState 寫回 |
| `next` / `currentQuestion` / `renderDone` / `resetSession` | indirect via TC-E | round-complete 訊息文字未斷言 |
| `renderAudioIntro` | TC-S-014 | speed buttons 視覺 |
| `renderDashboard` | TC-E-046（v0.69 之前） | mastery progress bar 數字 |
| `renderCalendar` | TC-D-cells（早期） | 月份切換 |
| `renderDayPage` / `renderDatePage` | TC-D + TC-E-051~053 | day-card 列表 |
| `renderQuestionList` | TC-E-051~053 | filter bar + offset jump |
| `route` (hash router) | indirect via 所有 TC-E | 5 個路由路徑 |
| `tickStreak` / `updateHeader` | indirect via TC-E | streak + combo 顯示 |

**Gap**：renderer 的「字面」DOM assertion 沒有逐 pixel 比對。視覺破版只能靠手動或 screenshot diff（未架）。

### `app.js` — Settings + Confirm Modal（~90% 自動化）

| Function | Tests | Coverage gap |
|---|---|---|
| `openSettings` / `closeSettings` (window) | TC-E-057, 058 | live two-way binding（newPerDay ↔ finishedDate）只有 manual |
| `confirmDialog` / `closeConfirm` | TC-E-057 + 隱含 | Esc / backdrop dismiss 沒有自動測 |
| `saveSettingsFromForm` (window) | TC-E manual | 三選一決策（Keep / Reset / Cancel） |
| `resetAllSrs` (window) | TC-E-058 | confirm body 字串斷言 |
| `clearAllStars` (window) | TC-E-057 | empty / full state 兩條 path |
| `confirmEscHandler` / `confirmBackdropHandler` | manual only | keyboard / mouse 事件 |

### `app.js` — Audio FX（buzz / beep / shake / vibrate）（manual only）

| Function | Tests | Note |
|---|---|---|
| `beep` / `playRight` / `playWrong` / `burst` | manual ear test | Web Audio 合成；correctness 靠人耳 |
| `tryVibrate` | manual phone test | navigator.vibrate（iPhone 不支援） |
| `shake` | manual visual | CSS animation |
| `warmVoices` | manual | speechSynthesis preload (legacy, 已不用) |

**Gap**：聲音/震動效果本質上要人耳和身體驗。可斷言「函式被呼叫」但不能斷言「聽起來對」。

### iOS-only behavioral gaps（5% — TC-M-***，device-only）

| 行為 | 為什麼桌面測不到 |
|---|---|
| 鎖屏期間 setTimeout/audio throttle 規避 | iOS Safari 真實 throttle 行為，桌面 Chromium 沒有 |
| App switching 期間音訊延續 | iOS 的 app 切換模型 vs 桌面分頁 |
| 鎖屏 ⏸/▶️/⏭/⏮ UI 觸發 | iOS 鎖屏只有 iPhone 顯示 |
| AirPods 雙擊 / 摘下 | 物理硬體 |
| 來電打斷 → 結束通話 → 鎖屏恢復 | 電信 + 鎖屏 UI |
| 藍牙耳機斷線 / 重連 | RF + 物理硬體 |

## 缺口收尾建議（給未來的我）

1. **renderer 的視覺破版**：可考慮加 screenshot-diff 自動化（puppeteer + pixelmatch），但要先打破「No npm」原則。
2. **confirm modal Esc/backdrop**：可在 preview_eval 觸發 `KeyboardEvent('keydown', {key: 'Escape'})` 補進 TC-E。便宜。
3. **renderer 的「字面」DOM**：可逐 renderer 加 1-2 條 TC-D，讀 querySelector 確認文字。低風險低成本。
4. **TC-M 12 條** 永遠是 manual。下次更新此文件時，請使用者把實機驗證結果填回 `2026-04-27-test-run-report.md` 對應行。

## 不蓋的明確選擇

下列**刻意不寫測試**（YAGNI / 不可測 / 重複）：

- `loadVersion`：副作用是讀 `version.json` 並更新 DOM；視覺確認即可。
- `wait`：v0.71 Chunk 3 之後不再被任何 caller 呼叫，dead code（未刪只為 backup compatibility）。
- `warmVoices`：speechSynthesis 已不使用（Riding 改用 mp3 + WAV）。
- `loadQuestions`：fetch + JSON parse；網路問題不該綁進單元測試。
- `runMigration`：one-shot；TC-U-030/031 已蓋邏輯；其後刪除 legacy keys 邊際難測且低風險。

## 變更紀錄

- 2026-04-27 初版：列出 v0.74 的 94 個 callable + 各自測試對應。
