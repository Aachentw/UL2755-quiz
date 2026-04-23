# Star Bookmarks + Riding Explanation + Back-Button Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans (tasks coupled in app.js + index.html; no test runner — verify via browser-opened `srs.test.html` + `preview_eval`). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Bundle three UI polish items into one patch — add ⭐ bookmarks, show explanations in Riding mode, collapse redundant Back buttons.

**Architecture:** No change to `srs.js` (pure module stays pure). All work in `app.js` + CSS in `index.html`. New localStorage key `srs_starred` managed by `SrsStore`.

**Spec:** `docs/specs/2026-04-23-star-and-riding-polish-design.md`

---

## 白話摘要（給非工程師）

這份 plan 把三件事拆成七個 chunk，由低風險往高風險做：先改 Riding 顯示 explanation（完全獨立）→ 拆舊 Back 按鈕（單純刪除）→ 加星標資料層 → MCQ 右上 ⭐ → Question List 的 ⭐ 和切換 bar → Settings 的 Clear stars → 全回歸測試。每個 chunk 結尾都 commit 一次，有狀況可回滾。

**使用者範例**：做完後你打開 app → 進一題 → 右上角直接按 ⭐ → 到 Question List 切到「⭐」分頁 → 按 Riding → 騎車路上聽到答案時畫面同步秀 💡 explanation 文字。

---

## File Structure

| File | Role |
|---|---|
| `app.js` | `SrsStore` 星標 API、renderMCQ / renderQuestionList / renderAudio / renderDone / renderCalendar 改版、playLoop 加 explanation 顯示、window.toggleStarFromCard / toggleStarFromList / clearAllStars。 |
| `index.html` | 新增 CSS：`.audio-expl`、`.meta-star`、`.ql-filter-bar`、`.q-row .star`、`.q-row.starred`；Settings modal 加 `Clear stars` 按鈕。 |
| `srs.js` | **不動**（純函式模組）。 |
| `srs.test.html` | **不動**（現有 110 個 TC-U-*** 應保持全過，用來驗證 srs.js 未被污染）。 |
| `docs/tests/2026-04-23-test-plan.md` | 新 TC-I-050~053、TC-E-050~058 的驗證腳本。 |
| `docs/tests/2026-04-23-test-run-report.md` | 執行報告（完成時新增）。 |

**注意**：`sw.js` 的 `CACHE` **不 bump**。本案 shell file list 沒變，app shell 走 network-first 會自然取得新版。

---

## Chunk 1: Riding 模式顯示 explanation

**風險最低、與其他功能正交**，放第一個做完可立刻交付。

### Task 1: 加 CSS `.audio-expl`

**Files:** Modify `index.html`

- [ ] **Step 1.1: 在 `index.html` 既有的 `.audio-view` 相關 CSS 附近（約 line 59 之後）新增：**

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
    text-align: left;
  }
  .audio-expl[hidden] { display: none !important; }
```

- [ ] **Step 1.2: 存檔；不用重啟 dev server（`?v=Date.now()` 會自動取新 CSS）。**

### Task 2: 在 `startAudio` 模板加入 `#audioExpl` 元素

**Files:** Modify `app.js:290-303` (startAudio template)

- [ ] **Step 2.1: 找到 `startAudio` 中的 template string。原本長這樣（約 L296-297）：**

```html
      <div id="audioStage" class="stage">🎧 Question</div>
      <div class="speed-row">
```

**改成：**

```html
      <div id="audioStage" class="stage">🎧 Question</div>
      <div id="audioExpl" class="audio-expl" hidden></div>
      <div class="speed-row">
```

### Task 3: 在 `playLoop` 答案階段顯示 explanation、題目階段隱藏

**Files:** Modify `app.js:307-352` (playLoop)

- [ ] **Step 3.1: 在 `playLoop` 迴圈進入題目階段時（`$('#audioQ').textContent = q.question;` 之後、`$('#audioStage').textContent = '🎧 Question';` 之前）加入：**

```js
    // Clear explanation from previous answer (防線：不能只靠下面的 hide)
    const expl = document.querySelector('#audioExpl');
    if (expl) { expl.hidden = true; expl.textContent = ''; }
```

