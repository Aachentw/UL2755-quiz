# Design: Star Bookmarks + Riding Explanation + Back-Button Cleanup

**Date:** 2026-04-23
**Status:** Draft, pending review
**Scope:** Three independent UI polish items bundled into one patch.
**Out of scope:** Cloud sync for stars, star tagging / grouping, export to PDF.

---

## 白話總覽（給非工程師讀）

這版要加/改三件事：

1. **星標（⭐）**：答題時或在題目清單上，覺得重要的題目可以按 ⭐ 標起來。之後到 Question List 切換「⭐ 只看星標」，就能把這批題單獨拿去 Quiz 或 Riding 複習。星標只存在這台裝置的瀏覽器裡，不跨裝置同步。
2. **Riding 秀解釋**：騎車模式播到「答案 A」那一刻，畫面下方會多一張灰底小卡秀 explanation 文字，配合 ans.mp3 一起出現（之前只有聲音，沒有字）。
3. **拿掉多餘的「回首頁」按鈕**：右上角 🏠 Home brand 本來就能點，所以卡片裡重複的 Back 按鈕移掉。但跳一層內（Day/Date 回 Calendar）那種保留。

**使用者範例**：
你在 Quiz 途中遇到一題 §6.2.3 變壓器題答錯了，覺得之後一定要再看一次 —— 答完那一刻在 feedback 卡右邊按下 ⭐，它就記住了。一週後你打開 Question List → 切到「⭐ 只看星標」→ 上面按一下 `🏍️ Riding 這些星標` → 騎車上班路上就只會播你當初標的那批題，並且每題答案階段同時秀出文字 explanation。

---

## Goals

1. 讓使用者能快速標記「這題我想日後再複習」，並在想複習時能一鍵進入該題批次。
2. Riding 模式補上 explanation 文字顯示，不破壞現有音訊節奏。
3. 收斂導航 UX：只有「跳層內」的返回按鈕保留，所有「回首頁」類型都統一走 🏠 Home brand。

**Non-goals**：跨裝置同步、星標分類、星標匯出、改 SRS 排程邏輯。

---

## 1. 星標（Star Bookmarks）

### 1.1 資料模型

新增 localStorage key `srs_starred`，值為 JSON 字串化的字串陣列：

```json
["ul2755-6.2.3", "nec646-a", "fxx-door-5"]
```

選擇「獨立 key」而不是塞進 `srs_state`：
- `srs_state` 只在答過題後才會有該 `qid` 的紀錄。星標需要允許「從 Question List 標尚未答過的題目」。
- 星標與 SRS 正交，分離兩者可避免相互污染（例如 reset 學習紀錄時，使用者可能希望保留星標；目前設計是 Reset Everything 不清星標 — 另開 Clear Stars 動作在設定裡）。
- 不影響現有 `srs.test.html` 的純度約束（srs.js 仍然不碰星標）。

### 1.2 API（`app.js` 的 `SrsStore` 擴充）

```js
SrsStore.loadStarred()   // -> Set<string>
SrsStore.saveStarred(set) // persists as sorted array
SrsStore.toggleStar(qid)  // returns new boolean state
SrsStore.isStarred(qid)   // -> boolean
SrsStore.clearStarred()   // wipes the key
```

持久化格式是排序過的陣列（便於 diff），載入時轉 `Set` 以 O(1) 查詢。

### 1.3 UI：MCQ 答題卡

⭐ toggle 放在整張卡片的**右上角**（與 `.meta` 同一列，位於 `.src` 的右側），從題目載入當下就可見、可按，不綁 feedback 階段：

```
┌──────────────────────────────────────────┐
│ [Tag]              Source §1.1      ★   │  ← meta row + star
│                                          │
│ <question text>                          │
│                                          │
│ [A] Option A                             │
│ [B] Option B                             │
│ [C] Option C                             │
│ [D] Option D                             │
│                                          │
│ (feedback appears after answering)       │
│ [Next →]                                 │
└──────────────────────────────────────────┘
```

- 未星標：☆（空心、灰色 `#94a3b8`）。
- 已星標：★（實心、金色 `#fbbf24`）。
- 點擊：立即 toggle + save，不等 Next；允許在答題前、答題中、答題後任何時刻按。
- 不綁 feedback 的理由：使用者看到題目當下最能判斷「這題我之後還要看」，不必等到答完；與 Question List 的 ⭐ 語意一致。

