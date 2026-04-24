# Riding Background Playback + Lock-Screen Controls — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make Riding mode audio continue playing when iPhone screen is locked or user switches apps; expose ⏮ / ⏸ / ⏭ on lock-screen + Control Center.

**Architecture:** Replace `await wait(N)` setTimeout gaps with `await playMp3('audio/_silence/sil-NN.mp3')` so the shared `Audio` element never stops → iOS treats it as a music app. Add Media Session API for lock-screen metadata + action handlers. Existing data structures (`audio/<id>/{q,opts,ans}.mp3`) untouched.

**Spec:** `docs/specs/2026-04-24-riding-background-playback-design.md`

**Tech Stack:** Vanilla JS, HTMLAudioElement, Media Session API, Service Worker (cache-first for audio), ffmpeg (one-off silence generation).

---

## 白話摘要（給非工程師）

這份 plan 把 4 個功能片段拆成 5 個 chunk，每個 chunk 獨立 commit。做完你就能騎車時鎖屏、切 Google Maps、用 AirPods 暫停/跳題，都不會中斷。**第一個 chunk 要用 ffmpeg 產生 4 個靜音 MP3**，沒 ffmpeg 可以用 Python + pydub（plan 裡兩種都寫了）。

**使用者範例**：做完後開 Riding → Start → 把手機按鎖屏 → 紅燈時開 Maps → 音訊從未中斷 → AirPods 雙擊暫停 → 繼續聽 → 覺得「這題我會」按耳機下一首按鈕 → 跳到下題。

---

## File Structure

| File | Role |
|---|---|
| `audio/_silence/sil-10.mp3` | 新增。1.0 秒靜音，q → opts 之間（代替 `wait(700)` 並拉到 1 秒避 iOS throttle）。 |
| `audio/_silence/sil-12.mp3` | 新增。1.2 秒靜音，ans → 下一題之間（代替 `wait(1200)`）。 |
| `audio/_silence/sil-25.mp3` | 新增。2.5 秒靜音，deck 空 → reshuffle 過場（代替 `wait(2500)`）。 |
| `audio/_silence/sil-50.mp3` | 新增。5.0 秒靜音，Think 階段（代替 `wait(5000)`）。 |
| `sw.js` | Bump `CACHE` 版本（`ul2755-v18` → `ul2755-v19`）。**不**改 `SHELL` 陣列。 |
| `app.js` | `playMp3` 改 addEventListener；新增 `forceEndCurrentClip`、`advanceBySkip`、`updateMediaMetadata`、`registerMediaSession`、`clearMediaSession`；`playLoop` 加 `State.skipTo` 檢查點 + 用 silence MP3 取代 `wait`；`startAudio` 呼叫 `registerMediaSession`；`stopAudioCleanup` 呼叫 `clearMediaSession`。 |
| `srs.js` | **不動**（純函式模組、110 測試守護）。 |
| `srs.test.html` | **不動**（現有 50 個 TC-U 應保持全過）。 |
| `docs/tests/2026-04-24-test-plan.md` | 新增。TC-I-060~062、TC-E-060~063、TC-M-030~041 清單。 |
| `docs/tests/2026-04-24-test-run-report.md` | 新增。執行結果。 |

---

## Chunk 1: 靜音 MP3 生成 + service worker CACHE bump

風險最低、與 JS 完全正交；一次性資產工作，先做掉。

### Task 1: 用 ffmpeg 產生 4 個靜音 MP3

**Files:** 新增 `audio/_silence/sil-10.mp3`、`sil-12.mp3`、`sil-25.mp3`、`sil-50.mp3`

- [ ] **Step 1.1: 確認 ffmpeg 可用**

```bash
cd "D:/Deltabox/lihsiu.chen/OneDrive - Delta Electronics, Inc/APP/LearnEverything/ul2755-quiz-test"
ffmpeg -version
```

預期：印出版本號（`ffmpeg version ...`）。若「command not found」→ 跳到 Step 1.1-alt 走 Python 路徑。

- [ ] **Step 1.1-alt（ffmpeg 不存在時）：用 Python + pydub**

```bash
pip install pydub
python -c "from pydub import AudioSegment; [AudioSegment.silent(duration=int(d*1000)).export(f'audio/_silence/sil-{int(d*10):02d}.mp3', format='mp3', bitrate='32k') for d in [1.0, 1.2, 2.5, 5.0]]; import os; os.makedirs('audio/_silence', exist_ok=True)"
```

