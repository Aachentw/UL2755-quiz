# Confirm Dialog Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:executing-plans (tasks highly coupled in `app.js`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two native `confirm()` calls with a promise-based, theme-matched `confirmDialog()` component.

**Architecture:** One new HTML modal node + one new JS function `confirmDialog({title, body, actions}) → Promise<value>` that reuses existing `.modal` CSS. Two call sites (`saveSettingsFromForm`, `resetAllSrs`) refactored.

**Tech Stack:** Vanilla JS, existing CSS, no new deps.

**Spec:** `docs/specs/2026-04-21-confirm-dialog-design.md`

---

## File Structure

| File | Role |
|---|---|
| `index.html` | New `<div id="confirmModal">` + `.primary-danger` CSS. |
| `app.js` | New `confirmDialog()` function; refactor `saveSettingsFromForm` + `resetAllSrs`. |
| `sw.js` | Bump CACHE to `ul2755-v11`. |

---

## Task 1: Add modal DOM + danger style

**Files:** Modify `index.html`

- [ ] **Step 1.1: Add confirm modal markup before `</body>`**

```html
<div id="confirmModal" class="modal" hidden>
  <div class="modal-inner">
    <h2 id="confirmTitle"></h2>
    <div id="confirmBody" style="color:#cbd5e1;font-size:0.92rem;line-height:1.55;white-space:pre-line;margin:0.6rem 0 1rem;"></div>
    <div id="confirmActions"></div>
  </div>
</div>
```

- [ ] **Step 1.2: Add `.primary-danger` class + stacked-actions spacing**

Append inside the existing `<style>` block:

```css
.primary-danger { display: block; width: 100%; padding: 0.9rem; border-radius: 10px; font-size: 1rem; font-weight: 600; cursor: pointer; margin-top: 0.6rem; border: none; background: #b91c1c; color: white; }
.primary-danger:active { background: #7f1d1d; }
#confirmActions > button { margin-top: 0.5rem; }
```

---

## Task 2: Implement `confirmDialog()` function

**Files:** Modify `app.js`

- [ ] **Step 2.1: Add function near other `window.*` helpers**

```js
let _confirmResolve = null;
function confirmDialog({ title, body = '', actions }) {
  return new Promise((resolve) => {
    // Resolve any previously-open dialog with null so only one can be open
    if (_confirmResolve) _confirmResolve(null);
    _confirmResolve = resolve;

    $('#confirmTitle').textContent = title;
    $('#confirmBody').textContent = body;
    const cls = { primary: 'primary', danger: 'primary-danger', ghost: 'ghost' };
    $('#confirmActions').innerHTML = actions.map((a, i) =>
      `<button class="${cls[a.style] || 'ghost'}" data-idx="${i}">${a.label}</button>`
    ).join('');

    [...$('#confirmActions').querySelectorAll('button')].forEach((btn, i) => {
      btn.addEventListener('click', () => {
        closeConfirm();
        resolve(actions[i].value);
      }, { once: true });
    });

    $('#confirmModal').hidden = false;
    document.addEventListener('keydown', confirmEscHandler);
    $('#confirmModal').addEventListener('click', confirmBackdropHandler);
  });
}

function closeConfirm() {
  $('#confirmModal').hidden = true;
  _confirmResolve = null;
  document.removeEventListener('keydown', confirmEscHandler);
  $('#confirmModal').removeEventListener('click', confirmBackdropHandler);
}

function confirmEscHandler(e) {
  if (e.key === 'Escape' && _confirmResolve) {
    const r = _confirmResolve; closeConfirm(); r(null);
  }
}

function confirmBackdropHandler(e) {
  if (e.target.id === 'confirmModal' && _confirmResolve) {
    const r = _confirmResolve; closeConfirm(); r(null);
  }
}
```

---

## Task 3: Refactor `saveSettingsFromForm` to use `confirmDialog`

**Files:** Modify `app.js`

- [ ] **Step 3.1: Rewrite the save handler**

Replace the existing function:

```js
window.saveSettingsFromForm = async () => {
  const stored = SrsStore.loadSettings();
  const n = parseInt($('#newPerDay').value, 10);
  const newPerDay = isNaN(n) ? 10 : Math.max(1, Math.min(50, n));
  if (newPerDay === stored.new_per_day) { closeSettings(); return; }

  const choice = await confirmDialog({
    title: 'Rebuild curriculum?',
    body: 'Changing daily pace will reorganize your remaining questions.',
    actions: [
      { label: 'Keep Progress',  style: 'primary', value: 'keep'  },
      { label: '⚠ Start Over',   style: 'danger',  value: 'reset' },
      { label: 'Cancel',         style: 'ghost',   value: null    },
    ],
  });
  if (choice == null) return; // Cancel: do not save

  SrsStore.saveSettings({ new_per_day: newPerDay, session_cap: null, order: 'reviews_first' });

  if (choice === 'keep') {
    const prevCurr = SrsStore.loadCurriculum();
    const prevStart = prevCurr && prevCurr.start_date ? prevCurr.start_date : todayYmd();
    localStorage.removeItem('srs_curriculum');
    const rebuilt = SRS.buildCurriculum(State.questions, newPerDay, prevStart);
    SrsStore.saveCurriculum(rebuilt);
  } else {
    localStorage.removeItem('srs_state');
    localStorage.removeItem('srs_new_today');
    localStorage.removeItem('srs_curriculum');
    SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  }
  closeSettings();
  renderDashboard();
};
```

---

## Task 4: Refactor `resetAllSrs` to use `confirmDialog`

**Files:** Modify `app.js`

- [ ] **Step 4.1: Replace function**

```js
window.resetAllSrs = async () => {
  const state = SrsStore.loadState();
  const answered = Object.keys(state).length;
  const curr = SrsStore.loadCurriculum();
  const dayStr = curr ? `Day ${SRS.completedDays(curr, state).size} of ${curr.days.length}` : '';
  const body = `You'll lose:\n· ${answered} answered records\n· ${State.streak}-day streak\n· ${dayStr}`;
  const choice = await confirmDialog({
    title: '⚠️ Reset all learning records?',
    body,
    actions: [
      { label: 'Reset Everything', style: 'danger', value: 'yes' },
      { label: 'Cancel',           style: 'ghost',  value: null  },
    ],
  });
  if (choice !== 'yes') return;

  localStorage.removeItem('srs_state');
  localStorage.removeItem('srs_new_today');
  localStorage.removeItem('srs_curriculum');
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  closeSettings();
  renderDashboard();
};
```

---

## Task 5: Bump SW + Deploy

**Files:** Modify `sw.js`

- [ ] **Step 5.1**: `const CACHE = 'ul2755-v11';`

- [ ] **Step 5.2**: `git add -A && git commit -m "Themed confirmDialog: replace native confirm for curriculum rebuild + reset" && git push`

---

## Task 6: Verify with new TC-E-030~034

Run via `preview_eval` (controller will inject and assert):

1. **TC-E-030** Settings → change per_day → Save → confirm modal visible, not native
2. **TC-E-031** Keep Progress → curriculum rebuilt, start_date preserved, srs_state preserved
3. **TC-E-032** Start Over → curriculum rebuilt, start_date=today, srs_state cleared
4. **TC-E-033** Cancel → settings NOT saved (stored.new_per_day unchanged)
5. **TC-E-034** Reset learning records → confirm with 2 buttons → Reset Everything clears state

---

## Verification of completion

- [ ] No native `confirm()` or `alert()` remain in app.js (`grep "confirm\|alert" app.js` returns 0 runtime calls).
- [ ] Both dialogs render inside `.modal-inner` with dark theme.
- [ ] Destructive buttons show red background.
- [ ] Cancel from Rebuild curriculum leaves `srs_settings` untouched.
- [ ] TC-E-030~034 all pass.
- [ ] Pushed; iPhone reload shows themed modal, not native.
