// UL2755 Quiz — Stage 1 MVP
// Modes: MCQ (interactive) / Audio (motorcycle hands-free)

let APP_VERSION = 'dev';
async function loadVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now());
    if (r.ok) {
      const v = await r.json();
      APP_VERSION = v.version || 'dev';
    }
  } catch (_) { /* keep dev */ }
}

const State = {
  questions: [],
  order: [],
  idx: 0,
  mode: 'mcq',
  combo: 0,
  streak: parseInt(localStorage.getItem('streak') || '0', 10),
  lastDay: localStorage.getItem('lastDay') || '',
  wakeLock: null,
  audioTimer: null,
  audioStopped: false,
  session: { correct: 0, total: 0 },
};

const $ = (s) => document.querySelector(s);
const todayKey = () => new Date().toISOString().slice(0, 10);

// ---------- SRS storage ----------
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
    const key = todayKey();
    try {
      const raw = JSON.parse(localStorage.getItem('srs_new_today') || '{}');
      return raw.date === key ? (raw.count || 0) : 0;
    } catch { return 0; }
  },
  incNewToday() {
    const key = todayKey();
    const cur = this.getNewToday();
    localStorage.setItem('srs_new_today', JSON.stringify({ date: key, count: cur + 1 }));
  },
  loadCurriculum() { try { return JSON.parse(localStorage.getItem('srs_curriculum') || 'null'); } catch { return null; } },
  saveCurriculum(c) { localStorage.setItem('srs_curriculum', JSON.stringify(c)); },
  ensureCurriculum(questions, settings) {
    const existing = this.loadCurriculum();
    const totalStored = existing ? existing.days.reduce((n, d) => n + d.question_ids.length, 0) : 0;
    if (existing && existing.built_from_new_per_day === settings.new_per_day && totalStored === questions.length) {
      return existing;
    }
    const t = new Date();
    const today = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    const fresh = SRS.buildCurriculum(questions, settings.new_per_day, today);
    this.saveCurriculum(fresh);
    return fresh;
  },
};

function runMigration() {
  if (localStorage.getItem('srs_state')) return;
  const legacyAnswered = JSON.parse(localStorage.getItem('answered') || '{}');
  const legacyWrong = JSON.parse(localStorage.getItem('wrongPool') || '[]');
  if (!Object.keys(legacyAnswered).length && !legacyWrong.length) return;
  const migrated = SRS.migrate(legacyAnswered, legacyWrong, Date.now());
  SrsStore.saveState(migrated);
  localStorage.removeItem('answered');
  localStorage.removeItem('wrongPool');
}

// ---------- load ----------
async function loadQuestions() {
  const res = await fetch('questions.json?v=' + Date.now());
  State.questions = await res.json();
}

