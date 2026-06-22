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

// ── Bracket generation ────────────────────────────────────────────────────────

// Returns seed numbers in bracket slot order (1 vs N, N/2 vs N/2+1, etc.)
function _bracketSlots(n) {
  if (n === 1) return [1];
  const half = _bracketSlots(n / 2);
  const result = [];
  for (const s of half) result.push(s, n + 1 - s);
  return result;
}

function _getRoundLabel(roundIdx, totalRounds) {
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

function _generateBracket(players) {
  if (!players || players.length < 2) return null;

  // Seed by rating descending; win % as tiebreaker
  const seeded = [...players].sort((a, b) => {
    const rd = (b.rating || 3.0) - (a.rating || 3.0);
    if (Math.abs(rd) > 0.05) return rd;
    const aWp = (a.wins || 0) / Math.max(1, (a.wins || 0) + (a.losses || 0));
    const bWp = (b.wins || 0) / Math.max(1, (b.wins || 0) + (b.losses || 0));
    return bWp - aWp;
  });

  // Round up to next power of 2 for bye handling
  let size = 1;
  while (size < seeded.length) size *= 2;

  // positions[i] = the seed number that occupies bracket slot i
  const positions = _bracketSlots(size);

  // Build round 1 — null players are byes (top seeds get byes)
  const r1Matches = [];
  for (let i = 0; i < positions.length; i += 2) {
    const s1 = positions[i], s2 = positions[i + 1];
    const p1 = s1 <= seeded.length ? { ...seeded[s1 - 1], seed: s1 } : null;
    const p2 = s2 <= seeded.length ? { ...seeded[s2 - 1], seed: s2 } : null;
    const autoWin = p1 === null ? p2 : (p2 === null ? p1 : null);
    r1Matches.push({ p1, p2, winner: autoWin });
  }

  // Firestore doesn't support nested arrays — store each round as { matches: [...] }
  const rounds = [{ matches: r1Matches }];
  let count = r1Matches.length / 2;
  while (count >= 1) {
    rounds.push({ matches: Array.from({ length: count }, () => ({ p1: null, p2: null, winner: null })) });
    count /= 2;
  }

  // Propagate bye (auto) winners into subsequent rounds
  for (let r = 0; r < rounds.length - 1; r++) {
    rounds[r].matches.forEach((match, idx) => {
      if (match.winner !== null) {
        const ni = Math.floor(idx / 2);
        if (idx % 2 === 0) rounds[r + 1].matches[ni].p1 = match.winner;
        else               rounds[r + 1].matches[ni].p2 = match.winner;
      }
    });
  }

  return { rounds };
}

async function _advanceWinner(t, roundIdx, matchIdx, winnerUid) {
  const bracket = JSON.parse(JSON.stringify(t.bracket));
  const match = bracket.rounds[roundIdx].matches[matchIdx];
  const winner = match.p1?.uid === winnerUid ? match.p1 : match.p2;
  if (!winner) return;
  match.winner = winner;

  const next = roundIdx + 1;
  if (next < bracket.rounds.length) {
    const ni = Math.floor(matchIdx / 2);
    if (matchIdx % 2 === 0) bracket.rounds[next].matches[ni].p1 = winner;
    else                     bracket.rounds[next].matches[ni].p2 = winner;
  }

  await updateDoc(doc(db, 'tournaments', t.id), { bracket });
}

// ── Bracket HTML ──────────────────────────────────────────────────────────────

function _bracketBodyHtml(t) {
  const { rounds } = t.bracket;
  const total  = rounds.length;
  const staff  = _isStaff();

  // Check if the whole bracket is complete (final has a winner)
  const champion = rounds[total - 1].matches[0]?.winner;

  let html = '';

  if (champion) {
    html += `
      <div style="text-align:center;padding:10px 0 14px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <div style="font-size:1.4rem">🏆</div>
        <div style="font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--cyan);margin-top:4px">Champion</div>
        <div style="font-size:1rem;font-weight:700;margin-top:2px">${champion.firstName} ${champion.lastName}</div>
      </div>`;
  }

  rounds.forEach((round, ri) => {
    const label = _getRoundLabel(ri, total);

    const matchesHtml = round.matches.map((m, mi) => {
      const { p1, p2, winner } = m;
      const p1Won = winner && p1 && winner.uid === p1.uid;
      const p2Won = winner && p2 && winner.uid === p2.uid;
      const canPick = staff && p1 && p2 && !winner;

      const playerRow = (p, won, slotLabel) => {
        if (!p) return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
            <span style="flex:1;font-size:.8rem;color:var(--text-muted);font-style:italic">${slotLabel}</span>
          </div>`;
        const bg  = won ? 'background:rgba(6,182,212,.1)' : '';
        const col = won ? 'color:var(--cyan);font-weight:700' : 'color:var(--text)';
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;${bg}">
            <span style="font-size:.65rem;color:var(--text-muted);min-width:20px;text-align:right">#${p.seed}</span>
            <span style="flex:1;font-size:.82rem;${col}">${p.firstName} ${p.lastName}</span>
            ${p.rating != null ? `<span style="font-size:.68rem;color:var(--text-muted)">${Number(p.rating).toFixed(1)}</span>` : ''}
            ${won  ? '<span style="font-size:.78rem;color:var(--cyan)">✓</span>' : ''}
            ${canPick ? `<button data-advance="${ri}:${mi}:${p.uid}" style="font-size:.68rem;padding:2px 7px;background:var(--cyan);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:700">Win</button>` : ''}
          </div>`;
      };

      // Round 0 null slot = BYE; later rounds = TBD
      const p1Label = 'TBD';
      const p2Label = ri === 0 && !p2 ? 'BYE' : 'TBD';

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:6px">
          ${playerRow(p1, p1Won, p1Label)}
          <div style="height:1px;background:var(--border)"></div>
          ${playerRow(p2, p2Won, p2Label)}
        </div>`;
    }).join('');

    html += `
      <div style="margin-bottom:16px">
        <div style="font-size:.67rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--cyan);margin-bottom:7px">${label}</div>
        ${matchesHtml}
      </div>`;
  });

  return `<div style="max-height:58vh;overflow-y:auto;padding-right:2px">${html}</div>`;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

const _TITLE_STYLE = 'font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--text-dim);margin-bottom:10px';
const _CARD_STYLE  = 'background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s';
const _NAME_STYLE  = 'font-size:.86rem;font-weight:700;margin-bottom:5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
const _META_STYLE  = 'display:flex;gap:8px;font-size:.72rem;color:var(--text-muted);flex-wrap:wrap';
const _TIME_STYLE  = 'font-size:.74rem;color:var(--text-dim);margin-top:3px';
const _COUNT_STYLE = 'font-size:.7rem;color:var(--cyan);font-weight:700;margin-top:3px';

function _bracketStatus(t) {
  if (!t.bracket?.rounds) return null;
  const rounds = t.bracket.rounds;
  const total  = rounds.length;
  if (rounds[total - 1].matches[0]?.winner) return '🏆 Complete';
  // Find deepest round with any winner set
  let deepest = -1;
  rounds.forEach((r, ri) => { if (r.matches.some(m => m.winner)) deepest = ri; });
  if (deepest < 0) return 'Bracket ready';
  return `${_getRoundLabel(deepest + 1, total)} in progress`;
}

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
    ${upcoming.map(t => {
      const status = _bracketStatus(t);
      return `
        <div class="tournament-card" data-id="${t.id}" style="${_CARD_STYLE}">
          <div style="${_NAME_STYLE}">${t.name}</div>
          <div style="${_META_STYLE}">
            <span>${_fmtDate(t.date)}</span>
            <span>Court ${t.court}</span>
          </div>
          <div style="${_TIME_STYLE}">${_fmtH(t.startHour)} – ${_fmtH(t.endHour)}</div>
          ${status
            ? `<div style="${_COUNT_STYLE}">${status}</div>`
            : `<div style="${_COUNT_STYLE}">${(t.players || []).length} player${(t.players || []).length !== 1 ? 's' : ''}</div>`}
        </div>`;
    }).join('')}`;

  sidebar.querySelectorAll('.tournament-card').forEach(card => {
    const t = upcoming.find(x => x.id === card.dataset.id);
    if (t) card.addEventListener('click', () => _openTournamentModal(t));
  });
}

// ── Tournament modal ──────────────────────────────────────────────────────────

function _openTournamentModal(t) {
  const hasBracket = t.bracket?.rounds?.length > 0;

  const body = hasBracket
    ? _bracketBodyHtml(t)
    : `<div style="font-size:.78rem;font-weight:700;color:var(--text-dim);margin-bottom:8px;text-transform:uppercase;letter-spacing:.04em">
         Roster (${(t.players || []).length})
       </div>
       ${(t.players || []).length > 0
         ? t.players.map(p => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:.85rem">${p.firstName} ${p.lastName}</div>`).join('')
         : '<p style="color:var(--text-muted);font-size:.85rem">No roster set.</p>'}`;

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
    body,
    actions,
  });

  // Wire Win buttons — staff only, bracket only
  if (hasBracket && _isStaff()) {
    document.querySelectorAll('[data-advance]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const [ri, mi, uid] = btn.dataset.advance.split(':');
        btn.disabled = true;
        try {
          await _advanceWinner(t, +ri, +mi, uid);
          const snap = await getDoc(doc(db, 'tournaments', t.id));
          if (snap.exists()) _openTournamentModal({ id: t.id, ...snap.data() });
        } catch (err) {
          console.error(err);
          showToast('Could not save result.', 'error');
          btn.disabled = false;
        }
      });
    });
  }
}

async function _cancelTournament(t) {
  const updates = {};
  for (let h = t.startHour; h < t.endHour; h++) {
    updates[`${t.court}_${t.dayIdx}_${h}`] = deleteField();
  }
  await updateDoc(doc(db, 'reservations', t.weekKey), updates);
  await deleteDoc(doc(db, 'tournaments', t.id));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initTournamentSidebar() {
  if (_unsubscribe) _unsubscribe();

  // Show header immediately — sidebar is visible before Firestore responds
  const sidebar = document.getElementById('tournamentsSidebar');
  if (sidebar) {
    sidebar.style.display = '';
    sidebar.innerHTML = `<div style="${_TITLE_STYLE}">📅 Tournaments</div>`;
  }

  let fetchedDocs = [];
  try {
    const snap = await getDocs(collection(db, 'tournaments'));
    fetchedDocs = snap.docs;
    const upcoming = _filterUpcoming(fetchedDocs);
    if (_isStaff()) {
      showToast(`Sidebar: ${fetchedDocs.length} in DB, ${upcoming.length} upcoming`);
    }
    _renderSidebar(upcoming);
  } catch (err) {
    console.error('Tournament fetch error:', err);
    if (_isStaff()) showToast(`Sidebar error: ${err?.code || err?.message || 'unknown'}`, 'error');
    if (sidebar && _isStaff()) {
      sidebar.innerHTML = `
        <div style="${_TITLE_STYLE}">📅 Tournaments</div>
        <p style="font-size:.78rem;color:var(--red,#f87171);margin:0">Could not load tournaments.</p>`;
    } else if (sidebar) {
      sidebar.style.display = 'none';
    }
  }

  _unsubscribe = onSnapshot(
    collection(db, 'tournaments'),
    snap => {
      try {
        _renderSidebar(_filterUpcoming(snap.docs));
      } catch (err) {
        console.error('Sidebar render error:', err);
        if (_isStaff()) showToast(`Sidebar render error: ${err?.message}`, 'error');
      }
    },
    err => {
      console.error('Tournament listener error:', err);
      if (_isStaff()) showToast(`Sidebar listener error: ${err?.code || err?.message}`, 'error');
    },
  );
}

export async function refreshTournamentSidebar() {}

export async function createTournamentRecord({ name, court, date, dayIdx, weekKey, startHour, endHour, players }) {
  const bracket = _generateBracket(players);

  const ref = await addDoc(collection(db, 'tournaments'), {
    name, court, date, dayIdx, weekKey, startHour, endHour, players,
    bracket,
    createdBy: state.currentUser.uid,
    createdAt: serverTimestamp(),
  });

  const verify = await getDoc(ref);
  if (!verify.exists()) {
    throw new Error('Tournament was not saved — check Firestore permissions.');
  }

  return ref;
}
