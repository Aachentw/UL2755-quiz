# SRS + Mastery Tracking Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add spaced-repetition scheduling and strict 3-consecutive-correct mastery tracking to the UL2755 Sprint PWA, plus a dashboard home view and a minimal settings page.

**Architecture:** A pure-function module `srs.js` owns state transitions and deck composition with no DOM access; `app.js` wires the UI to it. State lives in two `localStorage` keys (`srs_state`, `srs_settings`) plus a per-day counter. A one-shot migration seeds records from the legacy `answered` / `wrongPool` keys on first run of the new version.

**Tech Stack:** Vanilla JavaScript, `localStorage`, HTML assertions for unit tests (no build step, no framework).

**Spec:** `docs/specs/2026-04-20-srs-mastery-tracking-design.md`

---

## File Structure

| File | Role |
|---|---|
| `srs.js` (new) | Pure functions: `nextState`, `buildDeck`, `summary`, `migrate`. No DOM. |
| `srs.test.html` (new) | Minimal DOM-assert test runner that loads `srs.js` and prints pass/fail. |
| `app.js` | Wire Quiz answers through `srs.nextState`; build deck per mode entry; render dashboard; settings modal; legacy migration on load. |
| `index.html` | Add dashboard container and settings modal markup; link `srs.js`. |
| `sw.js` | Bump cache version; add `srs.js` to shell. |

No change to `questions.json` or `audio/*.mp3`.

---

## Constants (shared)

Put these at the top of `srs.js`. Referenced throughout the plan:

```js
const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
const LEARNING_MIN = 10 * MIN;
const REVIEW_INTERVALS_MIN = [1 * DAY, 3 * DAY, 7 * DAY];       // review progression
const GRADUATED_INTERVALS_MIN = [30 * DAY, 90 * DAY, 180 * DAY]; // post-graduation
const GRADUATION_CONSECUTIVE = 3;
const LS_STATE = 'srs_state';
const LS_SETTINGS = 'srs_settings';
const LS_NEW_TODAY = 'srs_new_today';
const DEFAULT_SETTINGS = { new_per_day: 10, session_cap: null, order: 'reviews_first' };
```

---

## Chunk 1: Pure SRS module (tasks 1–4)

### Task 1: `nextState` — new/learning transitions

**Files:**
- Create: `srs.js`
- Create: `srs.test.html`

- [ ] **Step 1.1: Write the failing test**

Create `srs.test.html`:

```html
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>SRS Tests</title>
<style>body{font-family:monospace;padding:1rem;background:#0f172a;color:#f1f5f9}
.ok{color:#10b981}.fail{color:#ef4444;font-weight:700}
pre{background:#1e293b;padding:0.5rem;border-radius:4px;margin:0.3rem 0}</style>
</head><body>
<h1>SRS Unit Tests</h1><div id="out"></div>
<script src="srs.js"></script>
<script>
const out = document.getElementById('out');
let pass = 0, fail = 0;
function assert(name, cond, detail) {
  const div = document.createElement('div');
  div.className = cond ? 'ok' : 'fail';
  div.textContent = (cond ? '✅ ' : '❌ ') + name + (cond ? '' : ' → ' + JSON.stringify(detail));
  out.appendChild(div);
  cond ? pass++ : fail++;
}
function eq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

const t0 = 1_700_000_000_000;

// --- Task 1 tests ---
assert('new → correct → learning with +10min',
  (() => { const s = SRS.nextState(null, true, t0); return s.stage === 'learning' && s.due_at === t0 + 10*60*1000; })(),
  SRS.nextState(null, true, t0));

assert('new → wrong → still new (no advancement)',
  (() => { const s = SRS.nextState(null, false, t0); return s.stage === 'new' && s.consecutive_correct === 0; })(),
  SRS.nextState(null, false, t0));

assert('learning → correct → review 1 day',
  (() => { const start = { stage: 'learning', consecutive_correct: 0, interval_minutes: 10, total_seen: 1, total_correct: 1 };
    const s = SRS.nextState(start, true, t0); return s.stage === 'review' && s.interval_minutes === 1440; })(),
  null);

assert('learning → wrong → stays learning, +10min',
  (() => { const start = { stage: 'learning', consecutive_correct: 0, interval_minutes: 10 };
    const s = SRS.nextState(start, false, t0); return s.stage === 'learning' && s.due_at === t0 + 10*60*1000; })(),
  null);

const summary = document.createElement('h2');
summary.textContent = `${pass} passed, ${fail} failed`;
summary.style.color = fail ? '#ef4444' : '#10b981';
out.appendChild(summary);
</script></body></html>
```

