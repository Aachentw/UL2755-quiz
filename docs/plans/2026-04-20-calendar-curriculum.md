# Calendar + Curriculum + Day-Scoped Riding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans (tasks are highly coupled through `app.js` and `index.html`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fixed per-day curriculum, month calendar view, and read-only day study sheets to the UL2755 Sprint PWA, letting the user see projected completion date and tap any day to study or play it back.

**Architecture:** Curriculum is a pure function output (questions ordered by source → category → id, chunked by `new_per_day`) cached in localStorage. Calendar + Day page are new render functions in `app.js`; routing is a simple hash listener (no SPA framework). Quiz and Riding gain an optional "scoped deck" override when entered from a Day page. Settings changes trigger curriculum rebuild.

**Tech Stack:** Vanilla JS, localStorage, hash-based routing, existing SRS module from Phase A.

**Spec:** `docs/specs/2026-04-20-calendar-curriculum-design.md`

---

## File Structure

| File | Role |
|---|---|
| `srs.js` | Add pure functions: `buildCurriculum`, `getDayForQuestion`, `completedDays`. No DOM. |
| `srs.test.html` | Add 4 unit asserts for the new pure functions. |
| `app.js` | `SrsStore` gains curriculum helpers. Add `renderCalendar`, `renderDayPage`. Hash router dispatches `#home`, `#calendar`, `#day=N`. Quiz/Riding accept an optional `dayDeck` override. Settings save triggers `rebuildCurriculum`. |
| `index.html` | Add 📅 Calendar mode button; CSS for calendar grid, day-page question cards, SRS badges. |
| `sw.js` | Bump cache to `ul2755-v9`. |

No change to `questions.json` or `audio/*.mp3`.

---

## Chunk 1: Curriculum pure functions (Task 1)

### Task 1: `buildCurriculum`, `getDayForQuestion`, `completedDays`

**Files:**
- Modify: `srs.js`
- Modify: `srs.test.html`

- [ ] **Step 1.1: Add failing tests**

Append to `srs.test.html`'s script block, before the summary lines:

```js
// --- Phase B.1: Curriculum tests ---
const CURR_QS = [
  { id: 'ul2755-b',  source: 'UL2755 §6.2.3',  category: 'Transformers' },
  { id: 'ul2755-a',  source: 'UL2755 §6.1.6',  category: 'Electrical' },
  { id: 'nec646-a',  source: 'NEC §646.1',     category: 'Scope' },
  { id: 'fxx-a',     source: 'FXX Audit',      category: 'Workspace' },
  { id: 'ul2755-c',  source: 'UL2755 §6.4.2',  category: 'Wiring' },
];

assert('buildCurriculum: 5 Qs @ per_day 2 -> 3 days',
  (() => { const c = SRS.buildCurriculum(CURR_QS, 2, '2026-04-20');
    return c.days.length === 3 && c.days[0].question_ids.length === 2
      && c.days[2].question_ids.length === 1 && c.start_date === '2026-04-20'
      && c.built_from_new_per_day === 2; })(), null);

assert('buildCurriculum: ordering UL2755 -> NEC -> FXX, category alpha',
  (() => { const c = SRS.buildCurriculum(CURR_QS, 5, '2026-04-20');
    const ids = c.days[0].question_ids;
    // UL2755 categories alpha: Electrical, Transformers, Wiring
    // Then NEC: Scope. Then FXX: Workspace.
    return ids[0] === 'ul2755-a' && ids[1] === 'ul2755-b' && ids[2] === 'ul2755-c'
      && ids[3] === 'nec646-a' && ids[4] === 'fxx-a'; })(), null);

assert('getDayForQuestion: returns correct day number',
  (() => { const c = SRS.buildCurriculum(CURR_QS, 2, '2026-04-20');
    return SRS.getDayForQuestion(c, 'ul2755-c') === 2
      && SRS.getDayForQuestion(c, 'fxx-a') === 3
      && SRS.getDayForQuestion(c, 'missing') === null; })(), null);

assert('completedDays: a day with all Qs seen shows up as completed',
  (() => { const c = SRS.buildCurriculum(CURR_QS, 2, '2026-04-20');
    const state = {
      'ul2755-a': { stage: 'learning', total_seen: 1 },
      'ul2755-b': { stage: 'learning', total_seen: 1 },
      'ul2755-c': { stage: 'new', total_seen: 0 },  // stage new shouldn't count
    };
    const done = SRS.completedDays(c, state);
    return done.has(1) && !done.has(2) && !done.has(3); })(), null);
```