function rebuildDeck() {
  const settings = SrsStore.loadSettings();
  const state = SrsStore.loadState();
  const deck = SRS.buildDeck(state, State.questions, settings, Date.now(), SrsStore.getNewToday());
  State.order = deck.map(q => State.questions.indexOf(q));
  State.idx = 0;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- streak ----------
function tickStreak() {
  const t = todayKey();
  if (State.lastDay === t) return;
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  State.streak = (State.lastDay === y) ? State.streak + 1 : 1;
  State.lastDay = t;
  localStorage.setItem('streak', State.streak);
  localStorage.setItem('lastDay', t);
}

// ---------- MCQ mode ----------
function renderMCQ() {
  stopAudioCleanup();
  const q = currentQuestion();
  if (!q) { renderDone(); return; }

  $('#card').innerHTML = `
    <div class="meta">
      <span class="tag">${q.category}</span>
      <span class="src">${q.source}</span>
    </div>
    <h2 class="question">${q.question}</h2>
    <div class="options">
      ${q.options.map((o, i) => `
        <button class="opt" data-i="${i}">
          <span class="letter">${String.fromCharCode(65 + i)}</span>
          <span>${o}</span>
        </button>
      `).join('')}
    </div>
    <div id="feedback"></div>
    <div class="nav-row">
      <button id="skip" class="ghost">Skip →</button>
    </div>
  `;
  document.querySelectorAll('.opt').forEach(b =>
    b.addEventListener('click', () => handleAnswer(parseInt(b.dataset.i, 10)))
  );
  $('#skip').addEventListener('click', next);
  updateHeader();
}

function handleAnswer(picked) {
  const q = currentQuestion();
  const correct = picked === q.answer_index;
  const state = SrsStore.loadState();
  const prev = state[q.id] || null;
  const updated = SRS.nextState(prev, correct, Date.now());
  if (!prev) SrsStore.incNewToday();
  state[q.id] = updated;
  SrsStore.saveState(state);

  State.session.total++;
  if (correct) {
    State.session.correct++;
    State.combo++;
    if (State.combo >= 3) burst(); else playRight();
    tryVibrate(30);
    shake(true);
  } else {
    State.combo = 0;
    playWrong();
    tryVibrate([80, 50, 80]);
    shake(false);
  }
  tickStreak();

  document.querySelectorAll('.opt').forEach((b, i) => {
    b.disabled = true;
    if (i === q.answer_index) b.classList.add('right');
    if (i === picked && !correct) b.classList.add('wrong');
  });
  $('#feedback').innerHTML = `
    <div class="fb ${correct ? 'ok' : 'no'}">
      ${correct ? '✅ Correct!' : '❌ Try again'}
      <div class="expl">${q.explanation}</div>
    </div>
    <button id="nextBtn" class="primary">Next →</button>
  `;
  $('#nextBtn').addEventListener('click', next);
  updateHeader();
}

function next() {
  State.idx++;
  renderMCQ();
}

function currentQuestion() {
  if (State.idx >= State.order.length) return null;
  return State.questions[State.order[State.idx]];
}

function renderDone() {
  const state = SrsStore.loadState();
  const startToday = startOfToday();
  const todayAnswered = Object.values(state).filter(r => (r.last_answered_at || 0) >= startToday).length;
  const sess = State.session;
  const pct = sess.total > 0 ? Math.round((sess.correct / sess.total) * 100) : 0;
  $('#card').innerHTML = `
    <div class="done">
      <h2>🏆 Round Complete</h2>
      <p style="font-size:1.1rem;margin:0.5rem 0;">This session: <b>${sess.correct} / ${sess.total}</b> correct · ${pct}%</p>
      <p class="muted">📈 Today: ${todayAnswered} answered · 🔥 ${State.streak}-day streak</p>
      <button class="ghost" onclick="renderDashboard()">Back to Dashboard</button>
    </div>
  `;
}

function resetSession() { State.session = { correct: 0, total: 0 }; }

window.restart = () => {
  resetSession();
  rebuildDeck();
  if (State.order.length === 0) {
    renderDashboard();
  } else {
    renderMCQ();
  }
};

// ---------- Audio mode ----------
const SPEEDS = [0.5, 0.75, 1.0, 1.25];
function getSpeed() { return parseFloat(localStorage.getItem('speed') || '0.75'); }
function setSpeed(s) {
  localStorage.setItem('speed', s);
  if (sharedAudio) sharedAudio.playbackRate = s;
  document.querySelectorAll('.speed-btn').forEach(b =>
    b.classList.toggle('active', parseFloat(b.dataset.s) === s));
}

function renderAudioIntro() {
  const s = getSpeed();
  $('#card').innerHTML = `
    <div class="audio-view">
      <div class="riding">🏍️ Riding Mode</div>
      <div style="background:#7f1d1d;color:#fecaca;padding:0.7rem;border-radius:8px;margin:0.5rem 0;font-size:0.9rem;line-height:1.6;">
        <b>⚠️ iPhone reminder:</b><br>
        1. Flip the <b>silent switch</b> on the left side to ring position (not orange).<br>
        2. Turn up the volume.<br>
        3. Connect Bluetooth headphones.<br>
        4. Tap the button below to start.
      </div>

      <div class="speed-row">
        <span class="speed-label">Speed</span>
        ${SPEEDS.map(v => `<button class="speed-btn ${v===s?'active':''}" data-s="${v}" onclick="setSpeed(${v})">${v}x</button>`).join('')}
      </div>

      <button class="primary" onclick="primeAndStart()">▶️ Start</button>
      <div class="stage" style="margin-top:1rem;color:#94a3b8;">Starting from Q${State.idx + 1}</div>
    </div>
  `;
}
window.setSpeed = setSpeed;

// Single persistent Audio element — iOS needs .play() synchronously in gesture
let sharedAudio = null;
function getAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
    sharedAudio.playbackRate = getSpeed();
  }
  sharedAudio.playbackRate = getSpeed();
  return sharedAudio;
}

window.primeAndStart = () => {
  // CRITICAL: synchronous inside the click handler (iOS Chrome/Safari requirement)
  ensureAudio();
  const q = currentQuestion();
  if (!q) return;
  const a = getAudio();
  a.src = `audio/${q.id}/q.mp3?v=1`;
  const p = a.play();
  if (p && p.catch) p.catch(err => console.warn('initial play rejected:', err));
  // Now async path takes over
  startAudio({ firstAlreadyPlaying: true });
};