- [ ] **Step 1.2: Run test to verify it fails**

Open `http://localhost:8000/srs.test.html`. Expected: all 4 assertions fail with "SRS is not defined".

- [ ] **Step 1.3: Write minimal implementation**

Create `srs.js`:

```js
const SRS = (() => {
  const MIN = 60 * 1000;
  const DAY = 24 * 60 * MIN;
  const LEARNING_MIN = 10 * MIN;
  const REVIEW_INTERVALS_MIN = [1 * DAY, 3 * DAY, 7 * DAY];
  const GRADUATED_INTERVALS_MIN = [30 * DAY, 90 * DAY, 180 * DAY];
  const GRADUATION_CONSECUTIVE = 3;

  function minutesOf(ms) { return Math.round(ms / MIN); }

  function nextState(record, correct, now) {
    const r = record || { stage: 'new', consecutive_correct: 0, interval_minutes: 0, total_seen: 0, total_correct: 0 };
    const next = { ...r };
    next.total_seen = r.total_seen + 1;
    if (correct) next.total_correct = r.total_correct + 1;
    next.last_answered_at = now;

    if (r.stage === 'new') {
      if (correct) { next.stage = 'learning'; next.due_at = now + LEARNING_MIN; next.interval_minutes = minutesOf(LEARNING_MIN); }
      else { next.stage = 'new'; next.consecutive_correct = 0; }
      return next;
    }

    if (r.stage === 'learning') {
      if (correct) { next.stage = 'review'; next.due_at = now + REVIEW_INTERVALS_MIN[0]; next.interval_minutes = minutesOf(REVIEW_INTERVALS_MIN[0]); next.consecutive_correct = 1; }
      else { next.stage = 'learning'; next.due_at = now + LEARNING_MIN; next.interval_minutes = minutesOf(LEARNING_MIN); next.consecutive_correct = 0; }
      return next;
    }

    // review / graduated branches added in Task 2
    return next;
  }

  return { nextState };
})();
```

- [ ] **Step 1.4: Run tests, verify pass**

Reload `srs.test.html`. Expected: 4 / 4 pass.

- [ ] **Step 1.5: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: nextState for new and learning stages with tests"
```

---

### Task 2: `nextState` — review → graduated; graduated → relearn

**Files:**
- Modify: `srs.js`
- Modify: `srs.test.html`

- [ ] **Step 2.1: Add failing tests**

Append to the `<script>` block before the summary lines:

```js
// --- Task 2 tests ---
const rev = (cc, iv) => ({ stage: 'review', consecutive_correct: cc, interval_minutes: iv, total_seen: 5, total_correct: 5 });

assert('review cc=0 iv=1d → correct → review cc=1 iv=3d',
  (() => { const s = SRS.nextState(rev(0, 1440), true, t0); return s.stage === 'review' && s.interval_minutes === 4320 && s.consecutive_correct === 1; })(),
  null);

assert('review cc=1 iv=3d → correct → review cc=2 iv=7d',
  (() => { const s = SRS.nextState(rev(1, 4320), true, t0); return s.stage === 'review' && s.interval_minutes === 10080 && s.consecutive_correct === 2; })(),
  null);

assert('review cc=2 iv=7d → correct → graduated cc=3 iv=30d',
  (() => { const s = SRS.nextState(rev(2, 10080), true, t0); return s.stage === 'graduated' && s.consecutive_correct === 3 && s.interval_minutes === 43200; })(),
  null);

