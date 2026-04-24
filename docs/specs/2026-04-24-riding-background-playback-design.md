# Design: Riding Background Playback + Lock-Screen Controls

**Date:** 2026-04-24
**Status:** Draft, pending review
**Scope:** Make Riding mode audio keep playing when iPhone screen is locked or user switches to another app. Add lock-screen / Control Center / Bluetooth-headset media controls (play/pause, next/prev question).
**Out of scope:** Android-specific optimizations (the app is used on iPhone per the user's audit prep workflow), seek-within-clip, cloud sync of Riding progress.

---

## 白話總覽（給非工程師讀）

**為什麼要改**：目前 Riding 模式音訊是播一小段、停一下、再播下一段。iPhone 鎖屏或切換到 Google Maps 時，中間的「停一下」會被 iOS 凍結（從 5 秒變幾分鐘），整個朗讀就卡死。

**這版做什麼**：
1. 把「停一下」的 `setTimeout` 換成「播一段等長的靜音 MP3」—— 音訊元素從頭到尾永不靜止，iOS 就把這個 PWA 當音樂 app 對待，鎖屏/切 app 繼續播。
2. 加入鎖屏控制：iOS 鎖屏、控制中心、藍牙耳機、AirPods 上出現這個 app 的控制介面（⏮ ⏸/▶️ ⏭），看起來就像在聽 Spotify。
3. 鎖屏顯示 🏍️ 圖示 + `Question 3 / 15 · UL2755 §6.2.3`。

**使用者範例**：
騎車上班，啟動 Riding 模式後把手機放車架、鎖屏。藍牙耳機裡持續聽題目 → 選項 → 5 秒思考 → 答案（含解釋）→ 下一題。紅燈時開 Google Maps 看一下路線，切回時音訊沒中斷。AirPods 雙擊可暫停、再雙擊恢復。覺得「這題我會」就按耳機的下一首按鈕跳過。

---

## Goals

1. 鎖屏期間音訊不中斷（Think 5 秒、換一輪 2.5 秒等「間隔」全部正常播出，不被 iOS throttle 凍結）。
2. 切換到其他 app（Maps、WhatsApp、Safari 等）音訊繼續。
3. 鎖屏 / 控制中心 / 藍牙耳機 / AirPods 出現原生音訊控制面板：標題、封面、⏮ ⏸/▶️ ⏭ 四顆按鈕。
4. 不破壞既有變速（0.5x / 0.75x / 1x / 1.25x）功能。
5. 不更動既有 `audio/<id>/{q,opts,ans}.mp3` 資料結構。

**Non-goals**：
- seek-within-clip（倒轉 10 秒）：YAGNI；AirPods 沒這按鈕、motorcycle 手套也難操作。
- 跨裝置同步 Riding 進度。
- 讓 Safari 分頁（未「加到主畫面」）也能背景播放：iOS 限制太嚴，只支援已安裝 PWA 的情境。

---

## 1. 核心架構：靜音填充

### 1.1 問題根因

iOS Safari 在以下情境會把 JS `setTimeout` / `setInterval` throttle 到分鐘等級：
- 分頁進入背景（切 app）。
- 螢幕鎖定。
- 低電量模式下更激進。

目前 `playLoop`（`app.js:307-352`）有四個 `await wait(N)`：
- `wait(700)` — q 後、opts 前。
- `wait(5000)` — opts 後、ans 前（Think 階段）。
- `wait(1200)` — ans 後、下一題前。
- `wait(2500)` — deck 空、reshuffle 換一輪。

這些在前景正常；背景被 throttle 時迴圈凍結，音訊停下後過很久才繼續。

### 1.2 解法

**所有 `await wait(N)` 改成 `await playMp3('audio/_silence/sil-NN.mp3')`**。音訊元素從頭到尾永遠在播東西（實際在播或播靜音），iOS 視為音樂 app → 鎖屏/背景繼續。

### 1.3 新增靜音 MP3

存放於 `audio/_silence/`：

| 檔名 | 長度 | 用途 |
|---|---|---|
| `sil-10.mp3` | 1.0 秒 | q → opts 過渡（**拉到 1 秒**，避免 iOS throttle 安全線） |
| `sil-12.mp3` | 1.2 秒 | ans → 下一題 過渡 |
| `sil-25.mp3` | 2.5 秒 | deck 空 → reshuffle 換一輪 |
| `sil-50.mp3` | 5.0 秒 | Think 階段 |

**為什麼 q→opts 拉到 1 秒**：原本規劃 0.7 秒太短。iOS throttle 規避要求「音訊元素連續播放」，而每次 clip 切換（`src` swap）之間有幾十~幾百 ms 的 `loadstart` 延遲；若靜音本體太短、一旦網路抖動就會讓「有聲→無聲→有聲」的 gap 被 iOS 判定為「已停」。1 秒是安全底線。使用者感受差 0.3 秒幾乎無感。

**生成方式**（一次性）：用 ffmpeg CLI 或 Python `pydub`：

```bash
# ffmpeg（推薦，CI 友善）
mkdir -p audio/_silence
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1.0 -q:a 9 -acodec libmp3lame audio/_silence/sil-10.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1.2 -q:a 9 -acodec libmp3lame audio/_silence/sil-12.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 2.5 -q:a 9 -acodec libmp3lame audio/_silence/sil-25.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 5.0 -q:a 9 -acodec libmp3lame audio/_silence/sil-50.mp3 -y
```

或在 `generate_audio.py` 結尾加入 `pydub.AudioSegment.silent(...)` 段落（需要 ffmpeg 在 PATH）。

每檔案預估 2-5 KB，四個加總 < 20 KB。Commit 進 repo，和 question-level TTS 一起由 service worker cache。

### 1.4 變速副作用（刻意接受）

`playbackRate` 會同時作用於靜音 MP3。實際 Think 秒數依速度變動：

| 速度 | Think 實際秒數 | 意義 |
|---|---|---|
| 0.5x | 10.0 秒 | 慢速給更多思考時間 |
| 0.75x | 6.7 秒 | — |
| 1.0x | 5.0 秒 | 基準 |
| 1.25x | 4.0 秒 | 快速較短 |

使用者選慢速通常就是想慢慢聽慢慢想 → 此行為自然、不處理。

---

## 2. Media Session API 整合

### 2.1 鎖屏顯示

於 `startAudio()` 註冊 `navigator.mediaSession.metadata`：

```js
if ('mediaSession' in navigator && typeof navigator.mediaSession.setActionHandler === 'function') {
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Question ${State.idx + 1} / ${State.order.length}`,
      artist: q.source,                    // e.g. "UL2755 §6.2.3"
      album: 'UL2755 Sprint · 🏍️ Riding',
      // artwork omitted intentionally — see §2.1.1
    });
    navigator.mediaSession.playbackState = 'playing';
  } catch (_) { /* silent no-op if API subset not present */ }
}
```

**Feature detection 雙閘門**：第一關確認 `mediaSession` 存在，第二關確認 `setActionHandler` 是 function。某些舊 iOS 15 beta 或 WKWebView 有前者無後者；`try/catch` 外層兜底。

### 2.1.1 不使用 artwork（刻意）

原本規劃重用 `manifest.webmanifest` 的 🏍️ SVG data URL 作為 MediaMetadata artwork，但 **iOS Safari（到 iOS 17 為止）不接受 SVG data URL 作為 MediaMetadata 的 artwork**，鎖屏會顯示空白封面 —— 跟完全不設 artwork 視覺上一樣。

**決定**：MVP 不設 artwork。鎖屏會只顯示 title + artist（純文字），不顯示封面圖。使用者仍可辨識「這是 UL2755 Sprint 在播題目」。

**未來要上封面**：需要 commit 一張 `192x192` 或 `512x512` 的 PNG 到 repo（例如 `icon-192.png`），把 `artwork` 指向這個 raster 檔。這不屬於本版範圍；留待使用者覺得有需要時另開 task。

**更新時機**：
- 每次 `playLoop` 進入新題的「題目階段」時呼叫 `updateMediaMetadata(q)`，把 title 的題號和 source 更新。
- `stopAudioCleanup()` 時把 `metadata = null` + `playbackState = 'none'`。

### 2.2 控制按鈕（四顆）

| MediaSession action | 行為 |
|---|---|
| `play` | `sharedAudio.play()` + `playbackState = 'playing'`。若在 `pause` 狀態的 clip 中間，自然恢復。 |
| `pause` | `sharedAudio.pause()` + `playbackState = 'paused'`。JS 迴圈因 `ended` 未觸發而停在 `await` 上，不推進。 |
| `previoustrack` | 設 `State.skipTo = 'prev'` + 呼叫 `forceEndCurrentClip()`（見 §2.4）。 |
| `nexttrack` | 設 `State.skipTo = 'next'` + 同上。 |

**一律不註冊**：`stop`（與 pause 重疊）、`seekbackward` / `seekforward` / `seekto`（clip 邊界複雜度高；YAGNI）。

### 2.3 Pause / Play 為何「自然就行」

`playMp3` 的 promise 只在 `ended` 事件觸發時 resolve。`audio.pause()` 不觸發 `ended`，所以 JS 迴圈就停在該 `await` 上。`audio.play()` 繼續播，clip 結束時 `ended` 才觸發，promise 解開，迴圈繼續。**完全不需要額外 glue code**。

### 2.4 Prev / Next 的 skip 機制

在 `State` 上新增欄位 `skipTo: 'next' | 'prev' | null`，初始 null。

**強制結束當前 clip**（`forceEndCurrentClip` 輔助函式）：

```js
function forceEndCurrentClip() {
  const a = sharedAudio;
  if (!a) return;
  // 若 duration 為 NaN（src 剛 set、metadata 還沒 load），直接手動 dispatch ended：
  if (!isFinite(a.duration) || a.duration <= 0) {
    a.pause();
    a.dispatchEvent(new Event('ended'));
    return;
  }
  // 正常路徑：往前 0.05 秒確保觸發 ended（iOS Safari 對 -0.01 邊界偶爾不穩）。
  try {
    a.currentTime = Math.max(0, a.duration - 0.05);
  } catch (_) {
    // Safari 在 readyState < 1 時 setter 會 throw；fallback 到 manual dispatch。
    a.dispatchEvent(new Event('ended'));
  }
}
```

**`playMp3` 改用 `addEventListener` 而非 `.onended = ...`**（避免 handler 被下一個 `playMp3` 覆寫，導致 skip 的 `ended` resolve 到錯誤 promise）：

```js
function playMp3(url) {
  return new Promise((resolve) => {
    const a = getAudio();
    a.src = url;
    const applyRate = () => { a.playbackRate = getSpeed(); a.defaultPlaybackRate = getSpeed(); };
    a.onloadedmetadata = applyRate;
    a.onplay = applyRate;
    // Use addEventListener once — each playMp3 gets its own listener tied to its own promise.
    const onDone = () => { a.removeEventListener('ended', onDone); a.removeEventListener('error', onDone); resolve(); };
    a.addEventListener('ended', onDone, { once: true });
    a.addEventListener('error', onDone, { once: true });
    applyRate();
    const p = a.play();
    if (p && p.then) p.then(applyRate).catch(err => { console.warn('play() rejected:', err); onDone(); });
  });
}
```

這段是 `playMp3` 的**完整替換**，把原本的 `.onended` / `.onerror` / `.onloadedmetadata` 混用改成一致、僅 once 的 `addEventListener`，杜絕 skip race。

`playLoop` 每個 `await playMp3` 之後檢查：

```js
while (!State.audioStopped) {
  State.skipTo = null;
  const q = currentQuestion();
  updateMediaMetadata(q);
  showQuestion(q);

  await playMp3(`audio/${q.id}/q.mp3`);
  if (State.skipTo) { advanceBySkip(); continue; }

  await playMp3('audio/_silence/sil-10.mp3');
  if (State.skipTo) { advanceBySkip(); continue; }

  showOptions(q);
  await playMp3(`audio/${q.id}/opts.mp3`);
  if (State.skipTo) { advanceBySkip(); continue; }

  await playMp3('audio/_silence/sil-50.mp3');
  if (State.skipTo) { advanceBySkip(); continue; }

  showAnswer(q);
  if (expl) { expl.textContent = `💡 ${q.explanation}`; expl.hidden = false; }
  await playMp3(`audio/${q.id}/ans.mp3`);
  if (State.skipTo) { advanceBySkip(); continue; }

  await playMp3('audio/_silence/sil-12.mp3');
  if (State.skipTo) { advanceBySkip(); continue; }

  State.idx++;  // normal advance only reached when no skip
}