async function startAudio({ firstAlreadyPlaying = false } = {}) {
  State.audioStopped = false;
  requestWakeLock();
  const q = currentQuestion();
  const s = getSpeed();
  $('#card').innerHTML = `
    <div class="audio-view">
      <div class="riding">🏍️ Riding Mode — Playing</div>
      <h2 id="audioQ">${q ? q.question : 'Loading…'}</h2>
      <div id="audioOpts" class="audio-opts">${q ? q.options.map((o, i) =>
        `<div class="aopt"><span class="letter">${String.fromCharCode(65 + i)}</span><span>${o}</span></div>`).join('') : ''}</div>
      <div id="audioStage" class="stage">🎧 Question</div>
      <div class="speed-row">
        <span class="speed-label">Speed</span>
        ${SPEEDS.map(v => `<button class="speed-btn ${v===s?'active':''}" data-s="${v}" onclick="setSpeed(${v})">${v}x</button>`).join('')}
      </div>
      <button class="ghost" onclick="stopAudio()">⏹ Stop</button>
    </div>
  `;
  playLoop({ firstAlreadyPlaying });
}

async function playLoop({ firstAlreadyPlaying = false } = {}) {
  let first = firstAlreadyPlaying;
  let lap = 1;
  while (!State.audioStopped) {
    if (State.idx >= State.order.length) {
      lap++;
      rebuildDeck();
      if (State.order.length === 0) {
        // No due items right now — fall back to full pool reshuffle for continuous listening
        State.order = shuffle([...State.questions.keys()]);
      }
      $('#audioStage').textContent = `🔄 Lap ${lap} — reshuffling…`;
      await wait(2500);
      if (State.audioStopped) break;
    }
    const q = currentQuestion();
    $('#audioQ').textContent = q.question;
    $('#audioOpts').innerHTML = q.options.map((o, i) =>
      `<div class="aopt"><span class="letter">${String.fromCharCode(65 + i)}</span><span>${o}</span></div>`).join('');

    $('#audioStage').textContent = '🎧 Question';
    if (first) {
      await waitForCurrentEnd();
      first = false;
    } else {
      await playMp3(`audio/${q.id}/q.mp3`);
    }
    if (State.audioStopped) break;
    await wait(700);

    $('#audioStage').textContent = '🔢 Options';
    await playMp3(`audio/${q.id}/opts.mp3`);
    if (State.audioStopped) break;

    $('#audioStage').textContent = '⏳ Think 5 seconds…';
    await wait(5000);
    if (State.audioStopped) break;

    const ans = String.fromCharCode(65 + q.answer_index);
    $('#audioStage').textContent = `✅ Answer: ${ans}`;
    await playMp3(`audio/${q.id}/ans.mp3`);
    await wait(1200);
    State.idx++;
    updateHeader();
  }
}

// Play MP3 by swapping src on the single shared Audio element (iOS-safe)
let currentAudio = null;
function playMp3(url) {
  return new Promise((resolve) => {
    const a = getAudio();
    currentAudio = a;
    a.src = url;
    const applyRate = () => { a.playbackRate = getSpeed(); a.defaultPlaybackRate = getSpeed(); };
    a.onloadedmetadata = applyRate;
    a.onplay = applyRate;
    a.onended = () => resolve();
    a.onerror = () => { console.warn('MP3 error:', url); resolve(); };
    applyRate();
    const p = a.play();
    if (p && p.then) p.then(applyRate).catch(err => { console.warn('play() rejected:', err); resolve(); });
  });
}

function waitForCurrentEnd() {
  return new Promise((resolve) => {
    const a = getAudio();
    if (a.paused || a.ended) return resolve();
    const onEnd = () => { a.removeEventListener('ended', onEnd); resolve(); };
    a.addEventListener('ended', onEnd);
  });
}

function wait(ms) { return new Promise(r => State.audioTimer = setTimeout(r, ms)); }

function stopAudioCleanup() {
  State.audioStopped = true;
  clearTimeout(State.audioTimer);
  if (sharedAudio) { try { sharedAudio.pause(); sharedAudio.src = ''; sharedAudio.removeAttribute('src'); } catch (_) {} }
  currentAudio = null;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWakeLock();
}

