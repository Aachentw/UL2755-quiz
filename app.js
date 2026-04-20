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
  answered: JSON.parse(localStorage.getItem('answered') || '{}'),
  wrongPool: JSON.parse(localStorage.getItem('wrongPool') || '[]'),
  wakeLock: null,
  audioTimer: null,
  audioStopped: false,
};

const $ = (s) => document.querySelector(s);
const todayKey = () => new Date().toISOString().slice(0, 10);

// ---------- load ----------
async function loadQuestions() {
  const res = await fetch('questions.json?v=' + Date.now());
  State.questions = await res.json();
  State.order = shuffle([...State.questions.keys()]);
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
  stopAudio();
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
  State.answered[q.id] = { picked, correct, t: Date.now() };

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
    if (!State.wrongPool.includes(q.id)) State.wrongPool.push(q.id);
  }
  localStorage.setItem('answered', JSON.stringify(State.answered));
  localStorage.setItem('wrongPool', JSON.stringify(State.wrongPool));
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
  const total = Object.values(State.answered).length;
  const right = Object.values(State.answered).filter(a => a.correct).length;
  $('#card').innerHTML = `
    <div class="done">
      <h2>🏆 Round Complete</h2>
      <p>Correct: ${right} / ${total}</p>
      <p>🔥 Streak: ${State.streak} days</p>
      <button class="primary" onclick="restart()">Restart</button>
    </div>
  `;
}

window.restart = () => { State.idx = 0; State.order = shuffle([...State.questions.keys()]); renderMCQ(); };

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
        `<div class="aopt">${String.fromCharCode(65 + i)}. ${o}</div>`).join('') : ''}</div>
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
      State.idx = 0;
      State.order = shuffle([...State.questions.keys()]);
      $('#audioStage').textContent = `🔄 Lap ${lap} — reshuffling…`;
      await wait(2500);
      if (State.audioStopped) break;
    }
    const q = currentQuestion();
    $('#audioQ').textContent = q.question;
    $('#audioOpts').innerHTML = q.options.map((o, i) =>
      `<div class="aopt">${String.fromCharCode(65 + i)}. ${o}</div>`).join('');

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

window.stopAudio = () => {
  State.audioStopped = true;
  clearTimeout(State.audioTimer);
  if (currentAudio) { try { currentAudio.pause(); currentAudio.src = ''; } catch (_) {} currentAudio = null; }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWakeLock();
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

// Preload voice list (iOS needs this called once)
function warmVoices() {
  if (!('speechSynthesis' in window)) return;
  speechSynthesis.getVoices();
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadQuestions();
  tickStreak();
  warmVoices();

  $('#modeMcq').addEventListener('click', () => { State.mode = 'mcq'; setActive(); renderMCQ(); });
  $('#modeAudio').addEventListener('click', () => { State.mode = 'audio'; setActive(); stopAudio(); renderAudioIntro(); });
  $('#wrongOnly').addEventListener('click', () => {
    if (!State.wrongPool.length) return alert('No wrong answers yet.');
    State.order = shuffle(State.wrongPool.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0));
    State.idx = 0;
    (State.mode === 'audio') ? renderAudioIntro() : renderMCQ();
  });

  setActive();
  renderMCQ();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

function setActive() {
  $('#modeMcq').classList.toggle('active', State.mode === 'mcq');
  $('#modeAudio').classList.toggle('active', State.mode === 'audio');
}