function advanceBySkip() {
  if (State.skipTo === 'next') State.idx++;
  else if (State.skipTo === 'prev') State.idx = Math.max(0, State.idx - 1);
  // (skipTo is reset at loop top)
}
```

**邊界**：在第一題按 ⏮ → idx 夾在 0（不 wrap）。最後一題按 ⏭ → idx 越界 → 觸發既有的 deck-empty reshuffle 流程。

---

## 3. 其他邊界情境

### 3.1 來電 / 藍牙斷線 / AirPods 拿下

- iOS 自動 pause 音訊元素（`audio.paused === true`）。
- 使用者接完電話或重連耳機 → 按鎖屏 ▶️ 或螢幕上 ▶️ → `sharedAudio.play()` 繼續。
- 不需特殊處理。

### 3.2 Stop 鍵（app 畫面內）

`stopAudioCleanup()` 除了既有的 `State.audioStopped = true` + `sharedAudio.pause()` + `releaseWakeLock()`，加上：

```js
if ('mediaSession' in navigator) {
  navigator.mediaSession.metadata = null;
  navigator.mediaSession.playbackState = 'none';
  ['play', 'pause', 'previoustrack', 'nexttrack'].forEach(a => {
    try { navigator.mediaSession.setActionHandler(a, null); } catch (_) {}
  });
}
```

### 3.3 Media Session 在非 Riding 頁面

`renderMCQ` / `renderDashboard` 等其他 renderer 呼叫 `stopAudioCleanup()` 時（它們已經有這行），Media Session 會一併清空。進 Riding intro 不註冊（只是設定頁面），按 Start → `startAudio` 才註冊。

### 3.4 重複觸發 pause / play（按太快）

`sharedAudio.pause()` / `.play()` 是 idempotent，連按沒事。`State.skipTo` 若已有值、又按同方向：第二次覆寫第一次無副作用；按反方向：最後一次生效。

---

## 4. 資料流圖

```
使用者點 Riding Start
       │
       ▼
