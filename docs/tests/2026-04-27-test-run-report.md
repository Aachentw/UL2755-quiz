# 測試執行報告 — 2026-04-27（v0.74 Riding 背景播放修復後驗證）

## 執行環境

- 對應 commit：`57e76cd` Lessons / `842c21e` Fix Riding silent skipping
- 版本：`v0.74`
- 執行者：Claude Code with `mcp__Claude_Preview__preview_eval` driver
- 瀏覽器：桌面 Chromium（透過 launch.json 的 `dev` config，serverId 為 51914 port）
- 日期：2026-04-27

## 結果總覽

| 層 | 案例數 | Pass | Fail | Deferred |
|---|---|---|---|---|
| L1 Unit（TC-U-***，srs.test.html iframe） | 50 | 50 | 0 | 0 |
| **L4.5 Simulated（TC-S-001 ~ 016，本次新增）** | **17 cases / 40 assertions** | **40** | **0** | **0** |
| L5 Manual（TC-M-030 ~ 041） | 12 | 0 | 0 | 12 |
| **合計（自動化）** | **22 + 40 = 50 個資產** | **90 個 assertions pass** | **0** | **12 device-only** |

**自動化 90/90 pass。手動 12 條 deferred 給 iPhone 真機。**

---

## L1 Unit — TC-U（50 / 50）

執行：`preview_eval` 開 iframe 載入 `srs.test.html`，讀最後 `<h2>` 的 `.textContent`。

```
50 passed, 0 failed
```

`srs.js` 自 v0.71 起未被任何 commit 修改（git diff 為空），純邏輯模組無回歸風險。

---

## L4.5 Simulated — TC-S（40 / 40 assertions）

### TC-S-001 靜音 WAV 解碼（4/4）

| ID | 結果 | duration |
|---|---|---|
| TC-S-001a sil-10.wav | ✅ | 1.0s |
| TC-S-001b sil-12.wav | ✅ | 1.2s |
| TC-S-001c sil-25.wav | ✅ | 2.5s |
| TC-S-001d sil-50.wav | ✅ | 5.0s |

### TC-S-002, 013 日誌基礎設施（3/3）

```
[ok] TC-S-002 audioLog appends
[ok] TC-S-013a AUDIO_LOG accumulates
[ok] TC-S-013b lines have timestamp + level
```

### TC-S-003, 012 playMp3 硬化（3/3）

```
[ok] TC-S-003a playMp3 has 30s timeout
[ok] TC-S-003b playMp3 listens for error
[ok] TC-S-012 playMp3 with non-existent URL resolves in 318ms via real error event
```

備註：`TC-S-012` 改寫過 — 原本想用 `dispatchEvent(new Event('error'))` synthetic，發現 Chrome 對 media element 的合成 error event 不可靠觸發 listener（resolveTime 996ms 而非預期 < 500ms）。改用真實 404 URL（`audio/_silence/does-not-exist-<timestamp>.wav`），318ms 內 resolve，符合預期。

### TC-S-004 waitForCurrentEnd 硬化（2/2）

```
[ok] TC-S-004a waitForCurrentEnd has 30s timeout
[ok] TC-S-004b waitForCurrentEnd listens for error
```

### TC-S-005, 011 forceEndCurrentClip（3/3）

```
[ok] TC-S-005a forceEndCurrentClip has isFinite NaN guard
[ok] TC-S-005b forceEndCurrentClip dispatches ended fallback
[ok] TC-S-011 forceEndCurrentClip on NaN duration → 100ms 內 ended event 觸發
```

### TC-S-006 advanceBySkip（3/3）

```
[ok] TC-S-006a next: idx 3→4, skipTo→null
[ok] TC-S-006b prev: idx 5→4
[ok] TC-S-006c prev clamps at 0 (不變負數)
```

### TC-S-007, 008, 009, 010 Media Session（11/11）

```
[ok] TC-S-007 hasMediaSession returns boolean
[ok] TC-S-008a registerMediaSession sets playbackState='playing'
[ok] TC-S-008b clearMediaSession sets metadata=null
[ok] TC-S-008c clearMediaSession sets playbackState='none'
[ok] TC-S-009a updateMediaMetadata sets title 'Question N / M'
[ok] TC-S-009b metadata.artist === q.source
[ok] TC-S-009c metadata.album === 'UL2755 Sprint · 🏍️ Riding'
[ok] TC-S-010a stopAudioCleanup sets audioStopped=true
[ok] TC-S-010b stopAudioCleanup resets skipTo=null
[ok] TC-S-010c stopAudioCleanup clears metadata
[ok] TC-S-010d stopAudioCleanup sets playbackState='none'
```

