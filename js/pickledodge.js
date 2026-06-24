import { db, doc, updateDoc, increment } from './firebase.js';
import { state } from './state.js';

const DURATION = 30;

let _running  = false;
let _score    = 0;
let _timeLeft = DURATION;
let _spawnT   = null;
let _tickT    = null;

export function initGame() {
  document.getElementById('gameBtn')?.addEventListener('click', _open);
}

// ── Overlay ───────────────────────────────────────────────────────────────────

function _open() {
  if (document.getElementById('pickledodge')) return;

  const div = document.createElement('div');
  div.id = 'pickledodge';
  div.innerHTML = `
    <div class="pd-header">
      <span class="pd-title">🥒 Pickle-Dodge</span>
      <div class="pd-hud">
        <span class="pd-timer" id="pdTimer">${DURATION}s</span>
        <span class="pd-score" id="pdScore">0 pts</span>
      </div>
      <button class="pd-close" id="pdClose" aria-label="Close">✕</button>
    </div>
    <div class="pd-arena" id="pdArena">
      <div class="pd-prompt">
        <p class="pd-prompt-title">Click the pickles before they escape!</p>
        <p class="pd-prompt-hint">🥒 = 1 pt &nbsp;·&nbsp; ⭐ = 3 pts &nbsp;·&nbsp; 🔥 = 5 pts</p>
        <button class="btn btn-primary pd-start-btn" id="pdStart">Start Game</button>
      </div>
    </div>
  `;
  document.body.appendChild(div);
  document.getElementById('pdClose').addEventListener('click', _close);
  document.getElementById('pdStart').addEventListener('click', _start);
}

// ── Game loop ─────────────────────────────────────────────────────────────────

function _start() {
  document.querySelector('.pd-prompt')?.remove();
  _running  = true;
  _score    = 0;
  _timeLeft = DURATION;
  _updateHud();

  _tickT  = setInterval(_tick, 1000);
  _spawnT = setInterval(_spawnPickle, 650);
  _spawnPickle();
}

function _tick() {
  _timeLeft = Math.max(0, _timeLeft - 1);
  const el = document.getElementById('pdTimer');
  if (el) {
    el.textContent = _timeLeft + 's';
    el.classList.toggle('pd-timer-urgent', _timeLeft <= 5);
  }
  if (_timeLeft <= 0) _finish();
}

function _updateHud() {
  const s = document.getElementById('pdScore');
  if (s) s.textContent = _score + ' pts';
}

// ── Pickle spawning (rAF-driven) ─────────────────────────────────────────────

const TYPES = [
  { emoji: '🥒', pts: 1, weight: 70 },
  { emoji: '⭐', pts: 3, weight: 20 },
  { emoji: '🔥', pts: 5, weight: 10 },
];

function _pick() {
  const r = Math.random() * 100;
  let acc = 0;
  for (const t of TYPES) { acc += t.weight; if (r < acc) return t; }
  return TYPES[0];
}

function _spawnPickle() {
  const arena = document.getElementById('pdArena');
  if (!arena || !_running) return;

  const type  = _pick();
  const speed = Math.random() * 2.5 + 1.5;    // px/frame
  const yPct  = Math.random() * 76 + 8;        // 8–84 %
  const size  = (Math.random() * 0.7 + 1.1).toFixed(2);

  const el = document.createElement('span');
  el.className   = 'pd-pickle';
  el.textContent = type.emoji;
  el.style.top   = yPct + '%';
  el.style.fontSize = size + 'rem';

  let x = arena.offsetWidth + 20;
  el.style.left = x + 'px';

  el.addEventListener('click', e => {
    e.stopPropagation();
    if (!_running) return;
    _score += type.pts;
    _updateHud();
    _pop(arena, x, yPct, type.pts);
    el.remove();
  });

  arena.appendChild(el);

  const move = () => {
    if (!document.body.contains(el)) return;
    x -= speed;
    el.style.left = x + 'px';
    if (x < -60) { el.remove(); return; }
    requestAnimationFrame(move);
  };
  requestAnimationFrame(move);
}

function _pop(arena, x, yPct, pts) {
  const pop = document.createElement('span');
  pop.className   = 'pd-pop';
  pop.textContent = '+' + pts;
  pop.style.left  = Math.max(20, x) + 'px';
  pop.style.top   = yPct + '%';
  arena.appendChild(pop);
  setTimeout(() => pop.remove(), 600);
}

// ── Game over ─────────────────────────────────────────────────────────────────

async function _finish() {
  _running = false;
  clearInterval(_tickT);
  clearInterval(_spawnT);
  document.querySelectorAll('.pd-pickle').forEach(p => p.remove());

  // Underdog 2× multiplier check
  const underdogUntil = state.currentProfile?.underdogUntil?.toDate?.()?.getTime()
    ?? (state.currentProfile?.underdogUntil instanceof Date
        ? state.currentProfile.underdogUntil.getTime() : 0);
  const isUnderdog  = Date.now() < underdogUntil;
  const finalScore  = isUnderdog ? _score * 2 : _score;

  if (state.currentUser && finalScore > 0) {
    const best = state.currentProfile?.pickleHighScore ?? 0;
    const upd  = { pickleTotalPoints: increment(finalScore) };
    if (finalScore > best) upd.pickleHighScore = finalScore;
    try { await updateDoc(doc(db, 'players', state.currentUser.uid), upd); } catch {}
    const deptId = state.currentProfile?.department;
    if (deptId) {
      try { await updateDoc(doc(db, 'departments', deptId), { picklePoints: increment(finalScore) }); } catch {}
    }
  }

  const arena = document.getElementById('pdArena');
  if (!arena) return;

  const rank    = _rank(finalScore);
  const deptMsg = state.currentProfile?.department
    ? `<p class="pd-result-dept">Points added to your department's seasonal total 🏆</p>`
    : '';
  const best      = Math.max(finalScore, state.currentProfile?.pickleHighScore ?? 0);
  const bonusLine = isUnderdog
    ? `<div class="pd-result-underdog">🐾 Underdog 2× Bonus Applied! (${_score} × 2)</div>` : '';

  arena.innerHTML = `
    <div class="pd-result">
      <div class="pd-result-score">${finalScore}</div>
      <div class="pd-result-label">Pickle Points</div>
      ${bonusLine}
      <div class="pd-result-rank">${rank}</div>
      <div class="pd-result-best">Personal best: ${best} pts</div>
      ${deptMsg}
      <div class="pd-result-btns">
        <button class="btn btn-primary" id="pdAgain">Play Again</button>
        <button class="btn btn-secondary" id="pdDone">Close</button>
      </div>
    </div>
  `;
  document.getElementById('pdAgain').addEventListener('click', _start);
  document.getElementById('pdDone').addEventListener('click', _close);
}

function _rank(s) {
  if (s >= 40) return '🏆 Pickle Legend!';
  if (s >= 25) return '🥇 Pickle Master!';
  if (s >= 15) return '🥈 Pickle Pro';
  if (s >= 6)  return '🥉 Pickle Rookie';
  return '🤷 Keep practicing!';
}

function _close() {
  clearInterval(_tickT);
  clearInterval(_spawnT);
  _running = false;
  document.getElementById('pickledodge')?.remove();
}