primeAndStart() ─ 同步觸發 play()（iOS gesture 要求）
       │
       ▼
startAudio({firstAlreadyPlaying: true})
       │
       ├─► registerMediaSession(q)  ◄── 新增
       │        ├─ metadata 含題號 + source
       │        ├─ setActionHandler play / pause / prev / next
       │        └─ playbackState = 'playing'
       │
       ▼
playLoop()
  │
  ├─► [loop]
  │    ├─ updateMediaMetadata(q)  ◄── 換題時更新
  │    ├─ showQuestion + await playMp3(q.mp3)
  │    │     ↓ 若 skipTo 設 → advanceBySkip → continue
  │    ├─ await playMp3(sil-10.mp3)  ◄── 新（代替 wait 700，拉到 1s 避 throttle）
  │    ├─ showOptions + await playMp3(opts.mp3)
  │    ├─ await playMp3(sil-50.mp3)  ◄── 新（代替 wait 5000，Think）
  │    ├─ showAnswer + await playMp3(ans.mp3)
  │    ├─ await playMp3(sil-12.mp3)  ◄── 新（代替 wait 1200）
  │    └─ State.idx++（若無 skip）
  │
  └─► [deck empty]
       └─ await playMp3(sil-25.mp3)  ◄── 新（代替 wait 2500，reshuffle）