- [ ] **Step 3.2: 在答案階段顯示 answer letter 之後、`await playMp3(\`audio/${q.id}/ans.mp3\`)` 之前加入：**

```js
    if (expl && q.explanation) {
      expl.textContent = `💡 ${q.explanation}`;
      expl.hidden = false;
    }
```

- [ ] **Step 3.3: 手動驗證（Riding 實機）**
  - 啟動 dev server：`cd ul2755-quiz-test && python -m http.server 8000`
  - 瀏覽器打開 `http://localhost:8000/` → Dashboard → Riding → Start
  - 確認：題目階段下方無 expl；答案階段顯示 `💡 <explanation>` 灰底卡；進下一題立即消失。
  - 中途按 Stop → 退回 intro 頁 → 重新 Start，`#audioExpl` 不殘留。

- [ ] **Step 3.4: Commit**

```bash
git add index.html app.js
git commit -m "Riding: show explanation text at answer stage (clears at question stage as defense)"
```

---

## Chunk 2: Back 按鈕清理

全部是純刪除，獨立 commit。

### Task 4: 移除 Calendar 底部 Back 按鈕

**Files:** Modify `app.js:736` (renderCalendar trailing button)

- [ ] **Step 4.1: 刪除這行：**

```js
    <button class="ghost" style="margin-top:1rem;" onclick="location.hash='home'">‹ Back</button>
```

### Task 5: 移除 Question List 頂部 Back 按鈕

**Files:** Modify `app.js:980-987` (renderQuestionList day-header)

- [ ] **Step 5.1: 把現有的 day-header 簡化成沒有 Back 的版本：**

```js
    <div class="day-header">
      <h2 style="margin:0;color:#f8fafc;">Question List</h2>
      <div class="sub">${list.length} questions · sorted by next review</div>
    </div>
```

（原本的 `<div style="display:flex;justify-content:space-between;...">` 整段換掉）

### Task 6: Round Complete 變純資訊頁

**Files:** Modify `app.js:197-211` (renderDone)

- [ ] **Step 6.1: 刪掉 template 裡的 `<button class="ghost" onclick="renderDashboard()">Back to Dashboard</button>` 那一行。**

- [ ] **Step 6.2: 手動驗證**
  - Calendar 頁底部不再有 `‹ Back` 按鈕；右上 🏠 Home 可正常回首頁。
  - Question List 頁頂無 `‹ Back`。
  - Quiz 完一輪後 Round Complete 只剩統計文字，🏠 Home 可回。
  - Day 頁 / Date 頁的 `‹ Back` → Calendar **仍保留**。

- [ ] **Step 6.3: Commit**

```bash
git add app.js
git commit -m "Remove redundant Back buttons (Calendar/QuestionList/RoundComplete); keep Day/Date intra-level backs"
```

---

## Chunk 3: 星標資料層（`SrsStore` API）

純 JS，可用 `preview_eval` 驗證；沒有 UI 變動。

### Task 7: 擴充 `SrsStore` 加入星標 API

**Files:** Modify `app.js:32-68` (SrsStore block)

- [ ] **Step 7.1: 在 `SrsStore` 最後一個方法 `ensureCurriculum` 之後、閉合大括號之前加入：**

```js
  loadStarred() {
    try {
      const arr = JSON.parse(localStorage.getItem('srs_starred') || '[]');
      if (!Array.isArray(arr)) return new Set();
      // soft-prune: drop ids no longer in questions.json.
      // BUT: skip prune if State.questions is empty (not yet loaded) —
      // otherwise every stored id would be treated as orphan on early calls
      // and silently wipe the user's stars.
      if (!State.questions || State.questions.length === 0) return new Set(arr);
      const validIds = new Set(State.questions.map(q => q.id));
      const kept = arr.filter(id => validIds.has(id));
      if (kept.length !== arr.length) {
        localStorage.setItem('srs_starred', JSON.stringify(kept.slice().sort()));
      }
      return new Set(kept);
    } catch { return new Set(); }
  },
  saveStarred(set) {
    const arr = [...set].sort();
    localStorage.setItem('srs_starred', JSON.stringify(arr));
  },
  toggleStar(qid) {
    const s = this.loadStarred();
    if (s.has(qid)) s.delete(qid); else s.add(qid);
    this.saveStarred(s);
    return s.has(qid);
  },
  isStarred(qid) { return this.loadStarred().has(qid); },
  clearStarred() { localStorage.removeItem('srs_starred'); },
```

