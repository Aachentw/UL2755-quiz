# Question List Page Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans (tasks coupled in app.js + index.html). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a flat, sorted Question List page with SM-2 offset jump buttons, accessible from Dashboard.

**Architecture:** New pure `SRS.questionList()` in srs.js. New `renderQuestionList()` in app.js rendering a sticky offset-bar + two-column rows. Route `#list`. Dashboard button between Calendar and Settings.

**Spec:** `docs/specs/2026-04-22-question-list-page-design.md`

---

## File Structure

| File | Role |
|---|---|
| `srs.js` | Add pure `questionList` (sort by due date, compute daysFromToday). |
| `srs.test.html` | +3 unit tests. |
| `app.js` | Add `renderQuestionList`, router entry, Dashboard button, offset-jump handler. |
| `index.html` | Add CSS for `.q-list`, `.q-row`, `.offset-bar`. |
| `sw.js` | Bump cache to `ul2755-v15`. |

---

## Task 1: `SRS.questionList` pure function

**Files:** Modify `srs.js`, `srs.test.html`

- [ ] **Step 1.1: Add failing tests in `srs.test.html`** (before summary block)

```js
// --- Question list pure function ---
const QL_QS = [
  { id: 'a', question: 'A'.repeat(50), category: 'X', source: 'UL2755' },
  { id: 'b', question: 'B long', category: 'Y', source: 'UL2755' },
  { id: 'c', question: 'C', category: 'Z', source: 'NEC' },
];

assert('TC-U-048 questionList sorts by dueAt ascending',
  (() => {
    const tNow = 1700000000000;
    const DAY = 86400000;
    const state = {
      a: { stage: 'review', due_at: tNow + 2*DAY, interval_minutes: 4320, consecutive_correct: 1, total_seen: 2, total_correct: 2 },
      c: { stage: 'learning', due_at: tNow + 10*DAY, interval_minutes: 14400, consecutive_correct: 0, total_seen: 1, total_correct: 1 },
      // b unseen -> due "now"
    };
    const list = SRS.questionList(QL_QS, state, tNow);
    return list.length === 3 && list[0].id === 'b' && list[1].id === 'a' && list[2].id === 'c'
      && list[0].daysFromToday === 0 && list[1].daysFromToday === 2 && list[2].daysFromToday === 10;
  })(), null);

assert('TC-U-049 questionList overdue returns negative daysFromToday',
  (() => {
    const tNow = 1700000000000;
    const state = { a: { stage: 'review', due_at: tNow - 3*86400000, interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 } };
    const list = SRS.questionList(QL_QS.slice(0,1), state, tNow);
    return list[0].daysFromToday === -3;
  })(), null);

assert('TC-U-050 questionList empty state -> all daysFromToday 0',
  (() => {
    const list = SRS.questionList(QL_QS, {}, 1700000000000);
    return list.length === 3 && list.every(x => x.daysFromToday === 0);
  })(), null);
```

- [ ] **Step 1.2: Add `questionList` to `srs.js`** (inside the IIFE, before `return`)

```js
  function questionList(questions, state, nowMs) {
    const DAY = 86400000;
    const startToday = (() => { const d = new Date(nowMs); d.setHours(0,0,0,0); return d.getTime(); })();
    const rows = questions.map(q => {
      const r = state[q.id];
      const dueAt = r && r.due_at != null ? r.due_at : nowMs;
      const daysFromToday = Math.floor((dueAt - startToday) / DAY);
      return {
        id: q.id,
        text: (q.question || '').slice(0, 40) + ((q.question || '').length > 40 ? '…' : ''),
        dueAtMs: dueAt,
        daysFromToday,
      };
    });
    rows.sort((a, b) => a.dueAtMs - b.dueAtMs);
    return rows;
  }
```

Update exports: `return { ..., questionList };`

- [ ] **Step 1.3: Run srs.test.html, verify 50/50 pass**

- [ ] **Step 1.4: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: questionList pure function (3 tests, 50/50 total)"
```

---

## Task 2: Route + Dashboard button

**Files:** Modify `app.js`

- [ ] **Step 2.1: Add `#list` route**

In `route()` function:

```js
  if (hash === 'list') return renderQuestionList();
```

(Place before the `day=` matcher.)

- [ ] **Step 2.2: Add Dashboard button**

In `renderDashboard()`'s `.dash-actions` div, between Calendar and Settings:

```html
        <button class="ghost" onclick="location.hash='list'">📋 Question List</button>
```

- [ ] **Step 2.3: Commit (feature incomplete but still builds)**

Note: `renderQuestionList` not defined yet; the button / route will no-op until Task 3. That's OK — we'll commit together at Task 3.

---

## Task 3: `renderQuestionList` + offset-bar + row click

**Files:** Modify `app.js`, `index.html`

- [ ] **Step 3.1: CSS in `index.html`** (inside `<style>` block)

