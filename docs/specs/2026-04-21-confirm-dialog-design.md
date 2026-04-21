# Design: Themed `confirmDialog` Component

**Date:** 2026-04-21
**Status:** Draft, pending user review

## Context

Two places in the app today call native `confirm()` / `alert()`:

1. `app.js:716` — "Rebuild curriculum?" when the user changes `new_per_day` or `finished_date` in Settings.
2. `app.js:740` — "Reset all learning records? This cannot be undone."

Both render as iOS white-backed native dialogs that clash with the app's dark theme, use ambiguous OK / Cancel labels, and give destructive actions the same styling as safe ones. No other alert/confirm exists in the codebase.

## Goals

- Replace both native dialogs with a single reusable `confirmDialog(options)` function.
- Match the existing Settings modal visual language (dark card, reused `.modal` CSS).
- Use verb-labelled buttons; show a distinct red style for destructive actions.
- Return a Promise so callers can `await` the user's choice.

Non-goals: animation library, multi-step wizards, input fields inside the dialog.

## API

```js
confirmDialog({
  title: string,
  body?: string | HTMLString,  // optional body text/HTML
  actions: [                    // 1–3 buttons, rendered top-to-bottom
    { label: string, style: 'primary' | 'danger' | 'ghost', value: any }
  ]
}): Promise<any>                // resolves with chosen action's `value`;
                                // resolves with null when user taps outside or ESC
```

Only one dialog is open at a time. Re-entry replaces the open one.

## DOM

Reuse the existing `#settingsModal` pattern — overlay + dark card. Mount a dedicated `<div id="confirmModal">` once at app start. Each call rewrites `.modal-inner` content and attaches click handlers.

```html
<div id="confirmModal" class="modal" hidden>
  <div class="modal-inner">
    <h2 id="confirmTitle"></h2>
    <div id="confirmBody"></div>
    <div id="confirmActions"></div>
  </div>
</div>
```

Style additions in `index.html` CSS:
- `.primary-danger { background: #b91c1c; color: white; }` — destructive action
- Existing `.primary` and `.ghost` used as-is

## Two concrete dialogs

### 1. Rebuild curriculum (replaces `app.js:716`)

```js
const value = await confirmDialog({
  title: 'Rebuild curriculum?',
  body: 'Changing daily pace will reorganize your remaining questions.',
  actions: [
    { label: 'Keep Progress',  style: 'primary', value: 'keep'  },
    { label: '⚠ Start Over',   style: 'danger',  value: 'reset' },
    { label: 'Cancel',         style: 'ghost',   value: null    },
  ],
});
if (value === 'keep')  { /* existing Keep branch */ }
if (value === 'reset') { /* existing Reset branch */ }
// null or any other -> do nothing, keep settings change? or revert?
```

Decision: on Cancel, **do not save** the settings change. Currently the app saves new_per_day first then asks — needs reorder so save happens after user chooses Keep or Start Over.

### 2. Reset learning records (replaces `app.js:740`)

```js
const value = await confirmDialog({
  title: '⚠️ Reset all learning records?',
  body: `You'll lose:
         · ${Object.keys(state).length} answered records
         · ${State.streak}-day streak
         · Day progress (Day ${currentDay} of ${total})`,
  actions: [
    { label: 'Reset Everything', style: 'danger', value: 'yes' },
    { label: 'Cancel',           style: 'ghost',  value: null  },
  ],
});
if (value === 'yes') { /* existing reset logic */ }
```

## Behavior rules

- ESC key or click outside `.modal-inner` resolves with `null`.
- Pressing a button resolves immediately and closes the modal.
- Buttons are rendered in the order given, each a full-width element.
- Modal is a focus trap during visibility (optional for MVP; document as deferred).

## File changes

| File | Change |
|---|---|
| `app.js` | Add `confirmDialog()`; refactor `saveSettingsFromForm` and `resetAllSrs` to call it; delete the two `confirm()` calls. |
| `index.html` | Add `<div id="confirmModal">` markup; add `.primary-danger` CSS. |
| `sw.js` | Bump CACHE to `ul2755-v11`. |

No changes to `srs.js`, `questions.json`, audio files.

## Testing

### Unit
Skip — the function is a thin DOM/Promise wrapper; covered by integration tests.

### Integration (new TC-E-030 ~ 034)

1. **TC-E-030**: Open Settings → change new_per_day → Save → `confirmDialog` shown with 3 buttons; no native confirm fires.
2. **TC-E-031**: Click `Keep Progress` → Promise resolves to `'keep'`; Keep branch executes; curriculum rebuilt; `start_date` preserved.
3. **TC-E-032**: Click `Start Over` → resolves to `'reset'`; Reset branch executes; `srs_state` cleared; `start_date` = today.
4. **TC-E-033**: Click `Cancel` or outside → resolves to `null`; settings **not saved**.
5. **TC-E-034**: Settings → Reset learning records → `confirmDialog` shown with 2 buttons; click `Reset Everything` → records cleared.

### Manual

- iPhone 28 Chrome: modal background dark, buttons full-width tappable.
- ESC on desktop closes.
- Tap outside the `.modal-inner` closes without destructive action.

## Risks

- Focus trap skipped for MVP. A11y audit could flag it; acceptable for single-user personal app.
- If the user taps rapidly, double-invocation — `confirmDialog` ignores re-entry (current open resolves with null before new opens).