**設計理由**：`loadStarred` 做 soft-prune 確保即便 `questions.json` 改動也不留孤兒 id；`saveStarred` 排序以利 diff；`isStarred` 直接走 load（對單一查詢 O(n) 可接受，n < 300）。

- [ ] **Step 7.2: 驗證（以 preview_eval 或 DevTools console 跑）**

```js
// TC-I-050
SrsStore.toggleStar('ul2755-1.1');
console.assert(SrsStore.isStarred('ul2755-1.1') === true);
SrsStore.toggleStar('ul2755-1.1');
console.assert(SrsStore.isStarred('ul2755-1.1') === false);
console.assert(JSON.parse(localStorage.getItem('srs_starred')) === null || Array.isArray(JSON.parse(localStorage.getItem('srs_starred'))));

// TC-I-051 (corrupted JSON)
localStorage.setItem('srs_starred', 'not-json{');
console.assert(SrsStore.loadStarred().size === 0);
localStorage.removeItem('srs_starred');

// TC-I-053 (soft-prune)
localStorage.setItem('srs_starred', JSON.stringify(['ul2755-1.1', 'nonexistent-q']));
const s = SrsStore.loadStarred();
console.assert(s.has('ul2755-1.1') && !s.has('nonexistent-q'));
console.assert(JSON.parse(localStorage.getItem('srs_starred')).length === 1);

// TC-I-054 (prune guard: do NOT wipe when questions not loaded)
const saved = State.questions;
State.questions = [];
localStorage.setItem('srs_starred', JSON.stringify(['ul2755-1.1']));
const s2 = SrsStore.loadStarred();
console.assert(s2.size === 1, 'empty State.questions must not trigger prune');
State.questions = saved;
```

- [ ] **Step 7.3: Commit**

```bash
git add app.js
git commit -m "SrsStore: add star bookmark API (load/save/toggle/isStarred/clear) + soft-prune orphan ids"
```

---

## Chunk 4: MCQ 答題卡右上 ⭐

### Task 8: CSS `.meta-star`

**Files:** Modify `index.html` (靠近 `.meta`/`.src` 的 CSS，約 line 29-31 附近)

- [ ] **Step 8.1: 在 `.src { color: #94a3b8; }` 之後新增：**

```css
  .meta { display: flex; justify-content: space-between; align-items: center; font-size: 0.78rem; margin-bottom: 0.7rem; gap: 0.5rem; }
  .meta-star { background: transparent; border: none; color: #94a3b8; font-size: 1.25rem; cursor: pointer; padding: 0 0.2rem; line-height: 1; flex: 0 0 auto; transition: transform 0.08s; }
  .meta-star:active { transform: scale(0.85); }
  .meta-star.on { color: #fbbf24; text-shadow: 0 0 6px rgba(251, 191, 36, 0.45); }
```

（注意：`.meta` 既有一條 CSS 在約 line 29；把現有那條改成上面這條 — 加上 `align-items: center` 和 `gap`，其他維持原樣。）

### Task 9: `window.toggleStarFromCard` handler

**Files:** Modify `app.js` (找 `window.restart` 附近放，約 line 215 之後)

- [ ] **Step 9.1: 加入全域函式：**

```js
window.toggleStarFromCard = (evt, qid) => {
  if (evt) evt.stopPropagation();
  const on = SrsStore.toggleStar(qid);
  const btn = evt && evt.currentTarget;
  if (btn) {
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
    btn.setAttribute('aria-label', on ? 'Unstar' : 'Star');
  }
};
```

### Task 10: `renderMCQ` 模板加入 `.meta-star`

**Files:** Modify `app.js:115-144` (renderMCQ template)

- [ ] **Step 10.1: 找到 `renderMCQ` 裡目前的這三行 `.meta` block：**

```js
    <div class="meta">
      <span class="tag">${q.category}</span>
      <span class="src">${q.source}</span>
    </div>
```