assert('review → wrong → learning +10min, cc reset',
  (() => { const s = SRS.nextState(rev(2, 10080), false, t0); return s.stage === 'learning' && s.consecutive_correct === 0 && s.interval_minutes === 10; })(),
  null);

assert('graduated 30d → correct → graduated 90d',
  (() => { const s = SRS.nextState({ stage: 'graduated', consecutive_correct: 3, interval_minutes: 43200, total_seen: 10, total_correct: 10 }, true, t0);
    return s.stage === 'graduated' && s.interval_minutes === 129600; })(), null);

assert('graduated 180d → correct → stays 180d (capped)',
  (() => { const s = SRS.nextState({ stage: 'graduated', consecutive_correct: 3, interval_minutes: 259200, total_seen: 20, total_correct: 20 }, true, t0);
    return s.stage === 'graduated' && s.interval_minutes === 259200; })(), null);

assert('graduated → wrong → review +1d, cc reset',
  (() => { const s = SRS.nextState({ stage: 'graduated', consecutive_correct: 3, interval_minutes: 43200, total_seen: 10, total_correct: 9 }, false, t0);
    return s.stage === 'review' && s.consecutive_correct === 0 && s.interval_minutes === 1440; })(), null);
```

- [ ] **Step 2.2: Run tests, verify new ones fail**

Reload `srs.test.html`. Expected: first 4 pass, new 7 fail.

- [ ] **Step 2.3: Extend `nextState`**

Replace the `// review / graduated branches added in Task 2` line and `return next` with:

```js
    if (r.stage === 'review') {
      if (correct) {
        const nextCC = r.consecutive_correct + 1;
        if (nextCC >= GRADUATION_CONSECUTIVE) {
          next.stage = 'graduated';
          next.consecutive_correct = GRADUATION_CONSECUTIVE;
          next.interval_minutes = minutesOf(GRADUATED_INTERVALS_MIN[0]);
          next.due_at = now + GRADUATED_INTERVALS_MIN[0];
        } else {
          const idx = Math.min(nextCC, REVIEW_INTERVALS_MIN.length - 1);
          next.stage = 'review';
          next.consecutive_correct = nextCC;
          next.interval_minutes = minutesOf(REVIEW_INTERVALS_MIN[idx]);
          next.due_at = now + REVIEW_INTERVALS_MIN[idx];
        }
      } else {
        next.stage = 'learning';
        next.consecutive_correct = 0;
        next.interval_minutes = minutesOf(LEARNING_MIN);
        next.due_at = now + LEARNING_MIN;
      }
      return next;
    }

    if (r.stage === 'graduated') {
      if (correct) {
        const currentIdx = GRADUATED_INTERVALS_MIN.indexOf(r.interval_minutes * MIN);
        const nextIdx = Math.min(currentIdx + 1, GRADUATED_INTERVALS_MIN.length - 1);
        next.stage = 'graduated';
        next.interval_minutes = minutesOf(GRADUATED_INTERVALS_MIN[nextIdx]);
        next.due_at = now + GRADUATED_INTERVALS_MIN[nextIdx];
      } else {
        next.stage = 'review';
        next.consecutive_correct = 0;
        next.interval_minutes = minutesOf(REVIEW_INTERVALS_MIN[0]);
        next.due_at = now + REVIEW_INTERVALS_MIN[0];
      }
      return next;
    }

    return next;
```

- [ ] **Step 2.4: Verify all 11 pass**

Reload. Expected: 11 / 11.

- [ ] **Step 2.5: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: review and graduated stage transitions"
```

---

### Task 3: `buildDeck` — reviews first, new injection

**Files:**
- Modify: `srs.js`
- Modify: `srs.test.html`

- [ ] **Step 3.1: Add failing tests**

Append before summary:

```js
// --- Task 3 tests ---
const QS = Array.from({ length: 5 }, (_, i) => ({ id: `q${i+1}` }));

assert('empty state: all 5 become new, new_per_day caps at 2',
  (() => { const deck = SRS.buildDeck({}, QS, { new_per_day: 2, session_cap: null, order: 'reviews_first' }, t0, 0);
    return deck.length === 2 && deck[0].id === 'q1'; })(), null);

