# Design: SRS + Mastery Tracking (Phase A)

**Date:** 2026-04-20
**Status:** Draft, pending user review
**Scope:** Phase A of the larger learning-platform vision. Single course (UL2755).
**Out of scope:** Multi-course framework (Phase B), user-defined deadline scheduling (C), document-to-quiz pipeline (D).

---

## Context

The UL2755 Sprint app currently ships 30 questions with Quiz and Riding modes, a shared order shuffled once per session, and a simple "wrong pool" for questions answered incorrectly. Progress is tracked by a single per-question `answered` record.

The user is preparing for a Foxconn California 800 Vdc PTU CSA audit and must retain — not just see — UL2755 requirements. Without spaced repetition, a one-week sprint will be forgotten within weeks. The user also plans to feed additional learning material into the same app over time, so the core retention engine must be generic from day one even while only UL2755 uses it.

This spec covers the retention engine and user-visible surfaces needed to make it useful on day one.

---

## Goals

1. Every question follows a deterministic SRS lifecycle, persisted in `localStorage`.
2. A question is considered **mastered** (graduated) only after **3 consecutive correct** answers in review stage. A single wrong answer resets the streak.
3. Graduated questions continue to be scheduled at long intervals (30 / 90 / 180 days) to guard against forgetting.
4. Quiz is the authoritative scoring surface. Riding plays from the same due queue without affecting scores, creating a listen-then-test loop.
5. A dashboard gives the user immediate visibility of today's work and long-term mastery.

Non-goals: cloud sync, multi-device sync, per-user accounts, adaptive difficulty beyond SM-2 intervals, document ingestion UI.

---

## Lifecycle

Each question occupies one of five stages:

| Stage | Entered by | On correct | On wrong |
|---|---|---|---|
| `new` | Never answered | → `learning`, next due +10 min | stays `new` |
| `learning` | Correct from `new` or wrong from `review` | → `review`, next due +1 day | stays `learning`, +10 min |
| `review` | Correct from `learning`, or interval graduation | interval grows 1 → 3 → 7 days, `consecutive_correct++` | → `learning`, +10 min, `consecutive_correct = 0` |
| `graduated` | 3 consecutive correct in `review` (interval reached 7 days + third correct) | interval grows 30 → 90 → 180 days | → `review`, next due +1 day, `consecutive_correct = 0` |
| *(terminal)* | 180-day interval achieved and answered correctly | stays `graduated`, interval capped at 180 days | → `review`, +1 day |

**Intervals:** 10 min → 1 d → 3 d → 7 d → 30 d → 90 d → 180 d. Fixed, no ease factor. Chosen to match the user's one-week UL2755 sprint: a question learned on Day 1 lands its third review-correct around Day 5, entering graduation just in time for the audit timeline.

**Mastery rule (strict):** `consecutive_correct` resets to zero on any wrong answer, regardless of stage. Graduation requires reaching `consecutive_correct == 3` while in the `review` stage.

---

## Data model

One record per question, keyed by `q_id`, stored in `localStorage` under key `srs_state`:

```json
{
  "ul2755-scope-001": {
    "stage": "review",
    "consecutive_correct": 2,
    "due_at": 1713772800000,
    "interval_minutes": 4320,
    "total_seen": 5,
    "total_correct": 4,
    "last_answered_at": 1713686400000
  }
}
```

- `due_at`: epoch ms. A question is *due* when `due_at <= now`.
- `interval_minutes`: the interval that produced the current `due_at`. Used to compute the next interval.
- Unseen questions have no record; they are implicitly `new` and due immediately.

Settings persist in a separate `localStorage` key `srs_settings`:

```json
{
  "new_per_day": 10,
  "session_cap": null,
  "order": "reviews_first"
}
```

---

## Deck composition

When the user opens Quiz (or Riding pulls from the same source):

1. Gather all questions where `due_at <= now` → **due queue**.
2. If today's new count < `new_per_day`, append unseen questions to fill up to the cap → **new injection**.
3. Order: `reviews_first` yields `[due_queue..., new_injection...]`. (`interleave` and `new_first` can be added later; this spec ships `reviews_first` only.)
4. Apply `session_cap` if set, truncating the tail.
5. The deck is rebuilt each time the user enters a mode. No long-lived session state.

"Today's new count" resets at local midnight. Track via a `new_taken_today` counter keyed by date string.

---

## Mode interactions

- **Quiz:** authoritative. Every answer triggers an SRS transition, updates persistent state, increments `total_seen` / `total_correct`, and advances the deck.
- **Riding:** plays the same deck order, but answers are not recorded (no SM-2 transition). Wake lock, speed control, and looping behavior are unchanged from the current implementation.
- **Due (replaces Wrong):** shows only questions currently due. If nothing is due, shows an empty state — not an error.

