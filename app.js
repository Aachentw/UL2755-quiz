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
    <h2 class="question">${q.question_zh}</h2>
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
      <button id="skip" class="ghost">跳過 →</button>
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
    beep(880, 0.08);
    if (State.combo >= 3) burst();
  } else {
    State.combo = 0;
    beep(220, 0.15);
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
      ${correct ? '✅ 答對！' : '❌ 再看一次'}
      <div class="expl">${q.explanation_zh}</div>
    </div>
    <button id="nextBtn" class="primary">下一題 →</button>
  `;
  $('#nextBtn').addEventListener('click', next);
  if ('vibrate' in navigator) navigator.vibrate(correct ? 30 : [60, 40, 60]);
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
      <h2>🏆 本輪結束</h2>
      <p>答對 ${right} / ${total}</p>
      <p>🔥 Streak: ${State.streak} 天</p>
      <button class="primary" onclick="restart()">重新開始</button>
    </div>
  `;
}

window.restart = () => { State.idx = 0; State.order = shuffle([...State.questions.keys()]); renderMCQ(); };

// ---------- Audio mode ----------
async function startAudio() {
  stopAudio();
  State.audioStopped = false;
  await requestWakeLock();
  $('#card').innerHTML = `
    <div class="audio-view">
      <div class="riding">🏍️ 騎車模式播放中</div>
      <h2 id="audioQ">載入中…</h2>
      <div id="audioOpts" class="audio-opts"></div>
      <div id="audioStage" class="stage">—</div>
      <button class="ghost" onclick="stopAudio()">⏹ 停止</button>
    </div>
  `;
  playLoop();
}

async function playLoop() {
  while (!State.audioStopped && State.idx < State.order.length) {
    const q = currentQuestion();
    $('#audioQ').textContent = q.question_zh;
    $('#audioOpts').innerHTML = q.options.map((o, i) =>
      `<div class="aopt">${String.fromCharCode(65 + i)}. ${o}</div>`).join('');
    $('#audioStage').textContent = '🎧 題目';
    await speakSmart(q.question_zh);
    if (State.audioStopped) break;
    await wait(700);

    $('#audioStage').textContent = '🔢 四個選項';
    for (let i = 0; i < q.options.length; i++) {
      await speakSmart(`選項 ${String.fromCharCode(65 + i)}，${q.options[i]}`);
      if (State.audioStopped) return;
    }
    $('#audioStage').textContent = '⏳ 思考 5 秒…';
    await wait(5000);
    if (State.audioStopped) break;

    const ans = String.fromCharCode(65 + q.answer_index);
    $('#audioStage').textContent = `✅ 答案 ${ans}`;
    await speakSmart(`答案是 ${ans}。`);
    await speakSmart(q.explanation_zh);
    await wait(1200);
    State.idx++;
    updateHeader();
  }
  if (!State.audioStopped) {
    $('#audioStage').textContent = '🏁 播放結束';
    await speakSmart('本輪播放結束，請靠邊停車休息。');
  }
}

// Smart bilingual TTS: split text by CJK/Latin runs, speak each with matching lang
function speakSmart(text) {
  return new Promise((resolve) => {
    if (!('speechSynthesis' in window)) return resolve();
    speechSynthesis.cancel();
    const segs = splitBilingual(text);
    let i = 0;
    const speakNext = () => {
      if (State.audioStopped || i >= segs.length) return resolve();
      const seg = segs[i++];
      const u = new SpeechSynthesisUtterance(seg.text);
      u.lang = seg.lang;
      u.rate = 0.95;
      u.onend = speakNext;
      u.onerror = speakNext;
      speechSynthesis.speak(u);
    };
    speakNext();
  });
}

function splitBilingual(text) {
  // Split into runs of CJK+punct vs Latin/digits
  const parts = [];
  const re = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？、：；（）「」『』]+|[^\u4e00-\u9fff\u3000-\u303f\uff00-\uffef，。！？、：；（）「」『』]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const s = m[0].trim();
    if (!s) continue;
    const isCJK = /[\u4e00-\u9fff]/.test(s);
    parts.push({ text: s, lang: isCJK ? 'zh-TW' : 'en-US' });
  }
  return parts.length ? parts : [{ text, lang: 'zh-TW' }];
}

function wait(ms) { return new Promise(r => State.audioTimer = setTimeout(r, ms)); }

window.stopAudio = () => {
  State.audioStopped = true;
  clearTimeout(State.audioTimer);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  releaseWakeLock();
};

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try { State.wakeLock = await navigator.wakeLock.request('screen'); } catch (_) {}
}
function releaseWakeLock() { State.wakeLock?.release?.(); State.wakeLock = null; }

// ---------- Audio feedback ----------
let audioCtx;
function beep(freq, dur) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = freq;
    o.connect(g); g.connect(audioCtx.destination);
    g.gain.setValueAtTime(0.15, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
    o.start(); o.stop(audioCtx.currentTime + dur);
  } catch (_) {}
}
function burst() { beep(660, 0.06); setTimeout(() => beep(880, 0.06), 80); setTimeout(() => beep(1100, 0.1), 160); }

// ---------- header ----------
function updateHeader() {
  const done = State.idx;
  const total = State.order.length;
  $('#streak').textContent = `🔥 ${State.streak}`;
  $('#combo').textContent = State.combo >= 2 ? `⚡ ${State.combo} Combo` : '';
  $('#progress').style.width = `${(done / total) * 100}%`;
  $('#counter').textContent = `${done} / ${total}`;
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded', async () => {
  await loadQuestions();
  tickStreak();

  $('#modeMcq').addEventListener('click', () => { State.mode = 'mcq'; setActive(); renderMCQ(); });
  $('#modeAudio').addEventListener('click', () => { State.mode = 'audio'; setActive(); startAudio(); });
  $('#wrongOnly').addEventListener('click', () => {
    if (!State.wrongPool.length) return alert('還沒有錯題～');
    State.order = shuffle(State.wrongPool.map(id => State.questions.findIndex(q => q.id === id)).filter(i => i >= 0));
    State.idx = 0;
    (State.mode === 'audio') ? startAudio() : renderMCQ();
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
