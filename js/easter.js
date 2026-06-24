// ── Konami Code ───────────────────────────────────────────────────────────────

const KONAMI = [
  'ArrowUp','ArrowUp','ArrowDown','ArrowDown',
  'ArrowLeft','ArrowRight','ArrowLeft','ArrowRight',
  'b','a',
];
let _ki = 0;

document.addEventListener('keydown', e => {
  _ki = (e.key === KONAMI[_ki]) ? _ki + 1 : (e.key === KONAMI[0] ? 1 : 0);
  if (_ki === KONAMI.length) { _ki = 0; _triggerKonami(); }
});

function _triggerKonami() {
  if (document.body.classList.contains('konami-active')) return;
  document.body.classList.add('konami-active');
  _konamiToast();
  for (let i = 0; i < 40; i++) setTimeout(_dropPickle, i * 55);
  setTimeout(() => document.body.classList.remove('konami-active'), 8000);
}

function _dropPickle() {
  const POOL = ['🥒','🥒','🥒','🏓','🎉','✨','🥒'];
  const el = document.createElement('span');
  el.className = 'konami-pickle';
  el.textContent = POOL[Math.floor(Math.random() * POOL.length)];
  el.style.left             = Math.random() * 100 + 'vw';
  el.style.fontSize         = (Math.random() * 22 + 16) + 'px';
  el.style.animationDuration = (Math.random() * 1.8 + 1.2).toFixed(2) + 's';
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function _konamiToast() {
  const t = document.createElement('div');
  t.className = 'konami-toast';
  t.textContent = '🥒 PICKLE MODE ACTIVATED 🥒';
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('konami-toast-show'), 10);
  setTimeout(() => { t.classList.remove('konami-toast-show'); setTimeout(() => t.remove(), 400); }, 3000);
}

// ── Department Mascots ────────────────────────────────────────────────────────

const MASCOTS = {
  care:       { emoji: '🛡️', name: 'The Guardian',    quip: 'Protecting every point!' },
  hr:         { emoji: '🤝', name: 'The Handshaker',  quip: 'Recruiting champions!' },
  it:         { emoji: '💻', name: 'The Debugger',    quip: 'Patching opponents!' },
  finance:    { emoji: '💰', name: 'The Accountant',  quip: 'Calculating every win!' },
  operations: { emoji: '⚙️', name: 'The Engineer',    quip: 'Running like clockwork!' },
  marketing:  { emoji: '📣', name: 'The Hype Master', quip: 'Making noise on court!' },
  legal:      { emoji: '⚖️', name: 'The Arbitrator',  quip: 'Objection: you missed!' },
  admin:      { emoji: '📋', name: 'The Organiser',   quip: 'Everything in order!' },
  default:    { emoji: '🏓', name: 'The Player',      quip: 'Game on!' },
};

function _getMascot(name) {
  const key = (name || '').toLowerCase();
  const match = Object.entries(MASCOTS).find(([k]) => key.includes(k));
  return match ? match[1] : MASCOTS.default;
}

const _clickLog = new WeakMap();

// Capture phase so we can stopPropagation before .dept-row opens the modal
document.addEventListener('click', e => {
  const nameEl = e.target.closest('.dept-name');
  if (!nameEl) return;

  const now  = Date.now();
  const prev = _clickLog.get(nameEl) ?? { n: 0, t: 0 };
  const n    = now - prev.t < 700 ? prev.n + 1 : 1;
  _clickLog.set(nameEl, { n, t: now });

  if (n >= 3) {
    e.stopPropagation();
    _clickLog.set(nameEl, { n: 0, t: 0 });
    _showMascot(nameEl);
  }
}, true); // capture — fires before .dept-row bubble handler

function _showMascot(nameEl) {
  document.getElementById('mascot-popup')?.remove();

  const text = nameEl.textContent.trim();
  const m    = _getMascot(text);
  const rect = nameEl.getBoundingClientRect();

  const popup = document.createElement('div');
  popup.id = 'mascot-popup';
  popup.className = 'mascot-popup';
  popup.innerHTML = `
    <div class="mascot-emoji">${m.emoji}</div>
    <div class="mascot-name">${m.name}</div>
    <div class="mascot-quip">${m.quip}</div>
  `;

  const top  = Math.min(rect.bottom + 8, window.innerHeight - 140);
  const left = Math.min(rect.left, window.innerWidth - 180);
  popup.style.top  = top + 'px';
  popup.style.left = left + 'px';
  document.body.appendChild(popup);

  requestAnimationFrame(() => popup.classList.add('mascot-show'));
  setTimeout(() => {
    popup.classList.remove('mascot-show');
    setTimeout(() => popup.remove(), 300);
  }, 2800);
}

// ── Pickle-Fi (Idle Watcher) ──────────────────────────────────────────────────

const IDLE_MS = 60 * 60 * 1000;
let _lastActive = Date.now();

['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev =>
  document.addEventListener(ev, () => { _lastActive = Date.now(); }, { passive: true })
);

setInterval(() => {
  if (Date.now() - _lastActive > IDLE_MS && !document.getElementById('picklefi')) {
    _spawnPickleFi();
  }
}, 30_000);

function _spawnPickleFi() {
  const fi = document.createElement('div');
  fi.id = 'picklefi';
  fi.innerHTML = `
    <span class="pfi-paddle">🏓</span>
    <div class="pfi-bubble">Pssst… still there? 👀<br><span class="pfi-sub">Click me to dismiss</span></div>
  `;
  document.body.appendChild(fi);

  let x  = -90;
  let y  = 30 + Math.random() * 40;  // % of viewport height
  let vx = 2.2;
  let vy = (Math.random() - 0.5) * 1.4;
  let bounces = 0;

  fi.style.cssText = `position:fixed;left:${x}px;top:${y}vh`;

  const move = () => {
    if (!document.body.contains(fi)) return;
    x  += vx;
    y  += vy;
    if (y < 5 || y > 88) { vy *= -1; y = Math.max(5, Math.min(88, y)); }
    if (x > window.innerWidth + 10) {
      fi.remove();
      return;
    }
    if (x > window.innerWidth - 100 && vx > 0) { vx = -vx; bounces++; }
    if (bounces > 3) { fi.remove(); return; }
    fi.style.left = x + 'px';
    fi.style.top  = y + 'vh';
    requestAnimationFrame(move);
  };

  requestAnimationFrame(move);
  fi.addEventListener('click', () => { _lastActive = Date.now(); fi.remove(); });
}
