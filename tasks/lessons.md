# Lessons

## 2026-04-26: Riding 第一題 q.mp3 卡死（v0.71 後）

**症狀**：iPhone PWA 進 Riding 第一題卡在 `🎧 Question` 不動。

**根因**：
1. `waitForCurrentEnd()`（playLoop 第一題用的等待函式）只監聽 `'ended'` 事件，沒有 `'error'`、也沒有 timeout。任何讓 `ended` 不觸發的情況都會讓迴圈永久 hang。
2. v0.71 的 Chunk 4 在 `startAudio` 同步鏈裡呼叫 `registerMediaSession()` + `updateMediaMetadata()`。這發生在 `primeAndStart` 的 gestural `play()` 之後、第一個 await 之前。**iOS Safari 在這個關鍵期被設定 MediaSession 會壓住第一個 audio 的 `ended` 事件**。

**修法**：
- Fix A（防線）：`waitForCurrentEnd` 新增 `error` listener + 30 秒 safety timeout。即便 `ended` 沒觸發，至少不會永久卡死。
- Fix B（根因）：把 `registerMediaSession()` + 第一次 `updateMediaMetadata()` 從 `startAudio` 同步鏈搬到 playLoop 第一題 `await waitForCurrentEnd()` 之後。playLoop 內每題開頭的 `updateMediaMetadata(q)` 也用 `if (!first)` gate，避免第一題在同步鏈裡碰 MediaSession。

**規則**（內化）：
- **Pattern**: 任何 Promise 等待外部事件，永遠至少要監聽「成功」+「錯誤」兩個 path，並且加 timeout safety net。沒有 timeout = 隨機環境問題會變成永久死鎖。
- **iOS audio gotcha**: 不要在 gestural `play()` 之後、audio 真正 `'playing'` 之前的同步鏈裡呼叫 `mediaSession.metadata = ...` 或 `setActionHandler`。延遲到第一段 audio 已經跑完再設。
- **Chunk 4-style features 要在 spec review 補測**: spec 有寫 12 條 TC-M（手動 iPhone），但都 deferred。「deferred to manual」意味著回歸風險高，盡量在 push 前找到方法在桌面 simulate 至少一條（這次沒做到）。

## 2026-04-27: Riding 全部題目 1-2 秒切換、無聲音（v0.72 後）

**症狀**：iPhone PWA 進 Riding，每一題都只停留 1-2 秒就跳下一題、完全沒聲音。

**根因**：
v0.71 的 Chunk 1 由 subagent 用「純 Python」寫的 silence MP3（因為 sandbox 沒裝 ffmpeg），通過了 superficial 的 `0xFFFB` MPEG sync header 檢查，但**實際 frame data 不合法**。Chrome FFmpegDemuxer 拒絕它們：`DEMUXER_ERROR_COULD_NOT_OPEN: open context failed`，audio element fire `error` event with code=4。playMp3 的 error path 立刻 resolve，loop 一路衝過 q→sil-10→opts→sil-50→ans→sil-12 全部 instant resolve = 1-2 秒一題，零聲音。

**修法**：
- 改用 8-bit unsigned PCM WAV（pure Python struct，universally decodable，不需要 codec）。
- sw.js 接受 `.wav` 為 audio + bump CACHE 到 v20（強制 client 重抓）。
- playMp3 補 30s safety timeout（與 waitForCurrentEnd 同款）。
- 加入 on-screen log panel：每個 audio event、MediaSession action、playLoop iteration、waitForCurrentEnd outcome 都帶時間戳印在卡片內，使用者可一鍵 copy。

**規則**（內化）：
- **任何「合法 header 但 codec 不接受」的二進位資產，必須在 push 前實機（或 chromium）跑過至少一個 audio event check**。0xFFFB sync 通過 ≠ 能播。
- **Sandbox/CI 缺工具時要嚴重警告，別 silently fall back 到「我自己寫一個」**。subagent 的「純 Python 生成合法 MPEG1 Layer3」是 false confidence；應該回報 `STATUS: BLOCKED, install ffmpeg first`。
- **錯誤路徑也要 timeout**：playMp3 的 `error` event 立刻 resolve 看起來合理，但如果 100% 觸發（如本案），就等於 disabled 整個 loop 的時間結構。`finish('error')` 之外，還是要有 `finish('timeout-30s')` 保底，這樣下次類似錯誤 stage 會慢慢過、log 也會留下證據。
- **Diagnostic log 要 in-app**：DevTools 對 iPhone PWA 不友善（要 Mac + USB cable）。把日誌印在卡片內 + copy button，是 mobile PWA 的標配診斷工具。下次新增 audio/network/storage 路徑時優先做。

## 2026-04-27: 寫 TC-S 模擬測試時，synthetic `Event('error')` 在 media element 上不可靠

**情境**：寫 TC-S-012 想驗證 `waitForCurrentEnd` 在 audio `error` 時會 resolve，初版用 `dispatchEvent(new Event('error'))` 模擬。