**初始狀態必讀**：`renderMCQ` 組 `#card.innerHTML` 時，要呼叫 `SrsStore.isStarred(q.id)` 取得目前狀態決定顯示 ☆ 或 ★；不得硬寫空心。這樣「星標後去下一題再回這題」就能看到先前的狀態。`next()` → `renderMCQ()` 會整段重繪 `#card`，不會有殘留。

**事件處理**：按鈕 class `.meta-star`，用 inline `onclick="toggleStarFromCard(event, '${q.id}')"`；`toggleStarFromCard` 負責 `event.stopPropagation()`（避免未來有父層 handler）+ `SrsStore.toggleStar` + 就地切換按鈕的 class / textContent（不重繪整卡，保留答題狀態）。

### 1.4 UI：Question List

#### 頂部切換鈕

在 `.day-header` 下方、`.offset-bar` 上方新增：

```
┌─────────────────────────────┐
│ [全部 15]  [⭐ 只看星標 3]   │
└─────────────────────────────┘
```

- 兩顆 pill-style 按鈕，當前分頁底色 `#c8102e`（與既有 offset-bar active 一致）。
- 預設「全部」。切換狀態存在記憶體即可（`State.qlFilter`），重新進頁面重置為「全部」。

#### 每列的 ⭐

在 `.q-row` 右側（`q-days` 之後）新增一個 ⭐ 按鈕：

```
┌─────────────────────────────────────────────────────┐
│ Under UL2755 §1.1...   Apr 23   Today      ★       │
└─────────────────────────────────────────────────────┘
```

**事件傳播處理**（要明寫避免歧義）：
- `.q-row` 目前是 inline `onclick="openQuestionFromList('...')"`，點擊會冒泡到整列。
- ⭐ 按鈕實作上改用 **inline `onclick="event.stopPropagation(); toggleStarFromList('${q.id}', event)"`**；`toggleStarFromList` 在 `window` 上註冊，內部呼叫 `SrsStore.toggleStar(qid)` 並就地更新該列的 class。
- 不把整列的 `onclick` 改成 `addEventListener`（動到既有結構風險高，MVP 先走 inline）。

**就地更新那一列**：加/移除 `starred` class 切換星星顏色；不重繪整頁，保持捲動位置。若當前是「⭐ 只看星標」且使用者取消星標，**MVP 直接重繪整頁**（最簡單），不做淡出動畫。

**孤兒 id 處理**：`loadStarred()` 會對不存在於 `State.questions` 的 id 做一次 soft-prune（寫回精簡後的陣列），避免資料無限累積。

#### 星標模式下的 Quiz / Riding 入口

切到「⭐ 只看星標」時，在 offset-bar **上方** 插入一列按鈕：

```
┌─────────────────────────────┐
│ [📱 Quiz]   [🏍️ Riding]     │
└─────────────────────────────┘
```

- 若星標為空：不顯示這兩顆按鈕，改顯示空狀態「目前沒有星標題目，快去 MCQ 或題目列表按 ⭐ 標一些吧」。
- 按 Quiz：`State.order = 星標題 id → index 陣列`、`State.mode = 'mcq'`、`resetSession()` → `renderMCQ()`。
- 按 Riding：同上但 `State.mode = 'audio'` → `renderAudioIntro()`。
- 兩者都照常更新 SRS（星標不改變 SRS 行為）。
- **今日新題配額**：若星標題中含從未答過的題，answer 時仍會正常呼叫 `incNewToday()`，照消耗今日新題額度。這是刻意的：星標只是「標籤」，不改變 SRS 身份。使用者一般不會星標未答題，此路徑為低頻；不引入例外邏輯避免複雜化。

### 1.5 空狀態

- 星標數 = 0 且切換到「⭐ 只看星標」：顯示空狀態卡，隱藏 offset-bar（offset jump 在 0 個項目下沒意義）。
- 星標數 > 0 但當下 offset 沒有對應項：offset-bar 行為沿用現況（該 offset 按鈕 disabled）。

### 1.6 Reset 行為