window.stopAudio = () => {
  stopAudioCleanup();
  if (State.mode === 'audio') renderAudioIntro();
};

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { State.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() { State.wakeLock?.release?.(); State.wakeLock = null; }

// ---------- Audio feedback (mobile-safe) ----------
let audioCtx;
function ensureAudio() {
  if (!audioCtx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
function beep(freq, dur, vol = 0.2) {
  const ctx = ensureAudio();
  if (!ctx) return;
  try {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    o.connect(g); g.connect(ctx.destination);
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
function playRight() { beep(880, 0.1); setTimeout(() => beep(1320, 0.12), 90); }
function playWrong() { beep(220, 0.18, 0.25); setTimeout(() => beep(180, 0.2, 0.25), 120); }
function burst() { beep(784, 0.08); setTimeout(() => beep(988, 0.08), 80); setTimeout(() => beep(1319, 0.14), 160); }

function tryVibrate(pattern) {
  if ('vibrate' in navigator) {
    try { navigator.vibrate(pattern); } catch (_) {}
  }
}

function shake(ok) {
  const c = $('#card');
  if (!c) return;
  c.classList.remove('shake-ok', 'shake-no');
  void c.offsetWidth;
  c.classList.add(ok ? 'shake-ok' : 'shake-no');
}

// ---------- header ----------
function updateHeader() {
  const done = State.idx;
  const total = State.order.length;
  $('#streak').textContent = `🔥 ${State.streak}`;
  $('#combo').textContent = State.combo >= 2 ? `⚡ ${State.combo} Combo` : '';
  $('#progress').style.width = `${(done / total) * 100}%`;
  $('#counter').textContent = `${done} / ${total}`;
}

// ---------- Dashboard ----------
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
const ymd = SRS.ymd;

function renderDashboard() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const now = Date.now();
  const s = SRS.summary(state, State.questions, now);
  const settings = SrsStore.loadSettings();
  const taken = SrsStore.getNewToday();
  const dueReviews = Math.max(0, s.due - s.new);
  const newAvailable = Math.max(0, Math.min(s.new, settings.new_per_day - taken));
  const todayGoal = dueReviews + newAvailable + taken;
  const startToday = startOfToday();
  const todayDone = Object.values(state).filter(r => (r.last_answered_at || 0) >= startToday).length;
  const pct = todayGoal > 0 ? Math.min(100, (todayDone / todayGoal) * 100) : 0;

  const curr = SrsStore.ensureCurriculum(State.questions, settings);
  const doneDays = SRS.completedDays(curr, state);
  const totalDays = curr.days.length;
  const completedCount = doneDays.size;
  const remainingDays = totalDays - completedCount;
  const firstIncompleteDay = curr.days.find(d => !doneDays.has(d.day));
  const projDate = new Date();
  projDate.setDate(projDate.getDate() + Math.max(0, remainingDays - 1));
  const projStr = ymd(projDate);
  const plannedEnd = new Date(curr.start_date + 'T00:00:00');
  plannedEnd.setDate(plannedEnd.getDate() + totalDays - 1);
  const dayMs = 24 * 60 * 60 * 1000;
  const behind = Math.floor((projDate - plannedEnd) / dayMs);
  const badgeText = behind > 0 ? ` (${behind} day${behind > 1 ? 's' : ''} behind)` : (behind < 0 ? ' (ahead)' : ' (on track)');

  $('#card').innerHTML = `
    <div class="dashboard">
      <div class="muted" style="margin-bottom:0.4rem;">
        Projected: <b>${projStr}</b>${badgeText}<br>
        Day ${firstIncompleteDay ? firstIncompleteDay.day : totalDays} of ${totalDays} · Started ${curr.start_date}
      </div>
      <h2>Today</h2>
      <div class="progress-large"><div class="bar" style="width:${pct}%"></div></div>
      <div class="muted">${todayDone} / ${todayGoal} done</div>

      <ul class="metric-list">
        <li>📘 Due Reviews <b>${dueReviews}</b></li>
        <li>🆕 New Available <b>${newAvailable}</b></li>
        <li>🎓 Graduated <b>${s.graduated}</b></li>
      </ul>

      <div class="dash-actions">
        <button class="primary"${(dueReviews + newAvailable) === 0 ? ' disabled title="All done for today — come back tomorrow"' : ''} onclick="enterQuiz()">Quiz</button>
        <button class="primary"${(dueReviews + newAvailable) === 0 ? ' disabled title="All done for today — come back tomorrow"' : ''} onclick="enterRiding()">Riding</button>
        <button class="ghost" onclick="location.hash='calendar'">📅 Calendar</button>
        <button class="ghost" onclick="location.hash='list'">📋 Question List</button>
        <button class="ghost" onclick="openSettings()">⚙ Settings</button>
      </div>
    </div>
  `;
  updateHeader();
}

// ---------- Shared cell-stats helper (keeps Calendar / Day / Date views aligned) ----------
function computeCellStats(cellStartMs, day, state, todayStart) {
  const cellEnd = cellStartMs + 86400000;
  let total = 0, answered = 0;

  if (cellStartMs < todayStart) {
    for (const q of State.questions) {
      const r = state[q.id];
      if (r && (r.last_answered_at || 0) >= cellStartMs && r.last_answered_at < cellEnd) answered++;
    }
    if (day) total = day.question_ids.length;
    else {
      total = answered;
      for (const q of State.questions) {
        const r = state[q.id];
        if (!r) continue;
        const answeredOnD = (r.last_answered_at || 0) >= cellStartMs && r.last_answered_at < cellEnd;
        const dueOnD = r.due_at != null && r.due_at >= cellStartMs && r.due_at < cellEnd;
        if (!answeredOnD && dueOnD) total++;
      }
    }
  } else if (cellStartMs === todayStart) {
    const counted = new Set();
    if (day) for (const qid of day.question_ids) {
      if (!state[qid]) { total++; counted.add(qid); }
    }
    for (const q of State.questions) {
      if (counted.has(q.id)) continue;
      const r = state[q.id];
      if (r && r.due_at != null && r.due_at >= cellStartMs && r.due_at < cellEnd) { total++; counted.add(q.id); }
    }
    for (const q of State.questions) {
      if (counted.has(q.id)) continue;
      const r = state[q.id];
      if (r && r.due_at != null && r.due_at < cellStartMs) { total++; counted.add(q.id); }
    }
    for (const q of State.questions) {
      if (counted.has(q.id)) continue;
      const r = state[q.id];
      if (r && r.due_at == null) { total++; counted.add(q.id); }
    }
    for (const q of State.questions) {
      const r = state[q.id];
      if (r && (r.last_answered_at || 0) >= cellStartMs && r.last_answered_at < cellEnd) answered++;
    }
  } else {
    const counted = new Set();
    if (day) for (const qid of day.question_ids) {
      if (!state[qid]) { total++; counted.add(qid); }
    }
    for (const q of State.questions) {
      if (counted.has(q.id)) continue;
      const r = state[q.id];
      if (r && r.due_at != null && r.due_at >= cellStartMs && r.due_at < cellEnd) { total++; counted.add(q.id); }
    }
  }
  return { total, answered };
}

function effectiveDateForDay(curr, state, dayN) {
  if (!curr || !curr.days) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const done = SRS.completedDays(curr, state);
  const firstIncomplete = curr.days.find(d => !done.has(d.day));
  let cursor = new Date(curr.start_date + 'T00:00:00').getTime();
  for (const d of curr.days) {
    let eff;
    if (done.has(d.day)) { eff = cursor; }
    else {
      if (firstIncomplete && d.day === firstIncomplete.day) cursor = Math.max(cursor, today.getTime());
      eff = cursor;
    }
    if (d.day === dayN) return eff;
    cursor += 86400000;
  }
  return null;
}

// ---------- Calendar ----------
function renderCalendar() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const curr = SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  const done = SRS.completedDays(curr, state);
  const firstIncomplete = curr.days.find(d => !done.has(d.day));

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const startDate = new Date(curr.start_date + 'T00:00:00');

  // Slide-forward: completed days keep their completion date (assume sequential from start);
  // first incomplete anchors at max(cursor, today); subsequent upcoming days flow from there.
  const dayEffective = {};
  let cursor = new Date(startDate);
  for (const d of curr.days) {
    if (done.has(d.day)) {
      dayEffective[d.day] = new Date(cursor);
    } else {
      if (firstIncomplete && d.day === firstIncomplete.day) {
        cursor = new Date(Math.max(cursor.getTime(), today.getTime()));
      }
      dayEffective[d.day] = new Date(cursor);
    }
    cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 1);
  }
  const dateToDay = {};
  for (const [num, dt] of Object.entries(dayEffective)) dateToDay[ymd(dt)] = parseInt(num, 10);

  const viewMonth = State.calMonth || new Date(today.getFullYear(), today.getMonth(), 1);
  State.calMonth = viewMonth;

  const gridStart = new Date(viewMonth);
  gridStart.setDate(1 - viewMonth.getDay());

  const cells = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    cells.push({ date: d, inMonth: d.getMonth() === viewMonth.getMonth(), dayN: dateToDay[ymd(d)] });
  }
  const monthLabel = viewMonth.toLocaleString('en-US', { month: 'long', year: 'numeric' });

  $('#card').innerHTML = `
    <div class="cal-header">
      <button onclick="calNav(-1)">‹</button>
      <span class="cal-title">${monthLabel}</span>
      <button onclick="calNav(1)">›</button>
    </div>
    <div class="cal-grid">
      ${[{l:'S',w:1},{l:'M',w:0},{l:'T',w:0},{l:'W',w:0},{l:'T',w:0},{l:'F',w:0},{l:'S',w:1}].map(x => `<div class="cal-dow${x.w?' weekend':''}">${x.l}</div>`).join('')}
      ${cells.map(c => {
        if (!c.inMonth) return `<div class="cal-cell empty"><span class="cell-top"><span class="date"></span></span></div>`;
        const day = curr.days.find(d => d.day === c.dayN);
        const isToday = ymd(c.date) === ymd(today);
        const isDone = day && done.has(day.day);

        const cellStart = new Date(c.date); cellStart.setHours(0, 0, 0, 0);
        const cellStartMs = cellStart.getTime();
        const todayStart = startOfToday();
        const stats = computeCellStats(cellStartMs, day, state, todayStart);
        const total = stats.total, answered = stats.answered;
        const clickable = (cellStartMs >= todayStart) && (!!day || total > 0);

        const hasReviewsOnly = !day && total > 0;
        const isSlipped = day && !isDone && c.date < today;

        const cls = ['cal-cell'];
        if (!day && !hasReviewsOnly) cls.push('blank');
        if (isDone) cls.push('done');
        else if (isToday && (day || hasReviewsOnly)) cls.push('today');
        else if (isSlipped) cls.push('slip');

        const clickAttr = clickable
          ? (day ? `onclick="location.hash='day=${day.day}'"` : `onclick="location.hash='date=${ymd(c.date)}'"`)
          : '';
        const centerHtml = (!day && !hasReviewsOnly)
          ? ''
          : isDone
            ? `<div class="cell-center done-check">✓</div>`
            : total > 0
              ? `<div class="cell-center">${answered}/${total}</div>`
              : '';
        const inner = `<span class="cell-top"><span class="date">${c.date.getDate()}</span></span>${centerHtml}`;
        return `<div class="${cls.join(' ')}" ${clickAttr}>${inner}</div>`;
      }).join('')}
    </div>
    <button class="ghost" style="margin-top:1rem;" onclick="location.hash='home'">‹ Back</button>
  `;
  updateHeader();
}

window.calNav = (delta) => {
  const m = State.calMonth || new Date();
  State.calMonth = new Date(m.getFullYear(), m.getMonth() + delta, 1);
  renderCalendar();
};

// ---------- Day Page ----------
function renderDayPage(dayN) {
  stopAudioCleanup();
  const curr = SrsStore.loadCurriculum();
  if (!curr) { location.hash = 'home'; return; }
  const day = curr.days.find(d => d.day === dayN);
  if (!day) { location.hash = 'calendar'; return; }
  const state = SrsStore.loadState();
  const items = day.question_ids.map(id => ({ q: State.questions.find(qq => qq.id === id), r: state[id] })).filter(x => x.q);
  const graduated = items.filter(x => x.r && x.r.stage === 'graduated').length;
  // Day is "completed" when every question has been attempted (same rule as Calendar's green check).
  const dayCompleted = SRS.completedDays(curr, state).has(dayN);
  const disabledAttr = dayCompleted ? ' disabled title="All questions completed for this day"' : '';

  const badge = (r) => {
    if (!r || r.stage === 'new') return `<span class="sbadge new">🆕 New</span>`;
    if (r.stage === 'learning') return `<span class="sbadge learning">📖 Learning</span>`;
    if (r.stage === 'review') return `<span class="sbadge review">🔁 Review (${r.consecutive_correct || 0}/3)</span>`;
    if (r.stage === 'graduated') return `<span class="sbadge graduated">🎓 Graduated</span>`;
    return '';
  };

  const categories = [...new Set(items.map(x => x.q.category))].join(' · ');

  $('#card').innerHTML = `
    <div class="day-header">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;color:#f8fafc;">Day ${dayN}</h2>
        <button class="ghost" style="flex:0;padding:0.4rem 0.7rem;margin:0;" onclick="location.hash='calendar'">‹ Back</button>
      </div>
      <div class="sub">${categories}</div>
      <div class="sub">${items.length} questions · ${graduated} graduated · ${items.length - graduated} to go</div>
      <div class="sub">${(() => {
        const eff = effectiveDateForDay(curr, state, dayN);
        if (eff == null) return '';
        const s = computeCellStats(eff, day, state, startOfToday());
        const label = SRS.ymd(new Date(eff)) === SRS.ymd(new Date()) ? 'Today' : SRS.ymd(new Date(eff));
        return s.total > 0 ? `📅 ${label}: <b>${s.answered}/${s.total}</b>` : '';
      })()}</div>
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
      <button class="primary"${disabledAttr} onclick="enterQuizDay(${dayN})">📱 Quiz this day</button>
      <button class="primary"${disabledAttr} onclick="enterRidingDay(${dayN})">🏍️ Riding this day</button>
    </div>
  `;
  updateHeader();
}

window.enterQuizDay = (dayN) => {
  const curr = SrsStore.loadCurriculum();
  const day = curr && curr.days.find(d => d.day === dayN);
  if (!day) return;
  State.order = day.question_ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'mcq';
  resetSession();
  renderMCQ();
};

window.enterRidingDay = (dayN) => {
  const curr = SrsStore.loadCurriculum();
  const day = curr && curr.days.find(d => d.day === dayN);
  if (!day) return;
  State.order = day.question_ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'audio';
  stopAudioCleanup();
  renderAudioIntro();
};

// ---------- Date-scoped (pure review) mode entries ----------
function questionsForDate(dateYmd) {
  const dStart = new Date(dateYmd + 'T00:00:00').getTime();
  const dEnd = dStart + 86400000;
  const state = SrsStore.loadState();
  const curr = SrsStore.loadCurriculum();
  const counted = new Set();
  const ids = [];

  // (a) curriculum new assigned to this date (effective, not planned)
  if (curr) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const startDate = new Date(curr.start_date + 'T00:00:00');
    const doneSet = SRS.completedDays(curr, state);
    const firstIncomplete = curr.days.find(d => !doneSet.has(d.day));
    let cursor = new Date(startDate);
    const eff = {};
    for (const d of curr.days) {
      if (doneSet.has(d.day)) { eff[d.day] = new Date(cursor); }
      else {
        if (firstIncomplete && d.day === firstIncomplete.day) {
          cursor = new Date(Math.max(cursor.getTime(), today.getTime()));
        }
        eff[d.day] = new Date(cursor);
      }
      cursor = new Date(cursor); cursor.setDate(cursor.getDate() + 1);
    }
    for (const d of curr.days) {
      if (ymd(eff[d.day]) !== dateYmd) continue;
      for (const qid of d.question_ids) {
        if (!state[qid] && !counted.has(qid)) { ids.push(qid); counted.add(qid); }
      }
    }
  }
  // (b) reviews scheduled on this date
  for (const q of State.questions) {
    if (counted.has(q.id)) continue;
    const r = state[q.id];
    if (r && r.due_at != null && r.due_at >= dStart && r.due_at < dEnd) {
      ids.push(q.id);
      counted.add(q.id);
    }
  }
  return ids;
}