- [ ] **Step 10.2: 在 `$('#card').innerHTML = \`` 之前先抓一次星標狀態（避免模板多次呼叫 `isStarred` 重複 I/O + soft-prune 寫回）：**

```js
  const starOn = SrsStore.isStarred(q.id);
  const starTxt = starOn ? '★' : '☆';
  const starLbl = starOn ? 'Unstar' : 'Star';
```

- [ ] **Step 10.3: 把 Step 10.1 的三行替換為：**

```js
    <div class="meta">
      <span class="tag">${q.category}</span>
      <span class="src">${q.source}</span>
      <button class="meta-star${starOn ? ' on' : ''}" onclick="toggleStarFromCard(event, '${q.id}')" aria-label="${starLbl}">${starTxt}</button>
    </div>
```

（注意：`q.id` 目前格式像 `ul2755-1.1`、`fxx-door-2`，不含單引號；若未來 id 含 `'` 需另做 escape。本版不處理，但在 `docs/tests/...` 註明。）

- [ ] **Step 10.4: 手動驗證（TC-E-050）**
  - 進 Quiz → 看到某題右上 ☆
  - 按一下 → 變 ★（金色）
  - 不答題、直接 Next（按 Skip）→ 到下一題 → 返回首題（例如重新 Dashboard → Quiz 若排到同題）
  - 確認 ★ 仍然保持

- [ ] **Step 10.5: Commit**

```bash
git add index.html app.js
git commit -m "MCQ: add ⭐ toggle at top-right of card (visible before/during/after answer)"
```

---

## Chunk 5: Question List 的 ⭐ + 切換 bar

### Task 11: CSS — filter bar + row star

**Files:** Modify `index.html` (在 `.q-row .q-days.scheduled` 之後，約 line 148)

- [ ] **Step 11.1: 新增：**

```css
  .ql-filter-bar { display: flex; gap: 0.4rem; margin: 0.5rem 0 0.6rem; }
  .ql-filter-bar button { flex: 1; padding: 0.5rem 0.7rem; background: #1e293b; border: 1px solid #334155; color: #cbd5e1; border-radius: 8px; font-size: 0.9rem; font-weight: 600; cursor: pointer; }
  .ql-filter-bar button.active { background: #c8102e; border-color: #c8102e; color: white; }
  .ql-starred-actions { display: flex; gap: 0.4rem; margin-bottom: 0.6rem; }
  .ql-starred-actions .primary { margin-top: 0; flex: 1; }
  .q-row .star { background: transparent; border: none; color: #94a3b8; font-size: 1.1rem; cursor: pointer; padding: 0 0.3rem; flex: 0 0 auto; line-height: 1; }
  .q-row .star.on { color: #fbbf24; }
  .q-empty { padding: 1.5rem 1rem; text-align: center; color: #94a3b8; font-size: 0.95rem; border: 1px dashed #334155; border-radius: 10px; }
```

### Task 12: `window.toggleStarFromList` + `setQlFilter` + star-mode runners

**Files:** Modify `app.js` (靠近 `window.jumpToOffset` 約 line 1016 附近)

- [ ] **Step 12.1: 加入：**

```js
window.toggleStarFromList = (evt, qid) => {
  if (evt) evt.stopPropagation();
  const on = SrsStore.toggleStar(qid);
  // 若目前在「只看星標」而取消了星標 → 整頁重繪；否則就地切換該列 class
  if (State.qlFilter === 'starred' && !on) {
    renderQuestionList();
    return;
  }
  const row = evt && evt.currentTarget.closest('.q-row');
  if (row) {
    row.classList.toggle('starred', on);
    const btn = evt.currentTarget;
    btn.classList.toggle('on', on);
    btn.textContent = on ? '★' : '☆';
  }
};

window.setQlFilter = (which) => {
  State.qlFilter = which;
  renderQuestionList();
};

window.enterQuizStarred = () => {
  const starred = SrsStore.loadStarred();
  const ids = [...starred];
  if (!ids.length) return;
  State.order = ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'mcq';
  resetSession();
  renderMCQ();
};

window.enterRidingStarred = () => {
  const starred = SrsStore.loadStarred();
  const ids = [...starred];
  if (!ids.length) return;
  State.order = ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'audio';
  stopAudioCleanup();
  renderAudioIntro();
};
```

