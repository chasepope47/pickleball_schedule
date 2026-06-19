import {
  db, collection, addDoc, doc, deleteDoc, getDocs, getDoc, onSnapshot,
  serverTimestamp, updateDoc, deleteField,
} from './firebase.js';
import { state } from './state.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';

let _unsubscribe = null;

function _isStaff() {
  const r = state.currentProfile?.role;
  return r === 'admin' || r === 'manager';
}

function _fmtDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function _fmtH(h) {
  if (h === 0) return '12AM';
  if (h === 12) return '12PM';
  return h > 12 ? `${h - 12}PM` : `${h}AM`;
}

// Local date string (YYYY-MM-DD) in the user's timezone so today's tournaments always show
function _localToday() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function _filterUpcoming(docs) {
  const todayStr = _localToday();
  return docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.date && t.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startHour - b.startHour));
}

const _TITLE_STYLE  = 'font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:10px';
const _CARD_STYLE   = 'background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s';
const _NAME_STYLE   = 'font-size:.86rem;font-weight:700;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const _META_STYLE   = 'display:flex;gap:8px;font-size:.72rem;color:var(--text-muted);flex-wrap:wrap';
const _TIME_STYLE   = 'font-size:.74rem;color:var(--text-dim);margin-top:3px';
const _COUNT_STYLE  = 'font-size:.7rem;color:var(--cyan);font-weight:700;margin-top:3px';

function _renderSidebar(upcoming) {
  const sidebar = document.getElementById('tournamentsSidebar');
  if (!sidebar) return;

  if (upcoming.length === 0) {
    if (_isStaff()) {
      sidebar.style.display = '';
      sidebar.innerHTML = `
        <div style="${_TITLE_STYLE}">📅 Tournaments</div>
        <p style="font-size:.8rem;color:var(--text-muted);line-height:1.5;margin:0">No upcoming tournaments.<br>Create one in the Admin Panel.</p>`;
    } else {
      sidebar.style.display = 'none';
    }
    return;
  }

  sidebar.style.display = '';
  sidebar.innerHTML = `
    <div style="${_TITLE_STYLE}">📅 Tournaments</div>
    ${upcoming.map(t => `
      <div class="tournament-card" data-id="${t.id}" style="${_CARD_STYLE}">
        <div style="${_NAME_STYLE}">${t.name}</div>
        <div style="${_META_STYLE}">
          <span>${_fmtDate(t.date)}</span>
          <span>Court ${t.court}</span>
        </div>
        <div style="${_TIME_STYLE}">${_fmtH(t.startHour)} – ${_fmtH(t.endHour)}</div>
        <div style="${_COUNT_STYLE}">${(t.players || []).length} player${(t.players || []).length !== 1 ? 's' : ''}</div>
      </div>`).join('')}`;

  sidebar.querySelectorAll('.tournament-card').forEach(card => {
    const t = upcoming.find(x => x.id === card.dataset.id);
    if (t) card.addEventListener('click', () => _openTournamentModal(t));
  });
}

export async function initTournamentSidebar() {
  if (_unsubscribe) _unsubscribe();

  // Initial load via getDocs so the sidebar is populated immediately on every page load
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    _renderSidebar(_filterUpcoming(snap.docs));
  } catch (err) {
    console.warn('Tournament initial fetch error:', err);
  }

  // Keep a live listener so changes propagate to all users without a refresh
  _unsubscribe = onSnapshot(
    collection(db, 'tournaments'),
    snap => _renderSidebar(_filterUpcoming(snap.docs)),
    err  => console.warn('Tournament listener error:', err),
    // Never hide the sidebar on listener error — the getDocs above already has the data
  );
}

// no-op kept so admin.js calls don't break; the listener handles live updates
export async function refreshTournamentSidebar() {}

function _openTournamentModal(t) {
  const roster = (t.players || []).length > 0
    ? `<div style="display:flex;flex-direction:column">
        ${t.players.map(p => `
          <div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:.85rem">
            ${p.firstName} ${p.lastName}
          </div>`).join('')}
       </div>`
    : '<p style="color:var(--text-muted);font-size:.85rem">No roster set.</p>';

  const actions = [makeBtn('Close', 'btn-secondary', closeModal)];
  if (_isStaff()) {
    actions.unshift(makeBtn('Cancel Tournament', 'btn-danger', async () => {
      if (!confirm(`Cancel "${t.name}"? This will unblock the reserved slots.`)) return;
      try {
        await _cancelTournament(t);
        closeModal();
        showToast(`"${t.name}" cancelled.`);
      } catch (err) {
        console.error(err);
        showToast('Could not cancel tournament.', 'error');
      }
    }));
  }

  setModal({
    title: t.name,
    sub:   `${_fmtDate(t.date)} · Court ${t.court} · ${_fmtH(t.startHour)}–${_fmtH(t.endHour)}`,
    body:  `
      <div style="font-size:.78rem;font-weight:700;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">
        Roster (${(t.players || []).length})
      </div>
      ${roster}`,
    actions,
  });
}

async function _cancelTournament(t) {
  const updates = {};
  for (let h = t.startHour; h < t.endHour; h++) {
    updates[`${t.court}_${t.dayIdx}_${h}`] = deleteField();
  }
  await updateDoc(doc(db, 'reservations', t.weekKey), updates);
  await deleteDoc(doc(db, 'tournaments', t.id));
}

export async function createTournamentRecord({ name, court, date, dayIdx, weekKey, startHour, endHour, players }) {
  const ref = await addDoc(collection(db, 'tournaments'), {
    name, court, date, dayIdx, weekKey, startHour, endHour, players,
    createdBy: state.currentUser.uid,
    createdAt: serverTimestamp(),
  });

  // Verify the write was actually accepted by the server
  const verify = await getDoc(ref);
  if (!verify.exists()) {
    throw new Error('Tournament was not saved — check Firestore permissions.');
  }

  return ref;
}
