# Design: Calendar + Curriculum + Day-Scoped Riding (Phase B.1)

**Date:** 2026-04-20
**Status:** Draft, pending user review
**Depends on:** Phase A (SRS + mastery tracking) already shipped.

---

## Context

With SRS in place, the user now wants a calendar view that answers "when will I be done?" and "what am I supposed to study today?" The existing app is SRS-only: new questions are injected on demand, reviews surface when due, but there is no sense of a **fixed curriculum** or **completion date**.

The user is studying UL2755 with a one-week sprint mental model and plans to repeat the pattern for other future subjects. A pre-assigned per-day curriculum gives structure; SRS continues to handle retention within it. This spec adds the curriculum layer and the UX that exposes it.

---

## Goals

1. Auto-assign every question to a specific "Day N" based on source and category.
2. Render a month-view calendar grid that shows per-day progress at a glance.
3. A day detail page shows all of that day's questions with answers and explanations, as a read-only study sheet.
4. Any day is tappable — past, today, future — and starts Quiz or Riding sessions scoped to that day.
5. Riding for a selected day plays only questions that are **not yet graduated**.
6. A slipped day (user didn't practice) moves forward — the whole schedule shifts one day later instead of piling up.
7. Dashboard shows an updated "Projected completion date" that reflects current pace and slippage.

**Non-goals:** multi-course management (Phase B.2), push notifications, category-level analytics, manual per-question day assignment.

---

## Curriculum generation

Runs once when the course first loads (cached afterwards, rebuilt if `questions.json` changes).

**Algorithm:**

1. Order questions stably by `(source_group, category, id)`:
   - `source_group`: `UL2755` < `NEC 646` < `FXX` (inferred from `source` field prefix).
   - `category` alphabetical within the same source group.
   - `id` as the tiebreaker for determinism.
2. Read `new_per_day` from `srs_settings`.
3. Chunk the sorted list into consecutive groups of `new_per_day`. Each chunk becomes one "Day": `Day 1`, `Day 2`, ...
4. Store as an ordered array of `{ day: N, question_ids: [...] }`.

**Result for 30 questions at `new_per_day: 10`:** 3 days. At 220 questions: 22 days. Changes to `new_per_day` in Settings trigger a rebuild and resets `start_date` to today.

Stored under `localStorage` key `srs_curriculum`:

```json
{
  "version": 1,
  "start_date": "2026-04-20",
  "built_from_new_per_day": 10,
  "days": [
    { "day": 1, "question_ids": ["ul2755-scope-001", ...] },
    { "day": 2, "question_ids": [...] },
    ...
  ]
}
```

---

## Slip forward logic

The curriculum is "fixed" in composition but "flexible" in dates.

- `planned_date(day_n) = start_date + (day_n - 1) days`
- A day is **completed** when every question in it has been answered at least once (via any mode, any session).
- At app open, compute `slip = today_index - first_incomplete_day_index`. If `slip > 0`, effectively all remaining days shift by `slip` days when displayed on the calendar.
- The first incomplete day is always "today" on the calendar, regardless of `planned_date`. Completed days anchor at their actual completion date.

Display rule:

```
Day  planned  effective  state
1    04-20    04-20      ✅ completed on 04-20
2    04-21    04-21      ✅ completed on 04-21
3    04-22    04-23      🔵 today (user skipped 04-22)
4    04-23    04-24      ⚪ upcoming
```

---

## Projected completion

```
remaining_days = total_days - completed_days
projected_completion = today + remaining_days
```

Shown on dashboard as: `Projected: 2026-04-27 (2 days behind)`. "Behind" count = `today - planned_completion` if positive, else "on track" / "ahead".

---

## UI

### Dashboard additions

Above the existing metrics:

```
Projected: 2026-04-27   (on track)
Day 3 of 3 · Started 2026-04-20
```

Keep existing Due / New / Graduated metrics below.

### Calendar view

New bottom-nav entry: `📅 Calendar`. Replaces nothing — added as fourth mode button.

- Month grid (7 columns × N rows). Current month default; prev/next arrows to navigate.
- Each cell: date number, small badge showing `questionsThatDay` count.
- Background color:
  - 🟢 green: completed
  - 🔵 blue: today / first incomplete day
  - ⚪ gray: upcoming
  - 🟡 yellow: past but incomplete (slipped)
  - transparent: no course content this day (weekends/outside range)
- Tap cell → Day page.

### Day page

Route: `#day=N` (URL fragment for back-button support).

```
< Back                         Day 2 — 2026-04-21 (planned)

Transformers · Wiring Methods
10 questions · 3 graduated · 7 to go

──────────────────────────────────────
Q1. [Transformers]  UL2755 §6.2.3
Which types of premise transformers are permitted inside an MDC?

  A  Any oil-filled transformer
  B  Dry-type, or filled with a noncombustible dielectric  ✓
  C  Dry-type only
  D  Oil-filled only

💡 Per §6.2.3, premise transformers must be dry-type or filled...
──────────────────────────────────────
Q2. ...
──────────────────────────────────────
...

[ 🏍️ Riding this day ]   [ 📱 Quiz this day ]
```

- Answers rendered inline with ✓ on the correct option (green highlight).
- Explanation visible by default.
- Mastery status per question shown as a badge: `🆕 New` / `📖 Learning` / `🔁 Review (2/3)` / `🎓 Graduated`.
- Quiz button: enters Quiz mode with deck = this day's question IDs (all of them, regardless of SRS state).
- Riding button: enters Riding mode with deck = this day's **non-graduated** question IDs only.

### Calendar → Mode interactions

- Entering Quiz / Riding from a Day page sets `State.order` explicitly from the day's question list; ignores SRS deck for this session.
- On session end (back to dashboard), deck resets to normal SRS behavior.
- Settings "reset all SRS data" also resets the curriculum (regenerates with today as `start_date`).

---

## Riding day-scoped filter

When entering Riding from a Day page:

1. Load the day's `question_ids`.
2. Filter out any where `srs_state[id].stage === 'graduated'`.
3. Use the filtered list as the deck. If empty, show a message: "All questions in this day are graduated — pick another day."

---

## Data model additions

- New `localStorage` key `srs_curriculum` (schema above).
- Extend `SrsStore` with:
  - `loadCurriculum()` / `saveCurriculum()`
  - `ensureCurriculum(questions, settings)` — builds if missing or if `built_from_new_per_day` differs from current settings.
- New function in `srs.js`:
  - `buildCurriculum(questions, newPerDay, startDateYmd)` — pure function, returns curriculum object.
  - `getDayForQuestion(curriculum, qId)` — reverse lookup.
  - `completedDays(curriculum, state)` — returns set of day numbers where all questions seen at least once.
- No change to `srs_state` schema.

---

## File changes

| File | Change |
|---|---|
| `srs.js` | Add `buildCurriculum`, `getDayForQuestion`, `completedDays`. Pure functions, covered by unit tests in `srs.test.html`. |
| `app.js` | Add calendar renderer, day page renderer, URL hash routing, curriculum rebuild on settings change, Riding day-scoped filter. |
| `index.html` | Add 📅 Calendar nav button; two new view containers (calendar grid, day detail); CSS for calendar cells and day-page question cards. |
| `sw.js` | Bump CACHE to `ul2755-v9`. |

No changes to `questions.json` or `audio/*.mp3`.

---

## Testing

**Unit (added to `srs.test.html`):**

1. `buildCurriculum` with 30 Qs + `new_per_day: 10` produces 3 days, each with 10 IDs.
2. Ordering: first day's first question belongs to `UL2755` source, alphabetically first category.
3. `getDayForQuestion` returns correct day number for arbitrary IDs.
4. `completedDays` correctly identifies a day with all questions seen.

**E2E (manual):**

1. Fresh install: Dashboard shows `Day 1 of 3` and projected completion today+2 days.
2. Calendar shows three blue cells starting today.
3. Tap Day 1 → see 10 questions with answers highlighted.
4. Quiz through Day 1 → Day 1 cell turns green, Dashboard updates to `Day 2 of 3`.
5. Skip a day (advance system clock +1 day without answering): Day 2 still blue (not yellow), projected completion shifts +1.
6. Tap Day 3 (偷跑): Quiz works; answers count toward SRS.
7. Graduate all 10 questions of a day, then enter Riding from that day → "All questions graduated" message.

---

## Risks

- **Schema rebuild on `new_per_day` change.** Rebuilding mid-sprint discards day numbering. Acceptable: this only happens when the user manually changes settings.
- **Category imbalance.** Some categories have just 1 question; others 4+. Sort + chunk may split one category across two days. Acceptable for MVP. Future phase can add "keep category together" heuristic.
- **URL fragment routing.** Back button must not leave the app. Use `hashchange` listener; no full SPA router.

---

## Verification of completion

- Unit tests for curriculum functions pass (4 new asserts → 23/23 total).
- Dashboard shows projected completion date.
- Calendar renders current month with colored cells.
- Day page shows answers with correct highlighted.
- Quiz and Riding from a day page use the day's question set.
- Riding from a day page skips graduated questions.
- Changing `new_per_day` in Settings rebuilds curriculum and resets `start_date`.
