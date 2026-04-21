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
    next.total_seen = (r.total_seen || 0) + 1;
    if (correct) next.total_correct = (r.total_correct || 0) + 1;
    next.last_answered_at = now;

    if (r.stage === 'new' || !r.stage) {
      // Both correct and wrong advance to 'learning'. Correct OR wrong consumes
      // the "new" status; wrong simply restarts the learning timer.
      next.stage = 'learning';
      next.consecutive_correct = 0;
      next.due_at = now + LEARNING_MIN;
      next.interval_minutes = minutesOf(LEARNING_MIN);
      return next;
    }

    if (r.stage === 'learning') {
      if (correct) { next.stage = 'review'; next.due_at = now + REVIEW_INTERVALS_MIN[0]; next.interval_minutes = minutesOf(REVIEW_INTERVALS_MIN[0]); next.consecutive_correct = 1; }
      else { next.stage = 'learning'; next.due_at = now + LEARNING_MIN; next.interval_minutes = minutesOf(LEARNING_MIN); next.consecutive_correct = 0; }
      return next;
    }

    if (r.stage === 'review') {
      if (correct) {
        const nextCC = (r.consecutive_correct || 0) + 1;
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
        const currentMs = (r.interval_minutes || 0) * MIN;
        const currentIdx = GRADUATED_INTERVALS_MIN.indexOf(currentMs);
        const nextIdx = Math.min((currentIdx < 0 ? 0 : currentIdx) + 1, GRADUATED_INTERVALS_MIN.length - 1);
        const cap = currentIdx === GRADUATED_INTERVALS_MIN.length - 1 ? currentIdx : nextIdx;
        next.stage = 'graduated';
        next.interval_minutes = minutesOf(GRADUATED_INTERVALS_MIN[cap]);
        next.due_at = now + GRADUATED_INTERVALS_MIN[cap];
      } else {
        next.stage = 'review';
        next.consecutive_correct = 0;
        next.interval_minutes = minutesOf(REVIEW_INTERVALS_MIN[0]);
        next.due_at = now + REVIEW_INTERVALS_MIN[0];
      }
      return next;
    }

    return next;
  }

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

    let deck = [...due, ...newInjection];
    if (settings.session_cap != null) deck = deck.slice(0, settings.session_cap);
    return deck;
  }

  function summary(state, questions, now) {
    const counts = { new: 0, learning: 0, review: 0, graduated: 0, due: 0 };
    for (const q of questions) {
      const r = state[q.id];
      if (!r) { counts.new++; counts.due++; continue; }
      counts[r.stage] = (counts[r.stage] || 0) + 1;
      if (r.due_at != null && r.due_at <= now) counts.due++;
    }
    return counts;
  }

  function migrate(legacyAnswered, legacyWrongPool, now) {
    const state = {};
    const base = {
      stage: 'learning', consecutive_correct: 0, interval_minutes: 10,
      total_seen: 1, total_correct: 0,
      due_at: now + LEARNING_MIN, last_answered_at: now,
    };
    for (const [id, a] of Object.entries(legacyAnswered || {})) {
      state[id] = { ...base, total_correct: a && a.correct ? 1 : 0 };
    }
    for (const id of legacyWrongPool || []) {
      if (!state[id]) state[id] = { ...base, total_correct: 0 };
    }
    return state;
  }

  function sourceGroupRank(source) {
    const s = (source || '').toUpperCase();
    if (s.startsWith('UL2755') || s.startsWith('UL 2755')) return 0;
    if (s.startsWith('NEC')) return 1;
    return 2;
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

  function ymd(d) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function computeFinishedYmd(newPerDay, remainingNew, startYmd) {
    const effRem = Math.max(0, remainingNew | 0);
    const effPer = Math.max(1, newPerDay | 0);
    const days = Math.max(1, Math.ceil(effRem / effPer) || 1);
    const d = new Date(startYmd + 'T00:00:00');
    d.setDate(d.getDate() + days - 1);
    return ymd(d);
  }

  function computeNewPerDay(finishedYmd, remainingNew, startYmd) {
    const a = new Date(startYmd + 'T00:00:00').getTime();
    const b = new Date(finishedYmd + 'T00:00:00').getTime();
    const days = Math.max(1, Math.round((b - a) / 86400000) + 1);
    const effRem = Math.max(0, remainingNew | 0);
    if (effRem === 0) return 1;
    return Math.max(1, Math.ceil(effRem / days));
  }

  return { nextState, buildDeck, summary, migrate, buildCurriculum, getDayForQuestion, completedDays, ymd, computeFinishedYmd, computeNewPerDay };
})();