assert('2 due reviews + 3 new available, cap 1 new → 3 in deck (reviews first)',
  (() => {
    const state = { q1: { stage: 'review', due_at: t0 - 1000, interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 },
                    q2: { stage: 'review', due_at: t0 - 500,  interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 } };
    const deck = SRS.buildDeck(state, QS, { new_per_day: 1, session_cap: null, order: 'reviews_first' }, t0, 0);
    return deck.length === 3 && deck[0].id === 'q1' && deck[1].id === 'q2' && deck[2].id === 'q3'; })(), null);

assert('session_cap truncates deck tail',
  (() => { const deck = SRS.buildDeck({}, QS, { new_per_day: 5, session_cap: 3, order: 'reviews_first' }, t0, 0);
    return deck.length === 3; })(), null);

assert('new_taken_today respected: 2 already taken + cap 3 → 1 new slot left',
  (() => { const deck = SRS.buildDeck({}, QS, { new_per_day: 3, session_cap: null, order: 'reviews_first' }, t0, 2);
    return deck.length === 1; })(), null);

assert('non-due review not included',
  (() => { const state = { q1: { stage: 'review', due_at: t0 + 1000, interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 } };
    const deck = SRS.buildDeck(state, QS, { new_per_day: 0, session_cap: null, order: 'reviews_first' }, t0, 0);
    return deck.length === 0; })(), null);
```

- [ ] **Step 3.2: Run tests, verify fail**

Expected: 5 new asserts fail with "buildDeck is not a function".

- [ ] **Step 3.3: Implement `buildDeck`**

Inside the IIFE, before `return { nextState }`:

```js
  function buildDeck(state, questions, settings, now, newTakenToday) {
    const due = [];
    const unseen = [];
    for (const q of questions) {
      const r = state[q.id];
      if (!r) { unseen.push(q); continue; }
      if (r.due_at != null && r.due_at <= now) due.push(q);
    }
    const newRemaining = Math.max(0, (settings.new_per_day || 0) - (newTakenToday || 0));
    const newInjection = unseen.slice(0, newRemaining);

    let deck = settings.order === 'reviews_first'
      ? [...due, ...newInjection]
      : [...due, ...newInjection]; // only reviews_first supported this phase

    if (settings.session_cap != null) deck = deck.slice(0, settings.session_cap);
    return deck;
  }
```

Update the return line to: `return { nextState, buildDeck };`

- [ ] **Step 3.4: Verify all 16 pass**

Reload. Expected: 16 / 16.

- [ ] **Step 3.5: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: buildDeck reviews-first with new quota"
```

---

### Task 4: `summary` and `migrate`

**Files:**
- Modify: `srs.js`
- Modify: `srs.test.html`

- [ ] **Step 4.1: Add failing tests**

```js
// --- Task 4 tests ---
assert('summary counts by stage',
  (() => { const state = {
      q1: { stage: 'review', due_at: t0 - 1, interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 },
      q2: { stage: 'review', due_at: t0 + 1e9, interval_minutes: 1440, consecutive_correct: 1, total_seen: 1, total_correct: 1 },
      q3: { stage: 'graduated', due_at: t0 + 1e12, interval_minutes: 43200, consecutive_correct: 3, total_seen: 5, total_correct: 5 },
      q4: { stage: 'learning', due_at: t0 - 1, interval_minutes: 10, consecutive_correct: 0, total_seen: 2, total_correct: 0 },
    };
    const s = SRS.summary(state, QS, t0);
    return s.due === 2 && s.new === 1 && s.graduated === 1 && s.learning === 1 && s.review === 2;
  })(), null);

assert('migrate: answered correct → learning +10min, wrongPool → learning +10min',
  (() => {
    const seeded = SRS.migrate({ q1: { correct: true, picked: 0 }, q2: { correct: false, picked: 1 } }, ['q2'], t0);
    return seeded.q1.stage === 'learning' && seeded.q1.due_at === t0 + 10*60*1000
        && seeded.q2.stage === 'learning' && seeded.q2.due_at === t0 + 10*60*1000;
  })(), null);

assert('migrate: empty inputs → empty state',
  (() => { const seeded = SRS.migrate({}, [], t0); return Object.keys(seeded).length === 0; })(), null);
```