window.enterQuizDate = (dateYmd) => {
  const ids = questionsForDate(dateYmd);
  if (!ids.length) return;
  State.order = ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'mcq';
  resetSession();
  renderMCQ();
};

window.enterRidingDate = (dateYmd) => {
  const ids = questionsForDate(dateYmd);
  if (!ids.length) return;
  State.order = ids.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0);
  State.idx = 0;
  State.mode = 'audio';
  stopAudioCleanup();
  renderAudioIntro();
};

function renderDatePage(dateYmd) {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const ids = questionsForDate(dateYmd);
  const items = ids.map(id => ({ q: State.questions.find(qq => qq.id === id), r: state[id] })).filter(x => x.q);

  const badge = (r) => {
    if (!r || r.stage === 'new') return `<span class="sbadge new">🆕 New</span>`;
    if (r.stage === 'learning') return `<span class="sbadge learning">📖 Learning</span>`;
    if (r.stage === 'review') return `<span class="sbadge review">🔁 Review (${r.consecutive_correct || 0}/3)</span>`;
    if (r.stage === 'graduated') return `<span class="sbadge graduated">🎓 Graduated</span>`;
    return '';
  };

  if (!items.length) {
    $('#card').innerHTML = `
      <div class="day-header">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h2 style="margin:0;color:#f8fafc;">${dateYmd}</h2>
          <button class="ghost" style="flex:0;padding:0.4rem 0.7rem;margin:0;" onclick="location.hash='calendar'">‹ Back</button>
        </div>
        <div class="sub">Nothing scheduled for this date.</div>
      </div>`;
    updateHeader();
    return;
  }

  const todayY = ymd(new Date());
  const isFuture = dateYmd > todayY;
  const disabledAttr = isFuture ? ' disabled title="Future date — wait until the day arrives"' : '';

  const categories = [...new Set(items.map(x => x.q.category))].join(' · ');
  $('#card').innerHTML = `
    <div class="day-header">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <h2 style="margin:0;color:#f8fafc;">${dateYmd} · Reviews</h2>
        <button class="ghost" style="flex:0;padding:0.4rem 0.7rem;margin:0;" onclick="location.hash='calendar'">‹ Back</button>
      </div>
      <div class="sub">${categories}</div>
      <div class="sub">${items.length} question${items.length === 1 ? '' : 's'} scheduled</div>
      <div class="sub">${(() => {
        const cellStartMs = new Date(dateYmd + 'T00:00:00').getTime();
        const s = computeCellStats(cellStartMs, null, state, startOfToday());
        return s.total > 0 ? `📅 ${dateYmd}: <b>${s.answered}/${s.total}</b>` : '';
      })()}</div>
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
      <button class="primary"${disabledAttr} onclick="enterQuizDate('${dateYmd}')">📱 Quiz these reviews</button>
      <button class="primary"${disabledAttr} onclick="enterRidingDate('${dateYmd}')">🏍️ Riding these reviews</button>
    </div>
  `;
  updateHeader();
}

