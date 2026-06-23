// ── Space background & effects ────────────────────────────────────────────────

export function initSpaceBackground() {
  const bg = document.getElementById('spaceBg');
  if (!bg) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 280; i++) {
    const s    = document.createElement('div');
    s.className = 'space-star';
    const size = Math.random() * 2.6 + 0.4;
    const glow = (size * 1.2).toFixed(1);
    s.style.cssText =
      `left:${(Math.random()*100).toFixed(2)}%;` +
      `top:${(Math.random()*100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
      `opacity:${(Math.random()*0.7+0.2).toFixed(2)};` +
      `--dur:${(Math.random()*4+2).toFixed(1)}s;` +
      `--delay:${(Math.random()*6).toFixed(1)}s;` +
      `--glow:${glow}px;`;
    frag.appendChild(s);
  }
  bg.appendChild(frag);
}

export function revealBackground() {
  document.getElementById('spaceBg')?.classList.add('photo-visible');
  _startShootingStars();
  _startDustParticles();
}

// ── Shooting stars ────────────────────────────────────────────────────────────

function _spawnShootingStar() {
  const el = document.createElement('div');
  el.className = 'shooting-star';
  const length = 180 + Math.random() * 260;
  const dur    = (0.7 + Math.random() * 0.6).toFixed(2);
  el.style.cssText =
    `left:${(Math.random()*80).toFixed(1)}%;` +
    `top:${(Math.random()*50).toFixed(1)}%;` +
    `width:${length}px;` +
    `--angle:${(15 + Math.random()*20).toFixed(1)}deg;` +
    `--dist:${length}px;--shoot-dur:${dur}s;`;
  document.body.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

function _startShootingStars() {
  const fire = () => {
    _spawnShootingStar();
    if (Math.random() < 0.3) setTimeout(_spawnShootingStar, 220);
    setTimeout(fire, 3000 + Math.random() * 6000);
  };
  setTimeout(fire, 1500);
}

// ── Moon dust particles ───────────────────────────────────────────────────────

function _startDustParticles() {
  const bg = document.getElementById('spaceBg');
  if (!bg) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 18; i++) {
    const p    = document.createElement('div');
    p.className = 'dust-particle';
    const size = Math.random() * 3 + 1;
    p.style.cssText =
      `left:${(Math.random()*100).toFixed(1)}%;` +
      `bottom:${(Math.random()*18).toFixed(1)}%;` +
      `width:${size.toFixed(1)}px;height:${size.toFixed(1)}px;` +
      `--ddur:${(5+Math.random()*6).toFixed(1)}s;` +
      `--ddel:${(Math.random()*8).toFixed(1)}s;` +
      `--dx:${((Math.random()-0.5)*40).toFixed(1)}px;`;
    frag.appendChild(p);
  }
  bg.appendChild(frag);
}