（pydub 內部仍需要 ffmpeg/libav；若連這都沒有，請先安裝 ffmpeg：Windows 下從 https://ffmpeg.org/download.html 取得，加入 PATH）。

- [ ] **Step 1.2: 建立資料夾 + 產生 4 個檔**

```bash
mkdir -p audio/_silence
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1.0 -q:a 9 -acodec libmp3lame audio/_silence/sil-10.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 1.2 -q:a 9 -acodec libmp3lame audio/_silence/sil-12.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 2.5 -q:a 9 -acodec libmp3lame audio/_silence/sil-25.mp3 -y
ffmpeg -f lavfi -i anullsrc=r=22050:cl=mono -t 5.0 -q:a 9 -acodec libmp3lame audio/_silence/sil-50.mp3 -y
```

**備註**：`-q:a 9` 是 libmp3lame VBR 最低品質（~32-40 kbps），靜音壓很小。若日後 iOS 拒播（罕見，通常是 ID3 header 不完整），補 `-id3v2_version 3` flag 再生成。

- [ ] **Step 1.3: 驗證檔案大小（每個 < 10KB）**

```bash
ls -la audio/_silence/
```

預期：4 個檔案，大小約 2-5 KB 範圍內。若任一超過 20 KB → 檢查指令是否誤用了 stereo/high-bitrate。

- [ ] **Step 1.4: 用瀏覽器 HEAD 請求驗證可下載**

啟動 dev server（背景）：
```bash
python -m http.server 8000 &
```

在 DevTools Console 或直接 `curl`:
```bash
curl -I http://localhost:8000/audio/_silence/sil-50.mp3
```

預期：`HTTP/1.0 200 OK`，`Content-Type: audio/mpeg`。

### Task 2: Bump service worker CACHE 版本

**Files:** Modify `sw.js:1`

- [ ] **Step 2.1: 找到並修改 CACHE 版本**

當前：
```js
const CACHE = 'ul2755-v18';
```

改成：
```js
const CACHE = 'ul2755-v19';
```

**不要**把 `audio/_silence/*.mp3` 加進 `SHELL` 陣列：既有 `fetch` handler（`sw.js:19-27`）對 `/audio/*.mp3` 走 cache-first on-demand，首次播放就會 cache。加進 SHELL 反而讓 install 階段必須先下載這 4 個檔，拖慢首次安裝。

- [ ] **Step 2.2: Commit**

```bash
cd "D:/Deltabox/lihsiu.chen/OneDrive - Delta Electronics, Inc/APP/LearnEverything/ul2755-quiz-test"
git add audio/_silence/sil-10.mp3 audio/_silence/sil-12.mp3 audio/_silence/sil-25.mp3 audio/_silence/sil-50.mp3 sw.js
git commit -m "Add silence MP3s for Riding background playback + bump sw.js cache to v19"
```

Pre-commit hook 會自動 bump `version.json`。

---

## Chunk 2: `playMp3` rewrite + `forceEndCurrentClip` helper

**重要**：這個 chunk 改的是音訊播放的核心路徑。做完後**一定要手動驗證 Riding 正常運作**（regression check）。

### Task 3: 重寫 `playMp3` 使用 addEventListener

**Files:** Modify `app.js:407-421` (playMp3 function)

原因：目前 `playMp3` 用 `a.onended = () => resolve()` 做 property 賦值。下一次 `playMp3` 呼叫會覆寫這個 handler。這在 Chunk 4 加入 skip 機制後會變成 race bug（強制觸發 `ended` 可能 resolve 到錯的 promise）。改用 `addEventListener(..., { once: true })` 每個 promise 綁自己的 listener 且自動清理。

- [ ] **Step 3.1: 找到目前的 `playMp3`（L407-421）**

```js
function playMp3(url) {
  return new Promise((resolve) => {
    const a = getAudio();
    currentAudio = a;
    a.src = url;
    const applyRate = () => { a.playbackRate = getSpeed(); a.defaultPlaybackRate = getSpeed(); };
    a.onloadedmetadata = applyRate;
    a.onplay = applyRate;
    a.onended = () => resolve();
    a.onerror = () => { console.warn('MP3 error:', url); resolve(); };
    applyRate();
    const p = a.play();
    if (p && p.then) p.then(applyRate).catch(err => { console.warn('play() rejected:', err); resolve(); });
  });
}
```