- [ ] **Step 4.2: Implement**

```js
  function summary(state, questions, now) {
    const counts = { new: 0, learning: 0, review: 0, graduated: 0, due: 0 };
    for (const q of questions) {
      const r = state[q.id];
      if (!r) { counts.new++; counts.due++; continue; }
      counts[r.stage] = (counts[r.stage] || 0) + 1;
      if (r.stage !== 'graduated' && r.due_at != null && r.due_at <= now) counts.due++;
      if (r.stage === 'graduated' && r.due_at != null && r.due_at <= now) counts.due++;
    }
    return counts;
  }

  function migrate(legacyAnswered, legacyWrongPool, now) {
    const state = {};
    const base = { stage: 'learning', consecutive_correct: 0, interval_minutes: 10,
      total_seen: 1, total_correct: 0, due_at: now + LEARNING_MIN, last_answered_at: now };
    for (const [id, a] of Object.entries(legacyAnswered || {})) {
      state[id] = { ...base, total_correct: a.correct ? 1 : 0 };
    }
    for (const id of legacyWrongPool || []) {
      if (!state[id]) state[id] = { ...base, total_correct: 0 };
    }
    return state;
  }
```

Update return: `return { nextState, buildDeck, summary, migrate };`

- [ ] **Step 4.3: Verify 19 / 19 pass.**
- [ ] **Step 4.4: Commit**

```bash
git add srs.js srs.test.html
git commit -m "srs: summary and legacy migration"
```

---

## Chunk 2: Storage wrapper and boot migration (task 5)

### Task 5: Storage helpers + migrate-on-load

**Files:**
- Modify: `app.js`

- [ ] **Step 5.1: Add storage helpers at the top of `app.js` (after `State` block)**

```js
const SrsStore = {
  loadState() { try { return JSON.parse(localStorage.getItem('srs_state') || '{}'); } catch { return {}; } },
  saveState(s) { localStorage.setItem('srs_state', JSON.stringify(s)); },
  loadSettings() {
    const defaults = { new_per_day: 10, session_cap: null, order: 'reviews_first' };
    try { return { ...defaults, ...JSON.parse(localStorage.getItem('srs_settings') || '{}') }; }
    catch { return defaults; }
  },
  saveSettings(s) { localStorage.setItem('srs_settings', JSON.stringify(s)); },
  getNewToday() {
    const key = new Date().toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(localStorage.getItem('srs_new_today') || '{}');
      return raw.date === key ? (raw.count || 0) : 0;
    } catch { return 0; }
  },
  incNewToday() {
    const key = new Date().toISOString().slice(0, 10);
    const cur = this.getNewToday();
    localStorage.setItem('srs_new_today', JSON.stringify({ date: key, count: cur + 1 }));
  },
};

function runMigration() {
  if (localStorage.getItem('srs_state')) return;
  const legacyAnswered = JSON.parse(localStorage.getItem('answered') || '{}');
  const legacyWrong = JSON.parse(localStorage.getItem('wrongPool') || '[]');
  const migrated = SRS.migrate(legacyAnswered, legacyWrong, Date.now());
  SrsStore.saveState(migrated);
  localStorage.removeItem('answered');
  localStorage.removeItem('wrongPool');
}
```

- [ ] **Step 5.2: Link `srs.js` in `index.html`**

Modify `index.html`: add `<script src="srs.js"></script>` immediately before `<script src="app.js"></script>`.

- [ ] **Step 5.3: Call `runMigration()` in `DOMContentLoaded` handler**

Modify `app.js` `DOMContentLoaded` block; add `runMigration();` right after `await loadQuestions();`.

- [ ] **Step 5.4: Manual smoke test**

Run dev server. Open preview. In console:

```js
// simulate legacy data
localStorage.setItem('answered', JSON.stringify({ 'ul2755-scope-001': { correct: true } }));
localStorage.setItem('wrongPool', JSON.stringify(['ul2755-6.2.4-001']));
localStorage.removeItem('srs_state');
location.reload();
```