**症狀**：
- `resolveTime` 預期 < 500ms，實測 996ms
- 多次重跑，有時根本不觸發 listener
- 不同瀏覽器版本行為不一致

**根因**：
HTMLMediaElement 的 `error` event 在規格上跟 `MediaError` object 綁定（`a.error.code`）。手寫 `new Event('error')` 沒有 `MediaError`，瀏覽器內部對 media element 的 error 觸發判斷可能會 short-circuit 掉「沒有 MediaError 物件」的合成事件。Chrome 對此處理特別嚴格。

**修法**：改用真實 404 URL（`audio/_silence/does-not-exist-${Date.now()}.wav`）。瀏覽器自然觸發 real `error` event with `MediaError code=4`，318ms 內 resolve。

**規則**（內化）：
- **驗 audio event handler 用真實環境**：不要假事件、不要 mock 太深。404 URL / 故意壞掉的檔案 / 故意斷網才能觸發瀏覽器真實 error path。
- **Synthetic event 適用場景有限**：純 DOM event（click、keydown、custom event）合成 OK；media element / network / storage 之類 host object 的 event 走真實路徑比較穩。
- **第一版測試不過要先懷疑測試本身**：996ms 不符預期時，先看是否「測試框架對 SUT 的假設錯了」，而非急著改 SUT。

## 2026-04-27: 覆蓋率「99% 自動化」對這個 stack 不可能 — Path A vs Path B 的誠實版

**情境**：使用者要求「測試覆蓋率提升至 99%」。

**根因**：
1. 真實 iOS 行為（鎖屏 throttle、AirPods 雙擊、來電中斷、Bluetooth 物理斷線）desktop Chromium **永遠**測不到。
2. Vanilla JS PWA 沒有 npm/Node/Playwright/c8/istanbul，要拿到「99% 行覆蓋率」這個數字，需要架整套 headless Chromium + instrumentation pipeline。
3. 架那套 = 違反 CLAUDE.md「No bundler, no npm」基本原則。

**面對的選擇**：
- **Path A（採用）**：誠實版「~95% 自動化函式級覆蓋 + 5% 明確標記為 device-only TC-M」。寫 `docs/tests/coverage.md` 列出 94 個 callable unit 對應哪條 test。Manual 12 條保留為「等使用者實機驗」。
- **Path B（拒絕）**：硬上 npm + Playwright 達 99%，但破壞專案結構約定 + 拉長首次 setup + 增加維護成本。

**規則**（內化）：
- **Coverage theatre vs honest gap**：寫「99%」騙自己很容易，標記「5% device-only 為什麼測不到」更有價值。下次有人問覆蓋率，誠實列出無法自動化的範圍 + 為什麼，比追表面數字重要。
- **不要為了測試破壞專案核心約定**：UL2755 quiz CLAUDE.md 明寫「No bundler, no npm」。Coverage 這種 nice-to-have 不該讓我們突破這條線，除非使用者明確同意承擔代價。
- **TC-S simulated 路線**：把 device-only 的「行為斷言」拆成兩半 — 桌面能驗的 internal state（metadata 設定、handler 註冊、playLoop 進度）寫成 TC-S；真機才有意義的（實際鎖屏、實體按鈕）保留 TC-M。這樣覆蓋的層次清楚。

## 2026-04-27: `preview_eval` 有 30 秒 hard timeout

**情境**：寫 TC-S-016 模擬完整 Riding cycle（27 秒），單一 eval 內等到 sil-12 結束才回傳，被 preview_eval 30s timeout 切斷。

**症狀**：
```
Eval timed out after 30s. The preview window may be stuck (modal dialog, navigation hang, or unresponsive renderer).
```

**根因**：`mcp__Claude_Preview__preview_eval` tool 強制 30s ceiling，超過就 abort。長任務不能在單次 eval 內完成。

**修法**：
- 把長測試拆成 N 個 eval call：第一個 kick off 動作（呼叫 `primeAndStart()` 等）+ 立刻回傳。後續 eval call **讀 `AUDIO_LOG[]` / `State.idx` / `sharedAudio` state** 來判斷進度。
- 結合 polling pattern：每 500ms 檢查一次某個終態 marker（如 `playMp3 done: ended (_silence/sil-12.wav)` 出現在 log 裡），最多等 45 秒。

**規則**（內化）：
- **長任務切分 + state-based polling**：preview_eval（和類似 RPC 工具）通常都有 timeout。寫測試時把「動作」和「驗證」分開兩個 eval，動作回傳後立刻退出，驗證讀全域狀態。
- **AUDIO_LOG 是終態 marker 的好來源**：在 app 內已存的 ring buffer 拿來當測試輔助 doubly useful — 既給使用者診斷、也給自動化測試讀進度。
- **不靠 setTimeout 在 eval 內等久**：如果你發現自己在 eval 內 `await new Promise(r => setTimeout(r, 30000))`，那就是設計錯了，要拆成多 eval。