使用者按 Stop（app 內）或 stopAudioCleanup 被其他 renderer 呼叫
       │
       ▼
stopAudioCleanup()
       ├─ State.audioStopped = true
       ├─ sharedAudio.pause()
       ├─ releaseWakeLock()
       └─ clearMediaSession()  ◄── 新增
              ├─ metadata = null
              ├─ playbackState = 'none'
              └─ clear all action handlers
```

---

## 5. 測試策略

### 5.1 自動化（preview_eval 可跑）

- **TC-I-060** Feature detection：`'mediaSession' in navigator` 為 true 時註冊 handler；false 時 startAudio 不炸。
- **TC-I-061** Silence MP3 可取得：`fetch('audio/_silence/sil-50.mp3', {method:'HEAD'}).ok === true`（另含 sil-10 / sil-12 / sil-25）。
- **TC-I-062** `playMp3` 不再使用 `.onended = ...`：`String(playMp3).includes('addEventListener')` 為 true 且 `String(playMp3).includes('.onended =')` 為 false。
- **TC-E-060** 進 Riding 後 `navigator.mediaSession.metadata.title` 含 `Question 3 / 15` 格式（驗證題號置換）。
- **TC-E-061** Stop 後 `metadata === null` + `playbackState === 'none'`。
- **TC-E-062** `State.skipTo = 'next'` 手動設 + 模擬 `ended` → `State.idx` 進位。
- **TC-E-063** `playLoop` 迴圈用 silence MP3 不用 `setTimeout`：檢查 `playLoop` 函式字串不含 `await wait(`（可 `String(playLoop).includes(...)` 或讀 source）。

### 5.2 手動（iPhone 實機，必測）

| ID | 情境 | 預期 |
|---|---|---|
| TC-M-030 | Riding Think 階段鎖屏 | 藍牙耳機持續聽到靜音，5 秒後聽到 "Answer: A" |
| TC-M-031 | 切 Google Maps 看導航 30 秒 | 音訊從未中斷 |
| TC-M-032 | 鎖屏 ⏸ → 3 秒 → ▶️ | clip 在原位恢復 |
| TC-M-033 | 播 q 時按 ⏭ | 立刻跳下一題 q |
| TC-M-034 | 播 ans 時按 ⏮ | 跳回前一題 q |
| TC-M-035 | AirPods 雙擊 | 暫停 / 恢復 |
| TC-M-036 | 來電打斷 → 掛掉 → 鎖屏 ▶️ | 原位恢復 |
| TC-M-037 | 播到一半藍牙斷線 | 暫停不炸 |
| TC-M-038 | 鎖屏畫面 | 🏍️ 封面 + `Question 3 / 15` + source |
| TC-M-039 | 切 0.75x 觀察 Think | 約 6.7 秒（明顯比 5 秒長） |
| TC-M-040 | 最後一題按 ⏭ | 觸發 reshuffle（🔄 Lap 2），不越界 |
| TC-M-041 | 第一題按 ⏮ | 留在第一題（不 wrap） |

### 5.3 桌面開發期驗證

- Chrome DevTools → Application → Service Workers → 確認 `sil-*.mp3` 被 cache。
- DevTools Console：`navigator.mediaSession.metadata` 可讀；`navigator.mediaSession.setActionHandler('pause', f)` 可註冊 + 事件可手動觸發。
- Chrome DevTools → Media panel → 觀察 audio element 狀態連續（應該幾乎永遠 `playing`，只在 clip 切換瞬間短暫 `loading`）。

### 5.4 不測的

- iOS setTimeout throttle 的精確毫秒數（黑盒）。
- Android Chrome PWA 行為（不是使用者裝置）。
- iPhone 車速 / 震動對藍牙 RF 穩定度（硬體層）。

---

## 6. 風險與取捨

1. **iOS Safari 版本差異**：Media Session API 在 iOS 15.0+ 完整支援。iOS 14 或更早只會忽略註冊，不炸但沒有鎖屏控制。Feature detect 已經 handle。
2. **切 app 瞬間的小抖動**：iOS 在 app 被背景化的第一個 200-500ms 仍可能有硬體層級的音訊 gap；這是 iOS 內部行為，我們改不到。
3. **Service Worker cache miss**：如果使用者離線且 silence MP3 還沒被 cache，`playMp3('audio/_silence/sil-50.mp3')` 會 reject（`onerror`）。已存在的 `resolve()` fallback 會讓迴圈繼續跑，但會跳過該段「間隔」—— 此版可接受（首次使用建議連線一次把 shell cache 起來）。
4. **變速對靜音的影響**：前述已接受，不處理。
5. **`ended` 事件的強制觸發**：`forceEndCurrentClip` 使用 `duration - 0.05` + `duration` 為 NaN 時手動 `dispatchEvent('ended')` 兜底。`playMp3` 改用 `addEventListener('ended', ..., {once: true})` 避免 handler 被下個 playMp3 覆寫（skip race bug 防線）。
6. **playMp3 全面改用 addEventListener 影響面**：這次會把 playMp3 改用 `addEventListener` 取代 `.onended`/`.onerror`，並自我清理 listener。現有呼叫點（包括題目階段播放）語意不變，只是更穩。`.onplay` / `.onloadedmetadata` 保留 property assignment（它們只有一個 handler 需要，不會 race）。

---

## 7. 實作順序建議（寫 plan 時細分）

1. 生成 4 個靜音 MP3（`sil-10` / `sil-12` / `sil-25` / `sil-50`），commit 到 `audio/_silence/`。**僅 bump `sw.js` 的 `CACHE` 版本**（例如 `ul2755-v18` → `ul2755-v19`）；**不要**把靜音 MP3 加進 `SHELL` 陣列 —— 現有 service worker 對 `/audio/*.mp3` 走 cache-first on-demand（`sw.js` L19-27），首次播放自然被 cache，加進 shell list 反而讓 install 階段必須先下載這四個檔，拖慢安裝。
2. `playLoop` 把 4 個 `await wait(N)` 換成 `await playMp3('audio/_silence/sil-NN.mp3')`，加 `if (State.skipTo) { advanceBySkip(); continue; }` 檢查點。
3. `startAudio` 註冊 Media Session（metadata + 4 個 action handler）。
4. `updateMediaMetadata` 輔助函式，`playLoop` 每題開頭呼叫。
5. `stopAudioCleanup` 追加 Media Session 清理。
6. 跑完整測試 + iPhone 實機驗證（TC-M-030 ~ 041）。
7. Commit → push → 報 `v0.XX`。