After reload, check: `localStorage.getItem('srs_state')` contains both IDs with `stage: 'learning'`, and `answered` / `wrongPool` keys are gone.

- [ ] **Step 5.5: Commit**

```bash
git add app.js index.html
git commit -m "srs: storage helpers and legacy migration on boot"
```

---

## Chunk 3: Quiz wiring + Dashboard (tasks 6–7)

### Task 6: Route Quiz answers through SRS

**Files:**
- Modify: `app.js`

- [ ] **Step 6.1: Replace `State.order` initialization with deck build**

Modify `loadQuestions`:

```js
async function loadQuestions() {
  const res = await fetch('questions.json?v=' + Date.now());
  State.questions = await res.json();
  rebuildDeck();
}

function rebuildDeck() {
  const settings = SrsStore.loadSettings();
  const state = SrsStore.loadState();
  const deck = SRS.buildDeck(state, State.questions, settings, Date.now(), SrsStore.getNewToday());
  State.order = deck.map(q => State.questions.indexOf(q));
  State.idx = 0;
}
```

Remove the existing `State.order = shuffle(...)` line.

- [ ] **Step 6.2: Update `handleAnswer` to call SRS**

Replace body of `handleAnswer` block that writes `State.answered` / `State.wrongPool` with:

```js
function handleAnswer(picked) {
  const q = currentQuestion();
  const correct = picked === q.answer_index;
  const state = SrsStore.loadState();
  const prev = state[q.id] || null;
  const updated = SRS.nextState(prev, correct, Date.now());
  if (!prev) SrsStore.incNewToday();   // count toward today's new quota
  state[q.id] = updated;
  SrsStore.saveState(state);

  if (correct) { State.combo++; if (State.combo >= 3) burst(); else playRight(); tryVibrate(30); shake(true); }
  else { State.combo = 0; playWrong(); tryVibrate([80,50,80]); shake(false); }

  tickStreak();

  // (rest of existing UI-update code unchanged: disable buttons, show feedback, nextBtn wiring)
  ...
}
```

Delete the old `State.answered` / `State.wrongPool` / `localStorage.setItem('answered'...)` / `localStorage.setItem('wrongPool'...)` lines and the lines in `State` that load them. Replace `State.answered` / `State.wrongPool` references elsewhere in the file:

- In `renderDone`: compute counts from `SrsStore.loadState()` instead.
- Remove the old `wrongOnly` handler's direct use of `State.wrongPool`; will be replaced in Task 8.

- [ ] **Step 6.3: Manual smoke test**

1. Clear storage: `localStorage.clear(); location.reload();`
2. Answer one Quiz question correctly.
3. Verify `JSON.parse(localStorage.getItem('srs_state'))` shows `stage: "learning"`.
4. Answer another wrong → check that record stays `new`.

- [ ] **Step 6.4: Commit**

```bash
git add app.js
git commit -m "quiz: route answers through SRS instead of flat answered map"
```

---

### Task 7: Dashboard home view

**Files:**
- Modify: `app.js`, `index.html`

- [ ] **Step 7.1: Add dashboard markup template**

Append to `app.js`:

```js
function renderDashboard() {
  stopAudio();
  const state = SrsStore.loadState();
  const s = SRS.summary(state, State.questions, Date.now());
  const total = State.questions.length;
  const taken = SrsStore.getNewToday();
  const settings = SrsStore.loadSettings();
  const todayGoal = s.due + Math.max(0, settings.new_per_day - taken);
  const todayDone = Math.min(taken, settings.new_per_day) + Object.values(state).filter(r => r.last_answered_at >= startOfToday()).length - taken;
  $('#card').innerHTML = `
    <div class="dashboard">
      <h2>Today</h2>
      <div class="progress-large"><div class="bar" style="width:${todayGoal ? (todayDone/todayGoal)*100 : 0}%"></div></div>
      <div class="muted">${todayDone} / ${todayGoal} done</div>

      <ul class="metric-list">
        <li>📘 Due Reviews <b>${s.due - s.new}</b></li>
        <li>🆕 New Available <b>${s.new}</b></li>
        <li>🎓 Graduated <b>${s.graduated}</b></li>
      </ul>

      <div class="dash-actions">
        <button class="primary" onclick="enterQuiz()">Quiz Due</button>
        <button class="primary" onclick="enterRiding()">Riding Due</button>
        <button class="ghost" onclick="openSettings()">⚙ Settings</button>
      </div>
    </div>
  `;
  updateHeader();
}

function startOfToday() { const d = new Date(); d.setHours(0,0,0,0); return d.getTime(); }
window.enterQuiz = () => { State.mode = 'mcq'; setActive(); rebuildDeck(); renderMCQ(); };
window.enterRiding = () => { State.mode = 'audio'; setActive(); rebuildDeck(); renderAudioIntro(); };
```

