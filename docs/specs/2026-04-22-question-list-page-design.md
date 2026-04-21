# Design: Question List Page

**Date:** 2026-04-22
**Status:** Draft

## Context

The app already exposes questions per Curriculum Day (Day page) and per review-due Date (Date page). Neither view gives the user a single, date-sorted listing of every question with its next scheduled review. When the user wants to quickly answer "what am I reviewing 7 days from now?" or "which questions are overdue?", they have to click through each day cell in the Calendar. A flat list sorted by next-review-date solves this.

User also asked to verify SM-2 correctness. We decided (A) to keep the current fixed-interval implementation unchanged and label it SRS-lite; no algorithm change is part of this spec.

## Goals

1. New Dashboard button `📋 Question List` between Calendar and Settings.
2. New route `#list` that renders every question sorted by next-review-date.
3. A sticky row of SM-2-interval shortcut buttons (`Today`, `+1`, `+3`, `+7`, `+30`, `+90`, `+180`) that scrolls the list to the first question at/after that offset.
4. Each row shows **only** question short text (left) and `+N day(s)` or `Today` / `Overdue` (right).
5. Clicking a row navigates to that question's owning Day page.

Non-goals: search/filter, inline answering, drag reorder, pagination.

## Data

Pure helper added to `srs.js`:

```js
SRS.questionList(questions, state, nowMs) -> Array<{
  id: string,
  text: string,          // first 40 chars of question
  dueAtMs: number,       // effective due date (new/unseen -> now)
  daysFromToday: number  // floor((dueAt - startOfToday) / 86400000); negative = overdue
}>
```

Sort ascending by `dueAtMs`. Unseen (no state record) → `dueAtMs = now`, treated as "Today".

## Routing

Extend `route()` in `app.js`:

- `#list` → `renderQuestionList()`

No change to other routes.

## UI

### Dashboard button

Insert a ghost-style button between `📅 Calendar` and `⚙ Settings` inside `.dash-actions`.

### Question List page

```
┌─────────────────────────────────────────┐
│ < Back                Question List     │
├─────────────────────────────────────────┤
│ [Today] [+1] [+3] [+7] [+30] [+90] [+180]  ← sticky
├─────────────────────────────────────────┤
│ Which types of premise…         Today   │
│ Junction boxes in an MDC…       +1 day  │
│ NEC Article 646 scope…          +3 days │
│ ...                                     │
└─────────────────────────────────────────┘
```

- Header row is `position: sticky; top: 0;`
- List rows use existing `.day-card`-style border but in flex row.
- Active offset button (one currently scrolled-into) gets `.primary` red; others `.ghost`.

### Offset-button behavior

Clicking `+N`:
1. Find first index in the sorted list where `daysFromToday >= N`.
2. Scroll that element into view (`scrollIntoView({behavior:'smooth', block:'start'})`).
3. Highlight the clicked button.
4. If nothing matches (list empty past that offset), disable the button.

`Today` behaves as `+0`.

### Row-click behavior

Resolve `question → Day number` via `SRS.getDayForQuestion(curr, id)`.
- If day found: `location.hash = 'day=' + day`.
- If not (should never happen, but defensive): `location.hash = 'date=' + ymd(dueDate)`.

## File changes

| File | Change |
|---|---|
| `srs.js` | Add `questionList`. Unit tests in `srs.test.html` (3 cases). |
| `app.js` | Add `renderQuestionList()`, route mapping, Dashboard button. |
| `index.html` | Add `.q-list` + `.q-row` + `.offset-bar` CSS. |
| `sw.js` | Bump cache. |

## Testing

### Unit (new 3 cases, target 50/50)

- `TC-U-048` 3 Qs, one unseen (today), one due +2d, one due +10d → returns `[0, 2, 10]` days from today, sorted.
- `TC-U-049` overdue question returns negative `daysFromToday`.
- `TC-U-050` empty `state` + N questions → all returned with `daysFromToday === 0`.

### E2E

- `TC-E-035` Dashboard → Question List button visible between Calendar and Settings; clicking routes to `#list`.
- `TC-E-036` Page renders N rows matching `State.questions.length`.
- `TC-E-037` Click `+3` scrolls to first row with `daysFromToday >= 3`; button gets `.primary`.
- `TC-E-038` Click a row → `location.hash` becomes that question's Day.

## Risks

- Very long lists (220 Qs after expansion) may make scroll sluggish. Virtualization not needed for this scale.
- Sticky header + tall rows may overflow on small phone widths; buttons stay single row via flex wrap only if really needed (we'll accept horizontal scroll).
