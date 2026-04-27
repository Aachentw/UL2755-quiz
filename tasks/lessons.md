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