// ---------- Question List ----------
function renderQuestionList() {
  stopAudioCleanup();
  const state = SrsStore.loadState();
  const curr = SrsStore.loadCurriculum();
  const list = SRS.questionList(State.questions, state, Date.now(), curr);
  const offsets = [0, 1, 3, 7, 30, 90, 180];
  const fmtMd = (ms) => {
    const d = new Date(ms);
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
  };

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
        let cls = '', label = '';
        if (r.scheduled) { cls = 'scheduled'; label = 'Scheduled'; }
        else if (r.daysFromToday < 0) { cls = 'overdue'; label = `Overdue ${-r.daysFromToday}d`; }
        else if (r.daysFromToday === 0) { cls = 'today'; label = 'Today'; }
        else { label = `+${r.daysFromToday} day${r.daysFromToday === 1 ? '' : 's'}`; }
        return `<div class="q-row" id="qrow-${i}" data-days="${r.daysFromToday}" onclick="openQuestionFromList('${r.id}')">
          <span class="q-text">${r.text}</span>
          <span class="q-date">${fmtMd(r.scheduledDateMs)}</span>
          <span class="q-days ${cls}">${label}</span>
        </div>`;
      }).join('')}
    </div>
  `;
  updateHeader();
}

window.jumpToOffset = (n) => {
  const rows = [...document.querySelectorAll('.q-row')];
  const target = rows.find(el => parseInt(el.dataset.days, 10) >= n);
  if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.querySelectorAll('#offsetBar button').forEach(b => {
    b.classList.toggle('active', parseInt(b.dataset.offset, 10) === n);
  });
};

window.openQuestionFromList = (qId) => {
  const curr = SrsStore.loadCurriculum();
  const dayN = SRS.getDayForQuestion(curr, qId);
  if (dayN != null) location.hash = 'day=' + dayN;
};

// ---------- Router ----------
function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  if (hash === 'home') return renderDashboard();
  if (hash === 'calendar') return renderCalendar();
  if (hash === 'list') return renderQuestionList();
  const mDay = hash.match(/^day=(\d+)$/);
  if (mDay) return renderDayPage(parseInt(mDay[1], 10));
  const mDate = hash.match(/^date=(\d{4}-\d{2}-\d{2})$/);
  if (mDate) return renderDatePage(mDate[1]);
  renderDashboard();
}
window.addEventListener('hashchange', route);

window.enterQuiz = () => { State.mode = 'mcq'; resetSession(); rebuildDeck(); renderMCQ(); };
window.enterRiding = () => { State.mode = 'audio'; stopAudio(); rebuildDeck(); renderAudioIntro(); };

// ---------- Two-way binding helpers ----------
function todayYmd() { return ymd(new Date()); }
function remainingNewCount() {
  const state = SrsStore.loadState();
  let seen = 0;
  for (const q of State.questions) if (state[q.id]) seen++;
  return Math.max(0, State.questions.length - seen);
}
const computeFinishedYmd = SRS.computeFinishedYmd;
const computeNewPerDay = SRS.computeNewPerDay;

// ---------- Settings modal ----------
window.openSettings = () => {
  const s = SrsStore.loadSettings();
  const curr = SrsStore.ensureCurriculum(State.questions, s);
  const remaining = remainingNewCount();
  const start = curr.start_date || todayYmd();
  $('#newPerDay').value = s.new_per_day;
  $('#finishedDate').value = computeFinishedYmd(s.new_per_day, remaining > 0 ? remaining : State.questions.length, start);
  $('#settingsModal').hidden = false;

  // Live two-way binding — attach once via onchange (idempotent)
  $('#newPerDay').oninput = () => {
    const n = Math.max(1, Math.min(50, parseInt($('#newPerDay').value, 10) || 1));
    const rem = remaining > 0 ? remaining : State.questions.length;
    $('#finishedDate').value = computeFinishedYmd(n, rem, todayYmd());
  };
  $('#finishedDate').oninput = () => {
    const f = $('#finishedDate').value;
    if (!f) return;
    const rem = remaining > 0 ? remaining : State.questions.length;
    $('#newPerDay').value = computeNewPerDay(f, rem, todayYmd());
  };
};
window.closeSettings = () => { $('#settingsModal').hidden = true; };

// ---------- confirmDialog ----------
let _confirmResolve = null;
function confirmDialog({ title, body = '', actions }) {
  return new Promise((resolve) => {
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
        const r = _confirmResolve;
        closeConfirm();
        if (r) r(actions[i].value);
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
  if (choice == null) return;

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
window.resetAllSrs = async () => {
  const state = SrsStore.loadState();
  const answered = Object.keys(state).length;
  const curr = SrsStore.loadCurriculum();
  const dayStr = curr ? `Day ${SRS.completedDays(curr, state).size} of ${curr.days.length}` : '';
  const body = `You'll lose:\n· ${answered} answered record${answered === 1 ? '' : 's'}\n· ${State.streak}-day streak\n· ${dayStr}`;
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

// Preload voice list (iOS needs this called once)
function warmVoices() {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', async () => {
  await Promise.all([loadQuestions(), loadVersion()]);
  runMigration();
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  tickStreak();
  warmVoices();
  $('#appVer').textContent = APP_VERSION;

  $('.brand').addEventListener('click', () => {
    // Force home render regardless of current hash (mode entries like enterRiding
    // don't change the hash, so just setting location.hash='home' wouldn't fire
    // hashchange when we're already on #home).
    stopAudioCleanup();
    if (location.hash === '' || location.hash === '#home') {
      renderDashboard();
    } else {
      location.hash = 'home';
    }
  });
  $('.brand').style.cursor = 'pointer';

  route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});