- [ ] **Step 1.2: Run tests**

Open `http://localhost:8000/srs.test.html`. Expected: 4 new asserts fail with "buildCurriculum is not a function".

- [ ] **Step 1.3: Implement the three functions**

In `srs.js`, before `return { ... };`:

```js
  function sourceGroupRank(source) {
    const s = (source || '').toUpperCase();
    if (s.startsWith('UL2755') || s.startsWith('UL 2755')) return 0;
    if (s.startsWith('NEC')) return 1;
    return 2; // FXX or anything else
  }

  function buildCurriculum(questions, newPerDay, startDateYmd) {
    const sorted = [...questions].sort((a, b) => {
      const ga = sourceGroupRank(a.source);
      const gb = sourceGroupRank(b.source);
      if (ga !== gb) return ga - gb;
      const ca = (a.category || '').toLowerCase();
      const cb = (b.category || '').toLowerCase();
      if (ca !== cb) return ca < cb ? -1 : 1;
      return (a.id || '') < (b.id || '') ? -1 : 1;
    });
    const days = [];
    for (let i = 0; i < sorted.length; i += newPerDay) {
      days.push({ day: days.length + 1, question_ids: sorted.slice(i, i + newPerDay).map(q => q.id) });
    }
    return { version: 1, start_date: startDateYmd, built_from_new_per_day: newPerDay, days };
  }

  function getDayForQuestion(curriculum, qId) {
    if (!curriculum || !curriculum.days) return null;
    for (const d of curriculum.days) {
      if (d.question_ids.includes(qId)) return d.day;
    }
    return null;
  }

  function completedDays(curriculum, state) {
    const done = new Set();
    if (!curriculum || !curriculum.days) return done;
    for (const d of curriculum.days) {
      const allSeen = d.question_ids.every(id => {
        const r = state[id];
        return r && (r.total_seen || 0) > 0 && r.stage !== 'new';
      });
      if (allSeen) done.add(d.day);
    }
    return done;
  }
```

Update the return line: `return { nextState, buildDeck, summary, migrate, buildCurriculum, getDayForQuestion, completedDays };`

- [ ] **Step 1.4: Verify all 23 pass**

Reload `srs.test.html`. Expected: 23 / 23.

- [ ] **Step 1.5: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: curriculum pure functions with 4 tests"
```

---

## Chunk 2: Storage helpers + boot (Task 2)

### Task 2: Curriculum storage and rebuild on settings change

**Files:**
- Modify: `app.js`

- [ ] **Step 2.1: Extend `SrsStore` in `app.js`**

After the existing `saveSettings` method in `SrsStore`:

```js
  loadCurriculum() { try { return JSON.parse(localStorage.getItem('srs_curriculum') || 'null'); } catch { return null; } },
  saveCurriculum(c) { localStorage.setItem('srs_curriculum', JSON.stringify(c)); },
  ensureCurriculum(questions, settings) {
    const existing = this.loadCurriculum();
    if (existing && existing.built_from_new_per_day === settings.new_per_day && existing.days.reduce((n, d) => n + d.question_ids.length, 0) === questions.length) {
      return existing;
    }
    const today = new Date().toISOString().slice(0, 10);
    const fresh = SRS.buildCurriculum(questions, settings.new_per_day, today);
    this.saveCurriculum(fresh);
    return fresh;
  },
