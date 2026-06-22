// ── Space background + loader ─────────────────────────────────────────────────

export function initSpaceBackground() {
  const bg = document.getElementById('spaceBg');
  if (!bg) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 220; i++) {
    const s = document.createElement('div');
    s.className = 'space-star';
    const size = Math.random() * 2.2 + 0.4;
    const dur  = (Math.random() * 3 + 2).toFixed(1);
    const del  = (Math.random() * 5).toFixed(1);
    s.style.cssText =
      `left:${(Math.random() * 100).toFixed(2)}%;` +
      `top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;` +
      `height:${size.toFixed(1)}px;` +
      `opacity:${(Math.random() * 0.65 + 0.15).toFixed(2)};` +
      `animation:twinkle ${dur}s ease-in-out ${del}s infinite;`;
    frag.appendChild(s);
  }
  bg.appendChild(frag);
}

export function initLoader() {
  const loader = document.getElementById('appLoader');
  if (!loader || loader.dataset.initialized) return;
  loader.dataset.initialized = '1';
  const frag = document.createDocumentFragment();
  for (let i = 0; i < 130; i++) {
    const s = document.createElement('div');
    s.className = 'loader-star';
    const size = Math.random() * 2.4 + 0.4;
    s.style.cssText =
      `left:${(Math.random() * 100).toFixed(2)}%;` +
      `top:${(Math.random() * 100).toFixed(2)}%;` +
      `width:${size.toFixed(1)}px;` +
      `height:${size.toFixed(1)}px;` +
      `--dur:${(Math.random() * 2.5 + 1.5).toFixed(1)}s;` +
      `--delay:${(Math.random() * 3).toFixed(1)}s;`;
    frag.appendChild(s);
  }
  loader.appendChild(frag);
}

export function showLoader() {
  document.getElementById('appLoader')?.classList.remove('hidden');
}

export function hideLoader() {
  const loader = document.getElementById('appLoader');
  if (loader) loader.classList.add('hidden');
  setTimeout(() => {
    document.getElementById('spaceEarth')?.classList.add('visible');
  }, 500);
}
