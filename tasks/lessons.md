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