### Task 13: 改寫 `renderQuestionList`

**Files:** Modify `app.js:969-1014` (renderQuestionList)

**設計決策（明文化）**：星標模式**刻意隱藏** offset-bar（+1 / +3 / +7 …）。理由：offset-bar 幫助在數百題的完整清單中快速跳到某日期區段；星標清單通常 <50 題、容易捲，offset jump 意義不大。若未來星標變成百題規模再補。

- [ ] **Step 13.1a: State.qlFilter 初值 + 取資料 + `.ql-filter-bar` 區塊**

先把 `renderQuestionList` 最前面讀資料的部分替換成：

```js
function renderQuestionList() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const curr = SrsStore.loadCurriculum();
  const starred = SrsStore.loadStarred();
  const fullList = SRS.questionList(State.questions, state, Date.now(), curr);
  const filter = State.qlFilter || 'all';
  const list = filter === 'starred' ? fullList.filter(r => starred.has(r.id)) : fullList;
  const emptyStarred = filter === 'starred' && list.length === 0;

  const offsets = [0, 1, 3, 7, 30, 90, 180];
  const fmtMd = (ms) => {
    const d = new Date(ms);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  };
```

- [ ] **Step 13.1b: 替換 `#card.innerHTML` 模板（標題 + 切換 bar + 條件性 offset-bar + 空狀態 + 星標動作列）**

```js
  $('#card').innerHTML = `
    <div class="day-header">
      <h2 style="margin:0;color:#f8fafc;">Question List</h2>
      <div class="sub">${list.length} question${list.length === 1 ? '' : 's'}${filter === 'starred' ? ' starred' : ' · sorted by next review'}</div>
    </div>

    <div class="ql-filter-bar">
      <button class="${filter === 'all' ? 'active' : ''}" onclick="setQlFilter('all')">全部 ${fullList.length}</button>
      <button class="${filter === 'starred' ? 'active' : ''}" onclick="setQlFilter('starred')">⭐ 只看星標 ${starred.size}</button>
    </div>

    ${filter === 'starred' && list.length > 0 ? `
      <div class="ql-starred-actions">
        <button class="primary" onclick="enterQuizStarred()">📱 Quiz</button>
        <button class="primary" onclick="enterRidingStarred()">🏍️ Riding</button>
      </div>
    ` : ''}

    ${emptyStarred ? `
      <div class="q-empty">目前沒有星標題目。<br>到 MCQ 或題目列表按 ⭐ 標一些吧。</div>
    ` : ''}

    ${!emptyStarred && filter === 'all' ? `
      <div class="offset-bar" id="offsetBar">
        ${offsets.map(n => {
          const label = n === 0 ? 'Today' : `+${n}`;
          const matchIdx = list.findIndex(r => r.daysFromToday >= n);
          const disabled = matchIdx < 0;
          return `<button data-offset="${n}"${disabled ? ' disabled' : ''} onclick="jumpToOffset(${n})">${label}</button>`;
        }).join('')}
      </div>
    ` : ''}
```

- [ ] **Step 13.1c: 列模板（含 ⭐ 按鈕）**

接在 Step 13.1b 同一個模板字串後面（`</div>` 收尾前）：

```js
    <div class="q-list">
      ${list.map((r, i) => {
        let cls = '', label = '';
        if (r.scheduled) { cls = 'scheduled'; label = 'Scheduled'; }
        else if (r.daysFromToday < 0) { cls = 'overdue'; label = `Overdue ${-r.daysFromToday}d`; }
        else if (r.daysFromToday === 0) { cls = 'today'; label = 'Today'; }
        else { label = `+${r.daysFromToday} day${r.daysFromToday === 1 ? '' : 's'}`; }
        const on = starred.has(r.id);
        return `<div class="q-row${on ? ' starred' : ''}" id="qrow-${i}" data-days="${r.daysFromToday}" onclick="openQuestionFromList('${r.id}')">
          <span class="q-text">${r.text}</span>
          <span class="q-date">${fmtMd(r.scheduledDateMs)}</span>
          <span class="q-days ${cls}">${label}</span>
          <button class="star${on ? ' on' : ''}" onclick="toggleStarFromList(event, '${r.id}')" aria-label="${on ? 'Unstar' : 'Star'}">${on ? '★' : '☆'}</button>
        </div>`;
      }).join('')}
    </div>
  `;
  updateHeader();
}
```