- [ ] **Step 3.2: 整段替換成：**

```js
function playMp3(url) {
  return new Promise((resolve) => {
    const a = getAudio();
    currentAudio = a;
    a.src = url;
    const applyRate = () => { a.playbackRate = getSpeed(); a.defaultPlaybackRate = getSpeed(); };
    a.onloadedmetadata = applyRate;
    a.onplay = applyRate;
    // Critical: use addEventListener once — each playMp3 call binds its own
    // handler, so skip handlers (forceEndCurrentClip) that dispatch 'ended'
    // cannot accidentally resolve the wrong promise.
    const onDone = () => {
      a.removeEventListener('ended', onDone);
      a.removeEventListener('error', onDone);
      resolve();
    };
    a.addEventListener('ended', onDone, { once: true });
    a.addEventListener('error', onDone, { once: true });
    applyRate();
    const p = a.play();
    if (p && p.then) p.then(applyRate).catch(err => { console.warn('play() rejected:', err); onDone(); });
  });
}
```

**注意**：`removeEventListener` 在 `{ once: true }` 觸發後雖然自動解除，但為防 `play()` reject 路徑呼叫 `onDone()` 後另一個事件又來，顯式 remove 更安全（`{ once: true }` 對已觸發 listener 已足夠，但 remove 兩個 listener 都清掉）。

### Task 4: 新增 `forceEndCurrentClip` helper

**Files:** Modify `app.js` 緊接 `playMp3` 之後（L422 之後、L423 `waitForCurrentEnd` 之前）

- [ ] **Step 4.1: 在 `playMp3` 函式定義結束後、`waitForCurrentEnd` 之前新增：**

```js
// Force the currently playing clip to end, so the pending playMp3 promise resolves.
// Used by Media Session prev/next actions.
function forceEndCurrentClip() {
  const a = sharedAudio;
  if (!a) return;
  // Guard: duration may be NaN when src just set and metadata not loaded yet.
  if (!isFinite(a.duration) || a.duration <= 0) {
    a.pause();
    a.dispatchEvent(new Event('ended'));
    return;
  }
  // Normal path: seek near end to trigger the 'ended' event reliably.
  // iOS Safari sometimes ignores duration - 0.01; 0.05 is more reliable.
  try {
    a.currentTime = Math.max(0, a.duration - 0.05);
  } catch (_) {
    // readyState < 1 can throw on currentTime setter; fallback to manual dispatch.
    a.dispatchEvent(new Event('ended'));
  }
}
```

### Task 5: 手動 regression — Riding 仍正常

- [ ] **Step 5.1: 跑 dev server、開瀏覽器**

```bash
cd "D:/Deltabox/lihsiu.chen/OneDrive - Delta Electronics, Inc/APP/LearnEverything/ul2755-quiz-test"
python -m http.server 8000
```

開 `http://localhost:8000/srs.test.html` 確認 **50 passed, 0 failed**。

- [ ] **Step 5.2: Riding 跑一題**

Dashboard → Riding → Start。確認：
- 題目正常播完 → 選項正常播完 → Think 5 秒 → 答案正常播完。
- Chrome DevTools 的 Media panel 觀察 `sharedAudio` 沒有 stuck、沒有 error。
- 按 Stop 能正常回到 intro。

若有任何 regression，回去檢查 Step 3.2 的替換是否漏字。

- [ ] **Step 5.3: Commit**

```bash
git add app.js
git commit -m "playMp3: switch to addEventListener {once:true}; add forceEndCurrentClip helper"
```

---

## Chunk 3: `playLoop` — wait → silence MP3 + State.skipTo 基礎設施

完成這個 chunk 後，**鎖屏背景播放就能運作**（即使 Media Session 還沒掛）。Media Session 在 Chunk 4 加。

### Task 6: 新增 `State.skipTo` + `advanceBySkip` helper

**Files:** Modify `app.js:15-27` (State object) and add helper near playLoop

- [ ] **Step 6.1: 在 `State` 物件初始化（L15-27）中加一個欄位**