---

## Dashboard (home view)

Replaces the current first-load screen. Shown when no mode is active.

```
🏍️ UL2755 Sprint          🔥 3 days
────────────────────────────────────
Today
 ▓▓▓▓▓▓▓░░░   18 / 25 done

 📘 Due Reviews       8 questions
 🆕 New Available    10 questions
 🎓 Graduated         5 questions

[ Quiz Due ]   [ Riding Due ]   [ ⚙ Settings ]
```

- "Today" progress bar = `today_answered / (due_count + min(new_remaining, new_per_day))`.
- Counts computed live from `srs_state` at render time; no separate cache.
- Mode buttons enter Quiz / Riding / Settings.

---

## Settings page

Minimal:

- **New questions per day** (1–50, default 10)
- **Session cap** (none / 10–100, default none)
- **Reset all SRS data** — confirm twice, wipes `srs_state` and `new_taken_today`

Order mode is hard-coded to `reviews_first` in this spec. If future phases need other orderings, add the radio group here.

---

## File changes

| File | Change |
|---|---|
| `srs.js` (new) | Pure functions: `nextState(record, correct, now)`, `buildDeck(state, questions, settings, now)`, `summary(state)`. No DOM access. |
| `app.js` | Wire Quiz answer handler through `srs.nextState`. Replace `State.order` shuffle with `srs.buildDeck`. Replace Wrong button with Due. Add dashboard render. |
| `index.html` | Add dashboard section. Add settings modal. Reuse existing `.opt` / `.aopt` styles. |
| `sw.js` | Bump `CACHE` version. Add `srs.js` to shell. |

No change to `questions.json` or `audio/*.mp3`.

---

## Migration

Existing users have `answered` and `wrongPool` keys in `localStorage`. On first load under the new version:

1. If `srs_state` already exists, skip.
2. Else, for each entry in `answered`, seed a record: correct → `stage: learning, due_at: now + 10min`, wrong → same. Any entry in `wrongPool` overrides to `learning`. Delete `answered` and `wrongPool`.
3. If neither key exists, start fresh.

This preserves the spirit of prior progress without fabricating lifecycle data.

---

## Testing

**Unit (pure function tests in a small HTML test page):**

1. `nextState({stage: 'new'}, true, t0)` → `{stage: 'learning', due_at: t0 + 10*60*1000, consecutive_correct: 0, ...}`
2. Three consecutive `nextState` with `correct: true` from fresh: reaches `stage: 'review'` with `interval_minutes: 1440`, then 4320, then graduates with `consecutive_correct: 3`.
3. Wrong answer in `review` resets `consecutive_correct` to 0 and demotes to `learning` with 10-min interval.
4. Graduated question wrong → back to `review` with 1-day interval, not `learning`.
5. `buildDeck` with 5 due + 3 new available + `new_per_day: 2` → returns 5 due followed by 2 new, total 7.

**End-to-end (manual on device):**

1. Fresh install, answer 10 new questions correctly in Quiz. Confirm dashboard shows 10 Learning.
2. Manually set system clock forward 11 min. Reopen. All 10 are due. Answer correctly. Dashboard shows 10 Review.
3. Advance clock 1 day. Answer 9 correct, 1 wrong. Dashboard shows 9 Review (interval 3 d), 1 Learning.
4. Advance clock through 3 days, answer the 9 correctly three times. Dashboard shows 9 Graduated.

**Visual spot-checks:** dashboard numbers match state; no CJK slips back in; shared `.opt` / `.aopt` styles still aligned.

---

## Risks

- **Clock tampering.** If the user's device clock moves backward, some questions become not-due when they should be. Acceptable for a single-user personal app; document in code comments, no mitigation.
- **localStorage size.** 220 questions × ~200 bytes each = 44 KB. Well under the 5 MB quota.
- **Migration loss.** Users may lose fine-grained history (timestamps) when migrating from `answered`. This is acceptable: the rebuild puts everything into Learning with 10-min review, so they recover within a session.

---

## Verification of completion

- All unit tests pass.
- Dashboard renders on load with correct counts for a fresh install and for a partially-used install.
- Answering a Quiz question updates the dashboard counts on the next dashboard render.
- Riding mode plays the deck produced by `buildDeck` (not a random shuffle of all 30).
- Settings page persists `new_per_day` across reloads.
- Bumping system clock forward in dev tools moves questions from not-due to due as expected.