```

- [ ] **Step 2.2: Call `ensureCurriculum` at boot**

In the `DOMContentLoaded` handler, right after `runMigration();`:

```js
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
```

- [ ] **Step 2.3: Trigger rebuild on settings save**

Modify `window.saveSettingsFromForm`. After `SrsStore.saveSettings(...)`, add:

```js
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
```

Also modify `window.resetAllSrs`. After the two `removeItem` calls, add:

```js
  localStorage.removeItem('srs_curriculum');
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
```

- [ ] **Step 2.4: Manual smoke test**

In preview console:

```js
localStorage.clear();
location.reload();
// After reload:
JSON.parse(localStorage.getItem('srs_curriculum')).days.length
// Expected: 3 (30 Qs @ new_per_day 10)
```

Then change new_per_day to 5 in Settings → Save → check again:

```js
JSON.parse(localStorage.getItem('srs_curriculum')).days.length
// Expected: 6
```

- [ ] **Step 2.5: Commit**

```bash
git add app.js
git commit -m "curriculum: ensure on boot and rebuild on settings change"
```

---

## Chunk 3: Hash routing + Calendar view (Tasks 3–4)

### Task 3: Hash routing

**Files:**
- Modify: `app.js`

- [ ] **Step 3.1: Add router at the bottom of `app.js` (before the closing of the file)**

```js
function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  if (hash === 'home') return renderDashboard();
  if (hash === 'calendar') return renderCalendar();
  const m = hash.match(/^day=(\d+)$/);
  if (m) return renderDayPage(parseInt(m[1], 10));
  renderDashboard();
}
window.addEventListener('hashchange', route);
```

- [ ] **Step 3.2: Replace the `setActive(); renderDashboard();` at bottom of DOMContentLoaded with `setActive(); route();`**

- [ ] **Step 3.3: Change `renderDashboard` so it does not force-clear the hash**

This is a no-op if you enter via hash. But update `.brand` click:

```js
$('.brand').addEventListener('click', () => { location.hash = 'home'; });
```

- [ ] **Step 3.4: Commit**

```bash
git add app.js
git commit -m "app: hash router for home/calendar/day"
```

---

### Task 4: Calendar mode button + month grid

**Files:**
- Modify: `index.html`
- Modify: `app.js`

- [ ] **Step 4.1: Add calendar button in `index.html`**

In the `.modes` div, add a fourth button after `#dueOnly`:

```html
  <button id="modeCal" style="flex:0 0 auto;">📅 Calendar</button>
```

- [ ] **Step 4.2: Add calendar styles at the bottom of the existing `<style>` block in `index.html`**

```css
.cal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.7rem; }
.cal-header button { background: #1e293b; border: 1px solid #334155; color: #e2e8f0; padding: 0.4rem 0.7rem; border-radius: 6px; cursor: pointer; }
.cal-title { font-size: 1.05rem; font-weight: 600; color: #f8fafc; }
.cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
.cal-dow { text-align: center; font-size: 0.75rem; color: #94a3b8; padding: 0.3rem 0; }
.cal-cell { aspect-ratio: 1; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 0.3rem 0.2rem 0.2rem; color: #cbd5e1; font-size: 0.85rem; display: flex; flex-direction: column; justify-content: space-between; cursor: pointer; overflow: hidden; }
.cal-cell .date { font-weight: 600; }
.cal-cell .badge { font-size: 0.68rem; color: #94a3b8; text-align: right; }
.cal-cell.empty { background: transparent; border-color: transparent; cursor: default; }
.cal-cell.today { background: #1e3a8a; border-color: #3b82f6; color: #dbeafe; }
.cal-cell.done { background: #064e3b; border-color: #10b981; color: #d1fae5; }
.cal-cell.slip { background: #78350f; border-color: #f59e0b; color: #fef3c7; }
.cal-cell:hover:not(.empty) { border-color: #60a5fa; }
```

- [ ] **Step 4.3: Add `renderCalendar` in `app.js`**

Add near the other render functions:

```js
function renderCalendar() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const curr = SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  const done = SRS.completedDays(curr, state);
  const firstIncomplete = curr.days.find(d => !done.has(d.day))?.day ?? null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const state_start = new Date(curr.start_date + 'T00:00:00');

  // Determine effective date for each day (shift skipped days forward to today)
  const dayEffectiveDate = {};
  let cursor = new Date(state_start);
  for (const d of curr.days) {
    if (done.has(d.day)) {
      dayEffectiveDate[d.day] = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    } else {
      // First incomplete day anchors to today; subsequent upcoming days flow from there
      if (d.day === firstIncomplete) {
        cursor = new Date(Math.max(cursor.getTime(), today.getTime()));
      }
      dayEffectiveDate[d.day] = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
    }
  }
  // Map effective date (yyyy-mm-dd) -> day number for cell lookup
  const ymd = (d) => d.toISOString().slice(0, 10);
  const dateToDay = {};
  for (const [dayNum, dt] of Object.entries(dayEffectiveDate)) {
    dateToDay[ymd(dt)] = parseInt(dayNum, 10);
  }

  // Default to the month containing today
  const viewMonth = State.calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  State.calMonth = viewMonth;

  const monthStart = new Date(viewMonth);
  const monthEnd = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0);
  const gridStart = new Date(monthStart);
  gridStart.setDate(gridStart.getDate() - monthStart.getDay()); // back to Sunday

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    const inMonth = d.getMonth() === viewMonth.getMonth();
    const key = ymd(d);
    const dayN = dateToDay[key];
    cells.push({ date: d, inMonth, dayN });
  }

  const monthLabel = viewMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  $('#card').innerHTML = `
    <div class="cal-header">
      <button onclick="calNav(-1)">‹</button>
      <span class="cal-title">${monthLabel}</span>
      <button onclick="calNav(1)">›</button>
    </div>
    <div class="cal-grid">
      ${['S','M','T','W','T','F','S'].map(d => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells.map(c => {
        if (!c.inMonth) return `<div class="cal-cell empty"></div>`;
        const day = curr.days.find(d => d.day === c.dayN);
        const isToday = ymd(c.date) === ymd(today);
        const isDone = day && done.has(day.day);
        const isSlipped = day && !isDone && c.date < today;
        const cls = ['cal-cell'];
        if (isDone) cls.push('done');
        else if (isToday && day) cls.push('today');
        else if (isSlipped) cls.push('slip');
        const badge = day ? `Day ${day.day} · ${day.question_ids.length}Q` : '';
        const clickAttr = day ? `onclick="location.hash='day=${day.day}'"` : '';
        return `<div class="${cls.join(' ')}" ${clickAttr}>
          <span class="date">${c.date.getDate()}</span>
          <span class="badge">${badge}</span>
        </div>`;
      }).join('')}
    </div>
  `;
  updateHeader();
}

window.calNav = (delta) => {
  const m = State.calMonth || new Date();
  State.calMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  renderCalendar();
};
```

- [ ] **Step 4.4: Wire button to navigate to `#calendar`**

In the `DOMContentLoaded` handler, add:

```js
  $('#modeCal').addEventListener('click', () => { location.hash = 'calendar'; });
```

- [ ] **Step 4.5: Manual test**

Reload. Click 📅 Calendar. Expected: current month grid with 3 cells (today and next 2 days) showing `Day 1 · 10Q`, `Day 2 · 10Q`, `Day 3 · 10Q`. Today's cell is blue.

- [ ] **Step 4.6: Commit**

```bash
git add app.js index.html
git commit -m "calendar: month grid with day cells and navigation"
```

---

## Chunk 4: Day page (Task 5)

### Task 5: Day page as read-only study sheet

**Files:**
- Modify: `app.js`
- Modify: `index.html`

- [ ] **Step 5.1: Add day-page CSS**

Append to `index.html` style block:

```css
.day-header { margin: 0.3rem 0 0.8rem; }
.day-header .sub { color: #94a3b8; font-size: 0.9rem; }
.day-card { background: #0f172a; border: 1px solid #334155; border-radius: 10px; padding: 0.9rem; margin: 0.6rem 0; }
.day-card .hdr { display: flex; justify-content: space-between; gap: 0.5rem; align-items: center; margin-bottom: 0.5rem; font-size: 0.8rem; color: #94a3b8; flex-wrap: wrap; }
.day-card .q { color: #f8fafc; margin: 0.4rem 0 0.5rem; line-height: 1.5; }
.day-card .ans { color: #6ee7b7; font-weight: 600; margin: 0.4rem 0; }
.day-card .expl { color: #cbd5e1; font-size: 0.9rem; line-height: 1.55; margin-top: 0.4rem; }
.day-actions { display: flex; gap: 0.5rem; margin-top: 1rem; flex-wrap: wrap; }
.day-actions button { flex: 1 1 140px; }
.sbadge { padding: 2px 7px; border-radius: 10px; font-size: 0.72rem; font-weight: 600; }
.sbadge.new { background: #1e293b; color: #cbd5e1; }
.sbadge.learning { background: #7c2d12; color: #fed7aa; }
.sbadge.review { background: #1e3a8a; color: #dbeafe; }
.sbadge.graduated { background: #064e3b; color: #6ee7b7; }
```

- [ ] **Step 5.2: Add `renderDayPage` in `app.js`**

```js
function renderDayPage(dayN) {
  stopAudioCleanup();
  const curr = SrsStore.loadCurriculum();
  if (!curr) { location.hash = 'home'; return; }
  const day = curr.days.find(d => d.day === dayN);
  if (!day) { location.hash = 'calendar'; return; }
  const state = SrsStore.loadState();
  const items = day.question_ids.map(id => ({ q: State.questions.find(qq => qq.id === id), r: state[id] })).filter(x => x.q);
  const graduated = items.filter(x => x.r && x.r.stage === 'graduated').length;

  function badge(r) {
    if (!r || r.stage === 'new') return `<span class="sbadge new">🆕 New</span>`;
    if (r.stage === 'learning') return `<span class="sbadge learning">📖 Learning</span>`;
    if (r.stage === 'review') return `<span class="sbadge review">🔁 Review (${r.consecutive_correct||0}/3)</span>`;
    if (r.stage === 'graduated') return `<span class="sbadge graduated">🎓 Graduated</span>`;
    return '';
  }

  const categories = [...new Set(items.map(x => x.q.category))].join(' · ');

  $('#card').innerHTML = `
    <div class="day-header">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;color:#f8fafc;">Day ${dayN}</h2>
        <button class="ghost" style="flex:0;padding:0.4rem 0.7rem;margin:0;" onclick="location.hash='calendar'">‹ Back</button>
      </div>
      <div class="sub">${categories}</div>
      <div class="sub">${items.length} questions · ${graduated} graduated · ${items.length - graduated} to go</div>
    </div>

    ${items.map(({ q, r }) => `
      <div class="day-card">
        <div class="hdr">
          <span>${q.category} · ${q.source}</span>
          ${badge(r)}
        </div>
        <div class="q">${q.question}</div>
        <div class="ans">✓ Answer: ${q.options[q.answer_index]}</div>
        <div class="expl">💡 ${q.explanation}</div>
      </div>
    `).join('')}

    <div class="day-actions">
      <button class="primary" onclick="enterRidingDay(${dayN})">🏍️ Riding this day</button>
      <button class="primary" onclick="enterQuizDay(${dayN})">📱 Quiz this day</button>
    </div>
  `;
  updateHeader();
}
```

- [ ] **Step 5.3: Smoke test**

Reload. Calendar → tap Day 1 cell. Expected: shows 10 cards, each with category / source / mastery badge / question / answer only (no A/B/C/D listed) / explanation. Two action buttons at the bottom.

- [ ] **Step 5.4: Commit**

```bash
git add app.js index.html
git commit -m "day-page: read-only study sheet with answers and badges"
```

---

## Chunk 5: Day-scoped Quiz/Riding + Dashboard projection (Task 6)

### Task 6: Entering modes from a day + projected completion

**Files:**
- Modify: `app.js`

- [ ] **Step 6.1: Add day-scoped enter functions**

```js
window.enterQuizDay = (dayN) => {
  const curr = SrsStore.loadCurriculum();
  const day = curr && curr.days.find(d => d.day === dayN);
  if (!day) return;
  State.order = day.question_ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'mcq';
  setActive();
  renderMCQ();
};

window.enterRidingDay = (dayN) => {
  const curr = SrsStore.loadCurriculum();
  const day = curr && curr.days.find(d => d.day === dayN);
  if (!day) return;
  State.order = day.question_ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'audio';
  setActive();
  stopAudioCleanup();
  renderAudioIntro();
};
```

- [ ] **Step 6.2: Update Dashboard to show projected completion**

In `renderDashboard`, after computing summary (`const s = SRS.summary(...)`), add:

```js
  const curr = SrsStore.ensureCurriculum(State.questions, settings);
  const doneDays = SRS.completedDays(curr, state);
  const totalDays = curr.days.length;
  const completedCount = doneDays.size;
  const remainingDays = totalDays - completedCount;
  const firstIncompleteDay = curr.days.find(d => !doneDays.has(d.day));
  const projDate = new Date();
  projDate.setDate(projDate.getDate() + Math.max(0, remainingDays - 1));
  const projStr = projDate.toISOString().slice(0, 10);
  const plannedEnd = new Date(curr.start_date + 'T00:00:00');
  plannedEnd.setDate(plannedEnd.getDate() + totalDays - 1);
  const behind = Math.floor((projDate - plannedEnd) / (24*60*60*1000));
  const badge = behind > 0 ? ` (${behind} day${behind>1?'s':''} behind)` : ' (on track)';
```

Then in the dashboard HTML template, insert above the `<h2>Today</h2>`:

```js
      <div class="muted" style="margin-bottom:0.4rem;">
        Projected: <b>${projStr}</b>${badge}<br>
        Day ${firstIncompleteDay ? firstIncompleteDay.day : totalDays} of ${totalDays} · Started ${curr.start_date}
      </div>
```

- [ ] **Step 6.3: Smoke test**

Reload. Dashboard now shows `Projected: YYYY-MM-DD (on track)`. Go to Calendar → tap Day 1 → Quiz → answer 10 → back to Dashboard → Day 2 of 3 shown, completion date pulls in by one day.

- [ ] **Step 6.4: Commit**

```bash
git add app.js
git commit -m "dashboard: projected completion + day-scoped mode entries"
```

---

## Chunk 6: Service worker + deploy (Task 7)

### Task 7: Bump SW cache and deploy

**Files:**
- Modify: `sw.js`

- [ ] **Step 7.1: Bump cache version**

Change `const CACHE = 'ul2755-v8';` to `const CACHE = 'ul2755-v9';`

- [ ] **Step 7.2: Commit + push**

```bash
git add sw.js
git commit -m "sw: bump cache to v9 for calendar/curriculum release"
git push
```

- [ ] **Step 7.3: Production smoke test**

On phone, after clearing cache:
1. `https://aachentw.github.io/UL2755-quiz/` → Dashboard shows `Day 1 of 3` and projected date.
2. 📅 Calendar → current month, 3 cells highlighted (today + next 2 days).
3. Tap Day 1 → study sheet with 10 cards, answers visible, no options listed.
4. Tap `📱 Quiz this day` → Quiz starts with Day 1's 10 questions.
5. Complete a day → Calendar shows it green next visit.
6. Tap a future day (偷跑) → Day page loads; Quiz from there also works.
7. Tap `🏍️ Riding this day` → plays all 10 audios in sequence.

---

## Verification of completion

- [ ] 23 / 23 unit asserts pass in `srs.test.html`.
- [ ] `#home`, `#calendar`, `#day=N` routes work; browser back button works.
- [ ] Calendar month nav works (prev/next).
- [ ] Day page shows only the correct answer text (no A–D option list).
- [ ] Riding from a day plays all the day's MP3s (not random SRS deck, not filtered by graduation).
- [ ] Changing `new_per_day` in Settings rebuilds curriculum and resets `start_date`.
- [ ] Projected completion date is visible on Dashboard and updates as days complete.
- [ ] Pushed commit is live at `https://aachentw.github.io/UL2755-quiz/`.