當前：
```js
const State = {
  questions: [],
  order: [],
  idx: 0,
  mode: 'mcq',
  combo: 0,
  streak: parseInt(localStorage.getItem('streak') || '0', 10),
  lastDay: localStorage.getItem('lastDay') || '',
  wakeLock: null,
  audioTimer: null,
  audioStopped: false,
  session: { correct: 0, total: 0 },
};
```

在 `audioStopped` 之後新增 `skipTo: null`：
```js
  audioStopped: false,
  skipTo: null,
  session: { correct: 0, total: 0 },
```

- [ ] **Step 6.2: 新增 `advanceBySkip` helper（在 `playLoop` 定義之前）**

```js
// Called from playLoop after each clip when State.skipTo was set by
// Media Session prev/next handler.
function advanceBySkip() {
  if (State.skipTo === 'next') {
    State.idx++;
  } else if (State.skipTo === 'prev') {
    State.idx = Math.max(0, State.idx - 1);
  }
  State.skipTo = null;  // reset for next loop iteration
}
```

### Task 7: 改寫 `playLoop` — wait → silence MP3 + skip check

**Files:** Modify `app.js:351-403` (playLoop function)

這是本次最核心的改動。

- [ ] **Step 7.1: 找到目前 `playLoop`（L351-403）全文：**

```js
async function playLoop({ firstAlreadyPlaying = false } = {}) {
  let first = firstAlreadyPlaying;
  let lap = 1;
  while (!State.audioStopped) {
    if (State.idx >= State.order.length) {
      lap++;
      rebuildDeck();
      if (State.order.length === 0) {
        // No due items right now — fall back to full pool reshuffle for continuous listening
        State.order = shuffle([...State.questions.keys()]);
      }
      $('#audioStage').textContent = `🔄 Lap ${lap} — reshuffling…`;
      await wait(2500);
      if (State.audioStopped) break;
    }
    const q = currentQuestion();
    $('#audioQ').textContent = q.question;
    $('#audioOpts').innerHTML = q.options.map((o, i) =>
      `<div class="aopt"><span class="letter">${String.fromCharCode(65 + i)}</span><span>${o}</span></div>`).join('');

    // Clear explanation from previous answer (defense: do not rely only on post-ans hide)
    const expl = document.querySelector('#audioExpl');
    if (expl) { expl.hidden = true; expl.textContent = ''; }
    $('#audioStage').textContent = '🎧 Question';
    if (first) {
      await waitForCurrentEnd();
      first = false;
    } else {
      await playMp3(`audio/${q.id}/q.mp3`);
    }
    if (State.audioStopped) break;
    await wait(700);

    $('#audioStage').textContent = '🔢 Options';
    await playMp3(`audio/${q.id}/opts.mp3`);
    if (State.audioStopped) break;

    $('#audioStage').textContent = '⏳ Think 5 seconds…';
    await wait(5000);
    if (State.audioStopped) break;

    const ans = String.fromCharCode(65 + q.answer_index);
    $('#audioStage').textContent = `✅ Answer: ${ans}`;
    if (expl && q.explanation) {
      expl.textContent = `💡 ${q.explanation}`;
      expl.hidden = false;
    }
    await playMp3(`audio/${q.id}/ans.mp3`);
    await wait(1200);
    State.idx++;
    updateHeader();
  }
}
```

- [ ] **Step 7.2: 整段替換成：**