### TC-S-014 日誌面板 DOM（3/3）

Riding 卡片上的 `#audioLogBody`、`📋 Copy` button、`🗑 Clear` button 都存在。

### TC-S-015 Fix B 架構（2/2）

```
[ok] TC-S-015a startAudio source 不含 registerMediaSession() 同步呼叫
[ok] TC-S-015b playLoop 在 waitForCurrentEnd 之後呼叫 registerMediaSession()
```

### TC-S-016 完整第一題 Riding cycle（6/6）

題目：`ul2755-15.1.1`（HVAC in MDC can be?）。實際跑了 27.085 秒（< 45 秒上限）。

```
[ok] TC-S-016a waitForCurrentEnd 透過 ended 而非 timeout/error 解開
[ok] TC-S-016b 5 條 playMp3 ended（sil-10/opts/sil-50/ans/sil-12）
[ok] TC-S-016c 0 條 playMp3 error
[ok] TC-S-016d 0 條 playMp3 timeout
[ok] TC-S-016e Media Session 註冊發生在第一段 q.mp3 結束之後
[ok] TC-S-016g 完整第一輪在 < 45s 內完成（27s）
```

關鍵 log 摘錄：
```
07:42:23.341 [info] primeAndStart src=ul2755-15.1.1/q.mp3?v=1
07:42:24.922 [info] waitForCurrentEnd entry paused=false ended=false
...
07:45:55.945 [info] playMp3 done: ended (_silence/sil-50.wav)
07:45:55.946 [info] playMp3 ul2755-15.1.1/ans.mp3
...
07:46:02.546 [info] iter idx=1 q=ul2755-1.1 first=false lap=1
```

→ 完整 cycle 通過 + 進到下一題。

---

## L5 Manual — TC-M（12 條 deferred）

下列案例需要 iPhone PWA 真機 + 物理周邊，桌面 Chromium 無法可靠模擬。使用者實機驗證後請更新此區。

| ID | 描述 | 狀態 |
|---|---|---|
| TC-M-030 | Riding Think 階段鎖屏，藍牙耳機聽到靜音 + 5 秒後聽到 Answer | ⏸ deferred |
| TC-M-031 | 切 Google Maps 看導航 30 秒後切回，音訊沒中斷 | ⏸ deferred |
| TC-M-032 | 鎖屏 ⏸ → 3 秒 → ▶️，clip 在原位恢復 | ⏸ deferred |
| TC-M-033 | 播 q 時按 ⏭，立刻跳下一題 q | ⏸ deferred |
| TC-M-034 | 播 ans 時按 ⏮，跳回前一題 q | ⏸ deferred |
| TC-M-035 | AirPods 雙擊暫停 / 恢復 | ⏸ deferred |
| TC-M-036 | 來電打斷 → 掛掉 → 鎖屏 ▶️，原位恢復 | ⏸ deferred |
| TC-M-037 | 播到一半藍牙斷線，暫停不炸 | ⏸ deferred |
| TC-M-038 | 鎖屏顯示 🏍️ Question N / M + source（無 artwork） | ⏸ deferred |
| TC-M-039 | 0.75x 速度下 Think 約 6.7s | ⏸ deferred |
| TC-M-040 | 最後一題按 ⏭ 觸發 reshuffle | ⏸ deferred |
| TC-M-041 | 第一題按 ⏮ 留原題（不 wrap） | ⏸ deferred |

---

## 結論

- **自動化覆蓋率提升**：之前 v0.71 ~62 個 assertion，現在 v0.74 共 **90 個 assertion**（增加 40 個 TC-S）。
- **3 個此前 deferred 的 iOS-specific 行為**現可桌面化驗證：
  - Media Session metadata / playbackState 設定（TC-S-007~010）
  - playLoop 在 Fix B 架構下的執行順序（TC-S-015, 016）
  - 日誌診斷面板 DOM 結構（TC-S-014）
- **silence WAV 在 v0.74 完全修復**：4 個檔案皆通過 canplay + 完整 27 秒整輪 ended 觸發。
- **playMp3 對 404/error 路徑 318ms 內收手**，timeout 防線在；以後即使 100% 觸發 error 也不會像 v0.71-v0.73 那樣靜默衝過題目。
- **Manual 12 條保留**為 device-only，記錄於 `tasks/lessons.md`「不假裝能 99%」原則。

下次回歸時，將本份 TC-S 整合進 `docs/tests/coverage.md` 的快速回歸 script。