```css
.q-list { display: flex; flex-direction: column; gap: 0.3rem; margin-top: 0.5rem; }
.q-row { display: flex; justify-content: space-between; align-items: center; gap: 0.6rem; background: #0f172a; border: 1px solid #334155; border-radius: 8px; padding: 0.7rem 0.9rem; cursor: pointer; transition: border-color 0.15s; }
.q-row:hover { border-color: #3b82f6; }
.q-row .q-text { color: #f1f5f9; font-size: 0.92rem; line-height: 1.4; min-width: 0; flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.q-row .q-days { color: #94a3b8; font-size: 0.8rem; font-weight: 600; white-space: nowrap; }
.q-row .q-days.overdue { color: #f87171; }
.q-row .q-days.today { color: #6ee7b7; }
.offset-bar { position: sticky; top: 0; background: #0f172a; padding: 0.5rem 0; display: flex; gap: 0.3rem; overflow-x: auto; margin-bottom: 0.4rem; z-index: 5; }
.offset-bar button { flex: 0 0 auto; background: #1e293b; border: 1px solid #334155; color: #cbd5e1; padding: 0.35rem 0.75rem; border-radius: 6px; font-size: 0.85rem; font-weight: 600; cursor: pointer; white-space: nowrap; }
.offset-bar button.active { background: #c8102e; border-color: #c8102e; color: white; }
.offset-bar button:disabled { opacity: 0.35; cursor: not-allowed; }
```

- [ ] **Step 3.2: Add `renderQuestionList()` in `app.js`** (near other render functions)

```js
function renderQuestionList() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const list = SRS.questionList(State.questions, state, Date.now());
  const curr = SrsStore.loadCurriculum();
  const offsets = [0, 1, 3, 7, 30, 90, 180];

  $('#card').innerHTML = `
    <div class="day-header">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;color:#f8fafc;">Question List</h2>
        <button class="ghost" style="flex:0;padding:0.4rem 0.7rem;margin:0;" onclick="location.hash='home'">‹ Back</button>
      </div>
      <div class="sub">${list.length} questions · sorted by next review</div>
    </div>

    <div class="offset-bar" id="offsetBar">
      ${offsets.map(n => {
        const label = n === 0 ? 'Today' : `+${n}`;
        const matchIdx = list.findIndex(r => r.daysFromToday >= n);
        const disabled = matchIdx < 0;
        return `<button data-offset="${n}"${disabled ? ' disabled' : ''} onclick="jumpToOffset(${n})">${label}</button>`;
      }).join('')}
    </div>

    <div class="q-list">
      ${list.map((r, i) => {
        const cls = r.daysFromToday < 0 ? 'overdue' : (r.daysFromToday === 0 ? 'today' : '');
        const label = r.daysFromToday < 0
          ? `Overdue ${-r.daysFromToday}d`
          : r.daysFromToday === 0 ? 'Today' : `+${r.daysFromToday} day${r.daysFromToday === 1 ? '' : 's'}`;
        return `<div class="q-row" id="qrow-${i}" data-days="${r.daysFromToday}" onclick="openQuestionFromList('${r.id}')">
          <span class="q-text">${r.text}</span>
          <span class="q-days ${cls}">${label}</span>
        </div>`;
      }).join('')}
    </div>
  `;
  updateHeader();
}

window.jumpToOffset = (n) => {
  // Find first row with daysFromToday >= n and scroll it into view
  const rows = [...document.querySelectorAll('.q-row')];
  const target = rows.find(el => parseInt(el.dataset.days, 10) >= n);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  // Highlight active offset button
  document.querySelectorAll('#offsetBar button').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.offset, 10) === n);
  });
};

window.openQuestionFromList = (qId) => {
  const curr = SrsStore.loadCurriculum();
  const dayN = SRS.getDayForQuestion(curr, qId);
  if (dayN != null) location.hash = 'day=' + dayN;
};
```

- [ ] **Step 3.3: Smoke test via preview**

1. Open Dashboard → click `📋 Question List`.
2. Expect N rows (N = total questions).
3. Click `+3` → scrolls to first +3 or later row.
4. Click a row → navigates to that question's Day page.

- [ ] **Step 3.4: Commit**

```bash
git add app.js index.html
git commit -m "Question List: page with offset-jump buttons + row click routing"
```

---

## Task 4: SW bump + push

**Files:** Modify `sw.js`

- [ ] **Step 4.1**: `const CACHE = 'ul2755-v15';`

- [ ] **Step 4.2**: Add srs.js is already in SHELL — no change needed.

- [ ] **Step 4.3**: `git add -A && git commit -m "sw: bump to v15 for question list release" && git push`

---

## Task 5: E2E verification via preview_eval

Run TC-E-035~038:

- **TC-E-035** Dashboard has `📋 Question List` button between Calendar and Settings; clicking sets `location.hash === '#list'`.
- **TC-E-036** List renders exactly `State.questions.length` `.q-row` elements.
- **TC-E-037** Click `+3` button → first row with `data-days >= 3` has `active` class set on the +3 button; scroll happens.
- **TC-E-038** Click a row → `location.hash` becomes `#day=N` for that question.

---

## Verification of completion

- [ ] 50/50 unit pass
- [ ] 4 new E2E pass
- [ ] No regression: 106 existing E2E still pass sample
- [ ] Pushed and visible at `https://aachentw.github.io/UL2755-quiz/#list`
- [ ] Live version reported to user