```js
async function playLoop({ firstAlreadyPlaying = false } = {}) {
  let first = firstAlreadyPlaying;
  let lap = 1;
  while (!State.audioStopped) {
    State.skipTo = null;  // reset at top of each iteration

    if (State.idx >= State.order.length) {
      lap++;
      rebuildDeck();
      if (State.order.length === 0) {
        State.order = shuffle([...State.questions.keys()]);
      }
      $('#audioStage').textContent = `🔄 Lap ${lap} — reshuffling…`;
      await playMp3('audio/_silence/sil-25.mp3');
      if (State.audioStopped) break;
    }
    const q = currentQuestion();
    $('#audioQ').textContent = q.question;
    $('#audioOpts').innerHTML = q.options.map((o, i) =>
      `<div class="aopt"><span class="letter">${String.fromCharCode(65 + i)}</span><span>${o}</span></div>`).join('');

    // Clear explanation from previous answer (defense: do not rely only on post-ans hide)
    const expl = document.querySelector('#audioExpl');
    if (expl) { expl.hidden = true; expl.textContent = ''; }

    $('#audioStage').textContent = '🎧 Question';
    if (first) {
      await waitForCurrentEnd();
      first = false;
    } else {
      await playMp3(`audio/${q.id}/q.mp3`);
    }
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    await playMp3('audio/_silence/sil-10.mp3');
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    $('#audioStage').textContent = '🔢 Options';
    await playMp3(`audio/${q.id}/opts.mp3`);
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    $('#audioStage').textContent = '⏳ Think 5 seconds…';
    await playMp3('audio/_silence/sil-50.mp3');
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    const ans = String.fromCharCode(65 + q.answer_index);
    $('#audioStage').textContent = `✅ Answer: ${ans}`;
    if (expl && q.explanation) {
      expl.textContent = `💡 ${q.explanation}`;
      expl.hidden = false;
    }
    await playMp3(`audio/${q.id}/ans.mp3`);
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    await playMp3('audio/_silence/sil-12.mp3');
    if (State.audioStopped) break;
    if (State.skipTo) { advanceBySkip(); continue; }

    State.idx++;
    updateHeader();
  }
}
```

**關鍵差異**：
1. 4 個 `await wait(N)` 全部改成 `await playMp3('audio/_silence/sil-NN.mp3')`（對應 wait 700→sil-10 是拉到 1s，其餘照原時長）。
2. 每個 `await` 後加 `if (State.skipTo) { advanceBySkip(); continue; }`（共 6 處：q、sil-10、opts、sil-50、ans、sil-12）。
3. reshuffle 的 `wait(2500)` 改成 `sil-25.mp3`。
4. `State.skipTo = null` 在 while 頂端重置。

### Task 8: 手動驗證 — 背景播放成功

- [ ] **Step 8.1: Dev server 開、進 Riding**

```bash
cd "D:/Deltabox/lihsiu.chen/OneDrive - Delta Electronics, Inc/APP/LearnEverything/ul2755-quiz-test"
python -m http.server 8000
```

瀏覽器開 `http://localhost:8000/` → Dashboard → Riding → Start。

- [ ] **Step 8.2: Chrome DevTools → 切到 Application tab → Service Workers → 確認 v19 active**

- [ ] **Step 8.3: 桌面模擬背景 throttle**

Chrome DevTools → 右上 `⋮` → More tools → Rendering → `Emulate a focused page` = unchecked；或用 `Ctrl+Shift+I` 後分頁切走再切回。正常情境是觀察到音訊 clip 流暢串接，**Think 階段**配合靜音 MP3 約 5 秒，不是 bug 凍結。

- [ ] **Step 8.4: Commit**

```bash
git add app.js
git commit -m "playLoop: replace await wait() with silence MP3 playback; add State.skipTo check points for upcoming Media Session"
```

---

## Chunk 4: Media Session 整合

新增鎖屏顯示 + ⏮⏸/▶️⏭ 四顆按鈕。

### Task 9: 新增 `registerMediaSession` + `updateMediaMetadata` + `clearMediaSession`

**Files:** Modify `app.js` 在 `playLoop` 函式定義之後新增

- [ ] **Step 9.1: 在 `playLoop` 結尾 `}` 之後新增 3 個 helper：**

```js
// ----- Media Session (lock screen / control center / bluetooth headset controls) -----
function hasMediaSession() {
  return 'mediaSession' in navigator
      && typeof navigator.mediaSession.setActionHandler === 'function';
}

function updateMediaMetadata(q) {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Question ${State.idx + 1} / ${State.order.length}`,
      artist: q ? q.source : 'UL2755 Sprint',
      album: 'UL2755 Sprint · 🏍️ Riding',
      // No artwork — iOS Safari does not render SVG data URLs in MediaMetadata.
    });
  } catch (_) { /* noop */ }
}

function registerMediaSession() {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.playbackState = 'playing';
    navigator.mediaSession.setActionHandler('play', () => {
      if (sharedAudio) sharedAudio.play().catch(() => {});
      navigator.mediaSession.playbackState = 'playing';
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      if (sharedAudio) sharedAudio.pause();
      navigator.mediaSession.playbackState = 'paused';
    });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      State.skipTo = 'prev';
      forceEndCurrentClip();
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      State.skipTo = 'next';
      forceEndCurrentClip();
    });
  } catch (_) { /* noop */ }
}

