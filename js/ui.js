export function setModal({ title, sub, body, actions }) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalSub').textContent   = sub;
  document.getElementById('modalBody').innerHTML    = body;
  const el = document.getElementById('modalActions');
  el.innerHTML = '';
  actions.forEach(b => el.appendChild(b));
  document.getElementById('modalOverlay').classList.add('active');
}

export function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
  document.querySelector('.modal').classList.remove('modal-wide');
}

export function makeBtn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}

export function showToast(message, type = 'success') {
  document.getElementById('toast')?.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = message;
  t.style.background = type === 'error' ? '#e53935' : 'var(--cyan)';
  t.style.color      = type === 'error' ? '#fff'    : '#000';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