這三步合起來就是完整 `renderQuestionList` 的新版。舊版整段刪除。

- [ ] **Step 13.2: 手動驗證（TC-E-051/052/053）**
  - Question List 預設顯示「全部」；頂部切換 bar 兩顆按鈕顯示總數。
  - 點任一列的 ⭐ → 變金色 ★；切到「⭐ 只看星標」→ 只看到已星標題。
  - 星標 ≥ 1 時「⭐ 只看星標」模式上方出現 `📱 Quiz` / `🏍️ Riding` 兩顆按鈕；按下分別進入 MCQ / Riding 且 State.order 只有星標題。
  - 在「只看星標」模式下取消某題星標 → 整頁重繪、該題消失。
  - 把所有星標取消 → 顯示空狀態文字，Quiz/Riding 按鈕隱藏。

- [ ] **Step 13.3: Commit**

```bash
git add index.html app.js
git commit -m "Question List: ⭐ per row + filter bar (全部 / ⭐) + starred-mode Quiz/Riding entries"
```

---

## Chunk 6: Settings 的 Clear stars + Reset 文案補字

### Task 14: Settings modal 加 `Clear stars` 按鈕

**Files:** Modify `index.html:178-191` (settingsModal)

- [ ] **Step 14.1: 在 `resetAllSrs` 按鈕之後、`closeSettings` 之前加入：**

```html
    <button class="ghost" onclick="clearAllStars()">Clear stars</button>
```

### Task 15: `window.clearAllStars` handler

**Files:** Modify `app.js` (靠近 `window.resetAllSrs` 約 line 1161)

- [ ] **Step 15.1: 加入：**

```js
window.clearAllStars = async () => {
  const count = SrsStore.loadStarred().size;
  if (count === 0) {
    await confirmDialog({
      title: 'No stars to clear',
      body: 'You have no starred questions yet.',
      actions: [{ label: 'OK', style: 'primary', value: null }],
    });
    return;
  }
  const choice = await confirmDialog({
    title: `Clear all ${count} star${count === 1 ? '' : 's'}?`,
    body: 'Learning records (SRS state) will be kept. Only the star marks are removed.',
    actions: [
      { label: 'Clear Stars', style: 'danger', value: 'yes' },
      { label: 'Cancel', style: 'ghost', value: null },
    ],
  });
  if (choice !== 'yes') return;
  SrsStore.clearStarred();
  closeSettings();
  renderDashboard();
};
```

### Task 16: `resetAllSrs` 文案補 `Stars kept`

**Files:** Modify `app.js:1161-1183` (resetAllSrs)

- [ ] **Step 16.1: 把 `body` 定義那行改成：**

```js
  const starCount = SrsStore.loadStarred().size;
  const body = `You'll lose:\n· ${answered} answered record${answered === 1 ? '' : 's'}\n· ${State.streak}-day streak\n· ${dayStr}\n\nStars kept (${starCount}) — use Clear stars to wipe.`;
```

**注意**（pre-existing quirk）：原本 `dayStr` 在 `curr` 為 null 時會是空字串，結果 body 產生一個空 bullet `· \n`；這不是本案新引入的 bug，但留意審視時不會誤以為是新壞掉。

- [ ] **Step 16.2: 手動驗證（TC-E-057/058）**
  - Settings → `Clear stars`：
    - 無星標時：顯示 "No stars to clear"。
    - 有 3 個星標時：顯示 "Clear all 3 stars?" + "Learning records ... will be kept"。
    - 按 Clear Stars → localStorage `srs_starred` 被 removeItem → 重進 Dashboard。
  - Settings → `Reset learning records` 的對話框內容包含 `Stars kept (N) — use Clear stars to wipe.`。

- [ ] **Step 16.3: Commit**

```bash
git add index.html app.js
git commit -m "Settings: add Clear stars action; Reset learning records dialog now mentions stars kept"
```

---

## Chunk 7: 回歸測試 + 測試報告 + push

### Task 17: 跑現有 110 個 TC-U-*** 單元測試

- [ ] **Step 17.1: 瀏覽器打開 `http://localhost:8000/srs.test.html`。確認最底部顯示「110 passed, 0 failed」（綠色）。**
  - 若有 fail：代表 srs.js 被意外污染，回去檢查。