- [ ] **Step 7.2: Add dashboard CSS in `index.html`**

```css
.dashboard { text-align: left; }
.progress-large { height: 14px; background: #1e293b; border-radius: 7px; overflow: hidden; margin: 0.5rem 0; }
.progress-large .bar { height: 100%; background: linear-gradient(90deg,#ef4444,#f97316); transition: width 0.3s; }
.muted { color: #94a3b8; font-size: 0.9rem; margin-bottom: 1rem; }
.metric-list { list-style: none; padding: 0; margin: 1rem 0; }
.metric-list li { padding: 0.6rem 0.8rem; background: #0f172a; border-radius: 8px; margin: 0.4rem 0; display: flex; justify-content: space-between; }
.dash-actions { display: flex; flex-direction: column; gap: 0.5rem; margin-top: 1rem; }
```

- [ ] **Step 7.3: Replace initial `renderMCQ()` call with `renderDashboard()`**

In `DOMContentLoaded`: change the `renderMCQ()` at the bottom to `renderDashboard()`.

Add a "home" button wiring — reuse the brand text as a clickable return:

```js
$('.brand').addEventListener('click', () => renderDashboard());
$('.brand').style.cursor = 'pointer';
```

- [ ] **Step 7.4: Manual verify**

Reload. Expected: dashboard with 30 New, 0 Graduated, buttons visible. Click Quiz Due → enters MCQ with deck built. Click brand → back to dashboard.

- [ ] **Step 7.5: Commit**

```bash
git add app.js index.html
git commit -m "dashboard: home view with SRS counts"
```

---

## Chunk 4: Due mode, Settings, SW bump (tasks 8–10)

### Task 8: Replace "Wrong" button with "Due"

**Files:**
- Modify: `app.js`, `index.html`

- [ ] **Step 8.1: Rename button label**

In `index.html`, change `<button id="wrongOnly" ...>🔄 Wrong</button>` to `<button id="dueOnly" ...>📘 Due</button>`.

- [ ] **Step 8.2: Update handler**

In `app.js` `DOMContentLoaded`, replace the `wrongOnly` listener block with:

```js
$('#dueOnly').addEventListener('click', () => {
  const state = SrsStore.loadState();
  const dueQs = State.questions.filter(q => {
    const r = state[q.id];
    return r && r.due_at != null && r.due_at <= Date.now();
  });
  if (!dueQs.length) return alert('Nothing due right now — check back later.');
  State.order = dueQs.map(q => State.questions.indexOf(q));
  State.idx = 0;
  (State.mode === 'audio') ? renderAudioIntro() : renderMCQ();
});
```

- [ ] **Step 8.3: Smoke test**

Answer 3 questions wrong, wait / tamper the clock to make them due, click Due. Expected: only those 3 appear.

- [ ] **Step 8.4: Commit**

```bash
git add app.js index.html
git commit -m "due: replace wrong pool with SRS due queue"
```

---

### Task 9: Settings modal

**Files:**
- Modify: `app.js`, `index.html`

- [ ] **Step 9.1: Add settings modal markup to `index.html`** (before `</body>`)

