// UL2755 Quiz — Stage 1 MVP
// Modes: MCQ (interactive) / Audio (motorcycle hands-free)

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
    const today = new Date().toISOString().slice(0, 10);
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

  if (correct) {
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
  const now = Date.now();
  const s = SRS.summary(state, State.questions, now);
  const total = Object.values(state).length;
  const right = Object.values(state).reduce((n, r) => n + (r.total_correct || 0), 0);
  const moreAvailable = s.due > 0 || s.new > 0;
  $('#card').innerHTML = `
    <div class="done">
      <h2>🏆 Round Complete</h2>
      <p>Correct answers so far: ${right} / ${total}</p>
      <p>🔥 Streak: ${State.streak} days</p>
      ${moreAvailable
        ? '<button class="primary" onclick="restart()">Continue</button>'
        : '<p class="muted">No more questions due. Great job — come back later!</p>'}
      <button class="ghost" onclick="renderDashboard()">Back to Dashboard</button>
    </div>
  `;
}

window.restart = () => {
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
  if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ''; } catch (_) {} currentAudio = null; }
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
function ymd(d) { return d.toISOString().slice(0, 10); }

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
        <button class="primary" onclick="enterQuiz()">Quiz</button>
        <button class="primary" onclick="enterRiding()">Riding</button>
        <button class="ghost" onclick="location.hash='calendar'">📅 Calendar</button>
        <button class="ghost" onclick="openSettings()">⚙ Settings</button>
      </div>
    </div>
  `;
  updateHeader();
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
      ${['S','M','T','W','T','F','S'].map(x => `<div class="cal-dow">${x}</div>`).join('')}
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
        const badge = day ? `Day ${day.day}<br>${day.question_ids.length}Q` : '';
        const clickAttr = day ? `onclick="location.hash='day=${day.day}'"` : '';
        return `<div class="${cls.join(' ')}" ${clickAttr}><span class="date">${c.date.getDate()}</span><span class="badge">${badge}</span></div>`;
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

// ---------- Router ----------
function route() {
  const hash = location.hash.replace(/^#/, '') || 'home';
  if (hash === 'home') return renderDashboard();
  if (hash === 'calendar') return renderCalendar();
  const m = hash.match(/^day=(\d+)$/);
  if (m) return renderDayPage(parseInt(m[1], 10));
  renderDashboard();
}
window.addEventListener('hashchange', route);

window.enterQuiz = () => { State.mode = 'mcq'; setActive(); rebuildDeck(); renderMCQ(); };
window.enterRiding = () => { State.mode = 'audio'; setActive(); stopAudio(); rebuildDeck(); renderAudioIntro(); };

// ---------- Settings modal ----------
window.openSettings = () => {
  const s = SrsStore.loadSettings();
  $('#newPerDay').value = s.new_per_day;
  $('#sessionCap').value = s.session_cap == null ? '' : s.session_cap;
  $('#settingsModal').hidden = false;
};
window.closeSettings = () => { $('#settingsModal').hidden = true; };
window.saveSettingsFromForm = () => {
  const n = parseInt($('#newPerDay').value, 10);
  const capStr = $('#sessionCap').value.trim();
  const cap = capStr === '' ? null : parseInt(capStr, 10);
  SrsStore.saveSettings({
    new_per_day: isNaN(n) ? 10 : Math.max(1, Math.min(50, n)),
    session_cap: (cap == null || isNaN(cap) || cap <= 0) ? null : Math.min(100, cap),
    order: 'reviews_first',
  });
  localStorage.removeItem('srs_curriculum');
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  closeSettings();
  renderDashboard();
};
window.resetAllSrs = () => {
  if (!confirm('Really reset ALL SRS progress?')) return;
  if (!confirm('This cannot be undone. Still reset?')) return;
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
  await loadQuestions();
  runMigration();
  SrsStore.ensureCurriculum(State.questions, SrsStore.loadSettings());
  tickStreak();
  warmVoices();

  $('#modeMcq').addEventListener('click', () => { State.mode = 'mcq'; setActive(); rebuildDeck(); renderMCQ(); });
  $('#modeAudio').addEventListener('click', () => { State.mode = 'audio'; setActive(); stopAudio(); rebuildDeck(); renderAudioIntro(); });
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

  $('.brand').addEventListener('click', () => { location.hash = 'home'; });
  $('.brand').style.cursor = 'pointer';
  $('#modeCal').addEventListener('click', () => { location.hash = 'calendar'; });

  setActive();
  route();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

function setActive() {
  $('#modeMcq').classList.toggle('active', State.mode === 'mcq');
  $('#modeAudio').classList.toggle('active', State.mode === 'audio');
}