function clearMediaSession() {
  if (!hasMediaSession()) return;
  try {
    navigator.mediaSession.metadata = null;
    navigator.mediaSession.playbackState = 'none';
    ['play', 'pause', 'previoustrack', 'nexttrack'].forEach(a => {
      try { navigator.mediaSession.setActionHandler(a, null); } catch (_) {}
    });
  } catch (_) { /* noop */ }
}
```

### Task 10: `startAudio` 呼叫 `registerMediaSession` + 初始 `updateMediaMetadata`

**Files:** Modify `app.js:328-349` (startAudio function)

`startAudio` 目前長這樣（L328-349）：

```js
async function startAudio({ firstAlreadyPlaying = false } = {}) {
  State.audioStopped = false;
  requestWakeLock();
  const q = currentQuestion();
  const s = getSpeed();
  $('#card').innerHTML = `
    <div class="audio-view">
      ...（大段 DOM 渲染，內含 #audioQ / #audioOpts / #audioStage / #audioExpl / speed buttons / Stop）...
    </div>
  `;
  playLoop({ firstAlreadyPlaying });
}
```

要在兩個位置插入：
1. 頂部：`State.skipTo = null` 跟 `State.audioStopped = false` 放一起（進 Riding 時重置 skip 旗標）。
2. `const q = currentQuestion();` 之後、`const s = getSpeed();` 之前：註冊 Media Session + 寫入 metadata（這兩行必須在 `const q` 之後，因為要用到 `q`；放在 DOM 渲染之前沒影響）。

- [ ] **Step 10.1: 把函式開頭的 `State.audioStopped = false;` 改為兩行：**

```js
async function startAudio({ firstAlreadyPlaying = false } = {}) {
  State.audioStopped = false;
  State.skipTo = null;
  requestWakeLock();
  const q = currentQuestion();
```

- [ ] **Step 10.2: 在 `const q = currentQuestion();` 這行之後、`const s = getSpeed();` 之前插入兩行：**

```js
  const q = currentQuestion();
  registerMediaSession();
  updateMediaMetadata(q);
  const s = getSpeed();
```

不要刪除 `const s = getSpeed();` 這行或其後的任何 DOM 渲染／`playLoop({ firstAlreadyPlaying })`。

### Task 11: `playLoop` 在換題時呼叫 `updateMediaMetadata`

**Files:** Modify `app.js:playLoop` (the one edited in Chunk 3; `const q = currentQuestion()` 在 Chunk 3 改寫後的版本約 L366)

- [ ] **Step 11.1: 在 Chunk 3 改寫後的 `playLoop` 裡，找到 `const q = currentQuestion();`（單獨一行）。在這行之後、`$('#audioQ').textContent = q.question;` 之前插入一行：**

```js
    const q = currentQuestion();
    updateMediaMetadata(q);           // ← new: refresh lock-screen title per question
    $('#audioQ').textContent = q.question;
```

**不要刪除** `$('#audioQ').textContent = q.question;` 或後面任何 DOM 更新行。插入的是「一行」，不是替換。

### Task 12: `stopAudioCleanup` 呼叫 `clearMediaSession`

**Files:** Modify `app.js:434-441` (stopAudioCleanup)

- [ ] **Step 12.1: 找到當前 `stopAudioCleanup`：**

```js
function stopAudioCleanup() {
  State.audioStopped = true;
  clearTimeout(State.audioTimer);
  if (sharedAudio) { try { sharedAudio.pause(); sharedAudio.src = ''; sharedAudio.removeAttribute('src'); } catch (_) {} }
  currentAudio = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWakeLock();
}
```

- [ ] **Step 12.2: 在 `releaseWakeLock()` 之前加一行：**

```js
function stopAudioCleanup() {
  State.audioStopped = true;
  State.skipTo = null;
  clearTimeout(State.audioTimer);
  if (sharedAudio) { try { sharedAudio.pause(); sharedAudio.src = ''; sharedAudio.removeAttribute('src'); } catch (_) {} }
  currentAudio = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  clearMediaSession();
  releaseWakeLock();
}
```

### Task 13: 手動驗證（桌面）

- [ ] **Step 13.1: Dev server + Riding**

Dashboard → Riding → Start。

- [ ] **Step 13.2: DevTools Console 驗 metadata**

```js
navigator.mediaSession.metadata
// 應看到 MediaMetadata { title: "Question 1 / 15", artist: "UL2755 §X.X.X", album: "UL2755 Sprint · 🏍️ Riding" }
```

- [ ] **Step 13.3: DevTools Console 模擬按鈕**

```js
// 模擬按鎖屏的 pause
navigator.mediaSession.setActionHandler('pause', f => f); // 讀當前 handler 的最簡驗法：看 playbackState
navigator.mediaSession.playbackState  // 'playing'
```

- [ ] **Step 13.4: 按 Stop 後驗證清空**

```js
navigator.mediaSession.metadata       // null
navigator.mediaSession.playbackState  // 'none'
```

- [ ] **Step 13.5: Commit**

```bash
git add app.js
git commit -m "Media Session: register lock-screen title + play/pause/prev/next handlers on startAudio; clear on stopAudioCleanup"
```

---

## Chunk 5: Tests + 實機驗證 + push

### Task 14: 跑現有 50 個 TC-U-*** 單元測試

- [ ] **Step 14.1: 瀏覽器開 `http://localhost:8000/srs.test.html`**

確認最底顯示 **50 passed, 0 failed**。若失敗：代表 srs.js 被意外污染，回去檢查 Chunks 2-4。

### Task 15: 自動化 TC-I-*** / TC-E-***（preview_eval 或 DevTools console）

- [ ] **Step 15.1: TC-I-060 / TC-I-061 / TC-I-062**（在 DevTools console 跑）

```js
// TC-I-060 Feature detection
(function(){
  const has = 'mediaSession' in navigator && typeof navigator.mediaSession.setActionHandler === 'function';
  console.assert(typeof has === 'boolean', 'TC-I-060 feature detect');
  console.log('TC-I-060 pass');
})();

// TC-I-061 Silence MP3 reachable
(async function(){
  for (const f of ['sil-10', 'sil-12', 'sil-25', 'sil-50']) {
    const r = await fetch(`audio/_silence/${f}.mp3`, { method: 'HEAD' });
    console.assert(r.ok, `TC-I-061 ${f}`);
  }
  console.log('TC-I-061 pass');
})();

// TC-I-062 playMp3 no longer uses .onended =
(function(){
  const src = String(playMp3);
  console.assert(src.includes('addEventListener'), 'TC-I-062a uses addEventListener');
  console.assert(!src.includes('.onended ='), 'TC-I-062b no more .onended =');
  console.log('TC-I-062 pass');
})();
```

- [ ] **Step 15.2: TC-E-060 / TC-E-061 / TC-E-062 / TC-E-063**

```js
// TC-E-060 Media Session metadata on Riding start
// Both `enterRiding` and `primeAndStart` are exposed on window (app.js:1163 and ~L315).
// `primeAndStart` must fire synchronously inside a user gesture — in DevTools it will
// still work because DevTools console counts as a privileged context on localhost, but
// if it fails with a play() rejection, click the actual Start button instead of the
// console call.
(async function(){
  location.hash = 'home';
  await new Promise(r => setTimeout(r, 200));
  window.enterRiding();                      // navigates to Riding intro (no hash change)
  await new Promise(r => setTimeout(r, 100));
  window.primeAndStart();                    // starts playback + Media Session
  await new Promise(r => setTimeout(r, 500));
  const md = navigator.mediaSession.metadata;
  console.assert(md && /Question \d+ \/ \d+/.test(md.title), 'TC-E-060');
  console.log('TC-E-060 pass');
})();

// TC-E-061 Stop clears Media Session
(function(){
  stopAudio();
  console.assert(navigator.mediaSession.metadata === null, 'TC-E-061a');
  console.assert(navigator.mediaSession.playbackState === 'none', 'TC-E-061b');
  console.log('TC-E-061 pass');
})();

// TC-E-062 skipTo advances idx
(function(){
  State.idx = 3;
  State.skipTo = 'next';
  advanceBySkip();
  console.assert(State.idx === 4, 'TC-E-062 next');
  State.idx = 5;
  State.skipTo = 'prev';
  advanceBySkip();
  console.assert(State.idx === 4, 'TC-E-062 prev');
  State.idx = 0;
  State.skipTo = 'prev';
  advanceBySkip();
  console.assert(State.idx === 0, 'TC-E-062 prev-clamp');
  console.log('TC-E-062 pass');
})();

// TC-E-063 playLoop no longer uses wait()
(function(){
  const src = String(playLoop);
  console.assert(!src.includes('await wait('), 'TC-E-063 no await wait');
  console.assert(src.includes('_silence/sil-'), 'TC-E-063 uses silence mp3');
  console.log('TC-E-063 pass');
})();
```

### Task 16: 寫 test plan + run report

**Files:** Create `docs/tests/2026-04-24-test-plan.md`, `docs/tests/2026-04-24-test-run-report.md`

- [ ] **Step 16.1: 參考 `docs/tests/2026-04-23-test-plan.md` 的結構寫 test plan**

包含：範圍、TC-I-060~062、TC-E-060~063、TC-M-030~041（12 條實機 case，見 spec §5.2）。

- [ ] **Step 16.2: 跑完自動化 + 實機（見 Task 17）後，寫 run report**

記 pass/fail/deferred。實機測試在 iPhone PWA 上逐條執行，失敗條目回去修。

- [ ] **Step 16.3: Commit test docs**

```bash
git add docs/tests/2026-04-24-test-plan.md docs/tests/2026-04-24-test-run-report.md
git commit -m "Tests: plan + run report for Riding background playback (TC-I-060~062, TC-E-060~063, TC-M-030~041)"
```

### Task 17: iPhone 實機驗證（12 條 TC-M）

- [ ] **Step 17.1: Push 到 GitHub，等 Pages 部署完（約 30-60 秒）**

```bash
git push origin main
```

- [ ] **Step 17.2: iPhone 開已安裝的 PWA → Riding → Start**

逐條跑 spec §5.2 的 TC-M-030 ~ TC-M-041。關鍵幾條：
- **TC-M-030**：Think 5 秒時按鎖屏 → 繼續播靜音 → 聽到 "Answer: A" → 通過代表 iOS throttle 規避成功。
- **TC-M-031**：切 Maps 30 秒 → 切回 → 音訊沒停過 → 通過代表 Media Session + 連續播放生效。
- **TC-M-038**：鎖屏看到 `Question 3 / 15` + UL2755 source → 通過代表 MediaMetadata 生效。
- **TC-M-033 / 034**：鎖屏按 ⏭/⏮ → 立即跳題。

- [ ] **Step 17.3: 把結果記入 `docs/tests/2026-04-24-test-run-report.md`，補 commit**

### Task 18: 最終檢查 + 回報 v0.XX

- [ ] **Step 18.1: 驗證 commit 歷史乾淨**

```bash
git log --oneline origin/main..HEAD  # 若已 push，此段應為空
git log --oneline -10  # 檢視最近 commits
```

- [ ] **Step 18.2: 讀 version.json、回報給使用者**

```bash
cat version.json
```

回傳格式：「已推出 `v0.XX`，Riding 背景播放 + 鎖屏控制生效…」

---

## 風險 / 回滾策略

- 每個 Chunk 一個獨立 commit，出包可用 `git revert <sha>` 單獨回滾。
- 若 Chunk 3 改完後 Riding 整個壞掉：最可能是 `State.skipTo` 檢查誤攔正常流程，或 silence MP3 路徑錯字。先 `git bisect` 或直接 revert。
- 若 Chunk 4 讓 Riding 炸但 Chunk 3 沒炸：回滾 Chunk 4 commit，背景播放核心仍可保留（只是沒有鎖屏控制）。
- Silence MP3 生成失敗 / ffmpeg 不在：退到純 wait 版本直到產檔完成。

---

## 快速檢查清單（完成時對照）

- [ ] Chunk 1: 4 個靜音 MP3 commit 進 repo；sw.js CACHE bump 到 v19
- [ ] Chunk 2: playMp3 改 addEventListener；forceEndCurrentClip helper 存在
- [ ] Chunk 3: playLoop 四個 `await wait()` 全換成 silence playMp3；6 處 skipTo check
- [ ] Chunk 4: Media Session metadata + 4 個 action handler；stopAudioCleanup 清空
- [ ] Chunk 5: 50 個 TC-U 全過、TC-I/E 全過、TC-M 實機 12 條記錄、push、回報 v0.XX