```html
<div id="settingsModal" class="modal" hidden>
  <div class="modal-inner">
    <h2>Settings</h2>
    <label>New questions per day
      <input type="number" id="newPerDay" min="1" max="50" value="10">
    </label>
    <label>Session cap (blank = none)
      <input type="number" id="sessionCap" min="0" max="100">
    </label>
    <button class="primary" onclick="saveSettingsFromForm()">Save</button>
    <button class="ghost" onclick="resetAllSrs()">Reset all SRS data</button>
    <button class="ghost" onclick="closeSettings()">Close</button>
  </div>
</div>
```

CSS:

```css
.modal { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 20; padding: 1rem; }
.modal[hidden] { display: none !important; }
.modal-inner { background: #1e293b; border-radius: 14px; padding: 1.2rem; max-width: 400px; width: 100%; }
.modal label { display: block; margin: 0.8rem 0; color: #cbd5e1; }
.modal input { width: 100%; padding: 0.6rem; margin-top: 0.3rem; background: #0f172a; border: 1px solid #334155; color: #f1f5f9; border-radius: 6px; font-size: 1rem; }
```

- [ ] **Step 9.2: Add JS handlers**

In `app.js`:

```js
window.openSettings = () => {
  const s = SrsStore.loadSettings();
  $('#newPerDay').value = s.new_per_day;
  $('#sessionCap').value = s.session_cap ?? '';
  $('#settingsModal').hidden = false;
};
window.closeSettings = () => { $('#settingsModal').hidden = true; };
window.saveSettingsFromForm = () => {
  const n = parseInt($('#newPerDay').value, 10);
  const capStr = $('#sessionCap').value.trim();
  const cap = capStr === '' ? null : parseInt(capStr, 10);
  SrsStore.saveSettings({ new_per_day: isNaN(n) ? 10 : n, session_cap: cap, order: 'reviews_first' });
  closeSettings();
  rebuildDeck();
  renderDashboard();
};
window.resetAllSrs = () => {
  if (!confirm('Really reset ALL SRS progress?')) return;
  if (!confirm('This cannot be undone. Still reset?')) return;
  localStorage.removeItem('srs_state');
  localStorage.removeItem('srs_new_today');
  rebuildDeck();
  renderDashboard();
  closeSettings();
};
```

- [ ] **Step 9.3: Smoke test**

Click ⚙ Settings → change new_per_day to 3 → Save → dashboard's `New Available` shows 3. Reset → all counts go back to 30 New / 0 Due / 0 Graduated.

- [ ] **Step 9.4: Commit**

```bash
git add app.js index.html
git commit -m "settings: modal for new_per_day, session_cap, reset"
```

---

### Task 10: Service worker bump + deploy

**Files:**
- Modify: `sw.js`

- [ ] **Step 10.1: Update shell list and cache version**

```js
const CACHE = 'ul2755-v8';
const SHELL = ['./', './index.html', './app.js', './srs.js', './manifest.webmanifest', './questions.json'];
```

(Everything else in `sw.js` unchanged.)

- [ ] **Step 10.2: Commit + push**

```bash
git add sw.js
git commit -m "sw: bump cache to v8, include srs.js in shell"
git push
```

- [ ] **Step 10.3: Production smoke test**

On the phone:
1. Force-refresh `https://aachentw.github.io/UL2755-quiz/`.
2. Dashboard loads with 30 New / 0 Graduated.
3. Answer 5 new questions correctly in Quiz → dashboard's Learning count rises.
4. Wait 10 min or manually move clock via Chrome dev tools → those 5 become Due → visible in Due button.
5. Answer Due correctly → they enter Review 1-day.
6. Settings → reset → dashboard resets.

---

## Verification of completion

- [ ] All 19 unit asserts pass in `srs.test.html`.
- [ ] E2E manual checklist from spec §Testing passes on local server.
- [ ] Pushed commit is live at `https://aachentw.github.io/UL2755-quiz/`.
- [ ] Dashboard is the default home view.
- [ ] Quiz answers advance SRS state (verified in dev tools localStorage).
- [ ] Riding mode's deck equals the Due queue (not a random shuffle of all 30).
- [ ] Settings changes persist across reloads.
- [ ] `srs_state` migrates cleanly from a legacy `answered` / `wrongPool` install.