**備註**：理想做法是**在 Chunk 3 完成時**就先起草 `docs/tests/2026-04-23-test-plan.md` 的 TC-I-050~054 段落、每 Chunk 完成就 tick 掉對應條目。本 Task 17/18 是最後保險，確保所有條目都被記錄。

### Task 18: 執行新 TC-I-*** / TC-E-*** 清單

**Files:** Create `docs/tests/2026-04-23-test-plan.md`

- [ ] **Step 18.1: 寫測試清單**

（照 spec §測試策略的 TC-I-050~053 + TC-E-050~058 列出，每條含：前置狀態、操作步驟、預期結果。完成時 commit。）

- [ ] **Step 18.2: 依清單逐條跑（preview_eval 或手動）**
  - TC-I-050 toggleStar round-trip
  - TC-I-051 corrupted JSON safe default
  - TC-I-052 MCQ ⭐ initial state from storage
  - TC-I-053 soft-prune orphan id
  - TC-I-054 empty `State.questions` 不觸發 prune（避免意外清空）
  - TC-E-050 MCQ 題目階段按 ⭐ → 重進題目仍為實心
  - TC-E-051 Question List 標兩題 → 「⭐ 只看」顯示 2 列 + 出現 Quiz/Riding
  - TC-E-052 星標模式按 Quiz → 進 MCQ 流程，State.order = 星標 idx
  - TC-E-053 星標全清空 → 空狀態 + Quiz/Riding 隱藏
  - TC-E-054 Riding 播答案階段 → `#audioExpl` 可見且含 explanation
  - TC-E-055 Calendar / Question List 無 `‹ Back`；Day / Date 頁仍有
  - TC-E-056 Round Complete 純資訊頁；無頁內按鈕
  - TC-E-057 Settings → Clear stars 清空 `srs_starred`
  - TC-E-058 Reset learning records 對話框含 `Stars kept`
  - **TC-M-020 (Manual on iPhone)** 在 Question List 手指點 ⭐ 不觸發列點擊（不會導到 Day 頁）。
  - **TC-M-021 (Manual on iPhone)** Riding 答案階段的 `#audioExpl` 在 375px 寬螢幕不破版、不溢出。

- [ ] **Step 18.3: 寫執行報告 `docs/tests/2026-04-23-test-run-report.md`，記錄 pass/fail、遇到的 bug、修復 commit。**

- [ ] **Step 18.4: Commit**

```bash
git add docs/tests/2026-04-23-test-plan.md docs/tests/2026-04-23-test-run-report.md
git commit -m "Test plan + run report for star/riding/back patch"
```

### Task 19: Push + 回報版號

- [ ] **Step 19.1: `git push` → 成功後讀 `version.json`，回傳格式如「已推出 v0.XX，三項變更...」。**

---

## 風險 / 回滾策略

- 每個 Chunk 一個獨立 commit，出包可用 `git revert <sha>` 精準回滾單一功能而不牽動其他。
- 若 Chunk 3（星標資料層）失敗：後續 Chunk 4/5/6 都會 fail fast（undefined `SrsStore.toggleStar`）；此時回滾 commit 即可。
- Riding explanation（Chunk 1）最無副作用；若其他 Chunk 都失敗，單 Chunk 1 仍可獨立交付。

---

## 快速檢查清單（完成時對照）

- [ ] Chunk 1: Riding 答案階段顯示 💡 explanation
- [ ] Chunk 2: Calendar/QuestionList/RoundComplete 無 `‹ Back`；Day/Date 仍有
- [ ] Chunk 3: SrsStore 星標 API + soft-prune
- [ ] Chunk 4: MCQ 卡右上 ⭐ toggle
- [ ] Chunk 5: Question List 每列 ⭐ + 切換 bar + 星標模式 Quiz/Riding
- [ ] Chunk 6: Settings Clear stars + Reset 文案
- [ ] Chunk 7: 110 個 TC-U 全過、TC-I/E 全過、測試報告、push、回報 v0.XX