- Settings → `Reset learning records` **不**清星標（星標與學習紀錄正交）。
- confirmDialog 的 body 必須補一行 `· Stars kept (use Clear stars to wipe)`，避免使用者誤解。
- **本版一併**在 Settings modal 新增 `Clear stars` 按鈕（獨立動作）：按下後出 confirmDialog → 清掉 `srs_starred` → 關 modal。
  - 理由：與 §1.6 的文案搭配；若只講「Stars kept」卻沒提供清理入口會製造 UX 矛盾。

---

## 2. Riding 模式顯示 explanation

### 2.1 目前流程

`app.js:playLoop` 的迴圈：
```
🎧 Question (播 q.mp3)
→ 🔢 Options (播 opts.mp3)
→ ⏳ Think 5 seconds...
→ ✅ Answer: A (播 ans.mp3，TTS 內含 explanation)
→ 下一題
```

### 2.2 改動

在 `startAudio()` 的 `#card` 模板中，`#audioStage` 下方新增一個預設隱藏的說明區塊：

```html
<div id="audioExpl" class="audio-expl" hidden></div>
```

CSS：
```css
.audio-expl {
  margin-top: 0.8rem;
  padding: 0.7rem 0.9rem;
  background: #0f172a;
  border: 1px solid #334155;
  border-radius: 8px;
  color: #cbd5e1;
  font-size: 0.9rem;
  line-height: 1.55;
}
```

在 `playLoop` 進入答案階段時：
```js
$('#audioStage').textContent = `✅ Answer: ${ans}`;
const expl = $('#audioExpl');
expl.textContent = `💡 ${q.explanation}`;
expl.hidden = false;
await playMp3(`audio/${q.id}/ans.mp3`);
await wait(1200);
expl.hidden = true;  // 清掉，下一題重新寫
State.idx++;
```

**題目階段必須主動隱藏**（關鍵防線）：每次迴圈進入 `🎧 Question` 階段時，要先 `expl.hidden = true` + 清空 textContent。不能只靠「答案階段結束後 hide」，因為使用者按 Stop 可能發生在 `await playMp3` / `await wait` 期間；雖然 `stopAudio()` 會呼叫 `renderAudioIntro()` 整段重繪 `#card`（自然清掉 `#audioExpl`），但這依賴間接路徑。題目階段顯式清空可保證即使未來改成「只 clear stage 不 rebuild card」也不中招。

### 2.3 不做的事

- 不在題目階段顯示（會劇透）。
- 不在 ans.mp3 播完後才顯示（使用者騎車時幾乎看不到）。
- 不另外讀出 explanation：現有 ans.mp3 的 TTS 本來就包含 explanation（見 `generate_audio.py`），重複播放浪費時間。

---

## 3. Back-Button 清理

### 3.1 移除

| 頁面 | 目前按鈕 | 動作 |
|---|---|---|
| Calendar 頁底部 | `‹ Back` → `location.hash='home'` | 刪除 |
| Question List 頁頂 | `‹ Back` → `location.hash='home'` | 刪除 |
| Round Complete (renderDone) | `Back to Dashboard` → `renderDashboard()` | 刪除 |

**Round Complete 設計**（刻意決定）：刪掉 `Back to Dashboard` 後此頁變成**純資訊頁**（🏆 Round Complete + 本輪 correct/total + 今日累計 + 連勝天數）。使用者按右上 🏠 Home brand 離開。
- 使用者確認可接受沒有頁內 CTA；保持極簡。
- `window.restart` 仍保留在 app.js（其他入口可能使用），只是 `renderDone` 不再綁它。

### 3.2 保留

| 頁面 | 按鈕 | 原因 |
|---|---|---|
| Day 頁頂右 | `‹ Back` → `location.hash='calendar'` | 跳層內，不是回首頁 |
| Date 頁頂右 | `‹ Back` → `location.hash='calendar'` | 同上 |
| Settings modal | `Close` | 關閉 modal，非導頁 |

### 3.3 使用者回首頁動線

所有頁面右上角都有 `🏠 Home` brand（既有的 `.brand` 元素，`init()` 內已綁定 click handler，會 force-rerender dashboard），拿掉卡片內 Back 按鈕後不會有死路。

---

## 測試策略

### 純邏輯（srs.js 不變 → 既有 110 個 TC-U-*** 應保持全過）

**新測試（`srs.test.html`）**：`SrsStore` 在 app.js 裡，不走 srs.test.html；星標 API 的測試放到 TC-I（integration）階段，藉 `preview_eval` 跑。

### Integration（TC-I-*** via preview_eval）

- **TC-I-050** `SrsStore.toggleStar` — toggle 後 `isStarred()` 反轉、localStorage 同步、persist 為排序陣列。
- **TC-I-051** `loadStarred` 對損壞 JSON 回傳空 Set 不 throw。
- **TC-I-052** MCQ feedback 階段按 ⭐ 後重進同題，星標狀態保持（驗證 handleAnswer 模板讀 `isStarred`）。
- **TC-I-053** `loadStarred` 對不存在於 `State.questions` 的孤兒 id 做 soft-prune；呼叫後 localStorage 值只剩有效 id。

### DOM / E2E（TC-D/E-*** via preview_eval）

- **TC-E-050** MCQ 題目顯示時（尚未答題）按 ⭐ → 按鈕切換為實心；重進同題 → 仍為實心。
- **TC-E-051** Question List → 標兩題 → 切「⭐ 只看星標」→ 清單剩兩列 + 出現 Quiz/Riding 按鈕。
- **TC-E-052** 星標模式按 Quiz → 進入 MCQ 流程，題庫 = 星標題集。
- **TC-E-053** 星標全部取消 → 切「⭐ 只看星標」→ 顯示空狀態 + 隱藏 Quiz/Riding 按鈕。
- **TC-E-054** Riding 播到答案階段 → `#audioExpl` 可見且含該題 explanation；進下一題 → 回到 hidden。
- **TC-E-055** Calendar/Question List 頁面無 `‹ Back` 按鈕；Day/Date 頁仍有。
- **TC-E-056** Round Complete 頁面不含 `Back to Dashboard`、也不含任何頁內按鈕（純資訊頁）；🏠 Home brand 可正常點回首頁。
- **TC-E-057** Settings modal 含 `Clear stars` 按鈕；按下 → confirm → `srs_starred` 清空且 `isStarred(any)` 為 false。
- **TC-E-058** `Reset learning records` 的 confirmDialog body 含 `Stars kept` 字樣。

### Manual（TC-M-***）

- iOS Safari 星標點擊不觸發列點擊（`stopPropagation`）。
- Riding 模式下 explanation 文字在手機窄螢幕下不破版。

---

## 風險與取捨

1. **星標 key 與 SRS 正交**：代價是「Reset learning records」不會清星標，使用者可能誤以為星標也被清了。緩解：Settings 增加獨立 `Clear stars` 動作（可延後）。
2. **Question List 頁面新增頂部 bar**：sticky `.offset-bar` 原本在 top:0，現在上面多了濾選 bar，sticky 要改成 `.filter-bar + .offset-bar` 兩層都 sticky 或合併。MVP 做法：濾選 bar 不 sticky（只出現在頁頭），offset-bar 保持 sticky top:0；星標模式下 offset-bar 往下推一行也可接受。
3. **Riding explanation 文字長度**：有些 FXX 題的 explanation 可能 > 150 字，配合 `font-size: 0.9rem` 大約佔 3-4 行；手機直屏可接受，騎車時實際能不能看清是另外一回事（本來就不是主要管道）。
4. **沒有雲端備份**：localStorage 被清（瀏覽器隱私清理/換機）就沒了。目前 app 整體設計就沒有雲端；留意即可。
5. **Service Worker CACHE bump 不需**：本案不動 `sw.js` 內的 shell file list（`app.js` / `index.html` / `srs.js` 名字不變），改動會透過 network-first 自然傳播。不 bump `ul2755-v18`。

---

## 實作順序建議（寫 plan 時細分）

1. **Riding explanation** — 與星標完全正交、風險最低、最容易驗證，先交付。
2. **Back 按鈕清理** — 單純刪按鈕 + Round Complete 加 Restart，獨立作業。
3. **`SrsStore` 星標 API + soft-prune + TC-I-050~053**。
4. **MCQ feedback ⭐ 按鈕 + CSS**。
5. **Question List 每列 ⭐ + 切換 bar + 星標模式 Quiz/Riding 入口**。
6. **Settings 加 `Clear stars` + `Reset learning records` 文案補 `Stars kept`**。
7. 跑完整測試（TC-U 110 + 新 TC-I/E）。
8. Commit → push → 報 `v0.XX`。
