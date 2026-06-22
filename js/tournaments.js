import {
  db, collection, addDoc, doc, deleteDoc, getDocs, getDoc, onSnapshot,
  serverTimestamp, updateDoc, deleteField, setDoc,
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

function _getCourts(t) {
  if (Array.isArray(t.courts)) return t.courts;
  if (t.court != null) return [t.court];
  return [];
}

function _courtsLabel(t) {
  const c = _getCourts(t);
  if (c.length === 0) return 'Court ?';
  return c.length > 1 ? `Courts ${c.join(' & ')}` : `Court ${c[0]}`;
}

function _filterUpcoming(docs) {
  const todayStr = _localToday();
  return docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(t => t.date && t.date >= todayStr)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.startHour - b.startHour));
}

// ── Bracket & Round Robin Generation Math ─────────────────────────────────────

const _PLACEHOLDER_POOL = [
  'The Picklers', 'Net Ninjas', 'Dink Squad', 'Volley Kings',
  'Court Crushers', 'Lob Stars', 'Baseline Crew', 'Kitchen Cats',
  'Smash Pack', 'Rally Squad', 'Ace Team', 'Drop Shot Boys',
  'Spin Masters', 'Power Dinkers', 'Overhead Heroes', 'Cross Court',
  'The Lobsters', 'Quick Hands', 'Speed Demons', 'Net Busters',
  'The Bangers', 'Soft Game Kings', 'Reset Masters', 'NVZ Squad',
  'Erne Team', 'Poach Party', 'Stack Attack', 'Third Shot Pros',
  'Transition Zone', 'Rally Cats', 'Pickle Punchers', 'Net Crushers',
];

function _makePlaceholders(count) {
  const pool = [..._PLACEHOLDER_POOL].sort(() => Math.random() - 0.5);
  return Array.from({ length: count }, (_, i) => ({
    uid:           `__OPEN_${Date.now()}_${i}__`,
    firstName:     pool[i % pool.length],
    lastName:      '',
    isPlaceholder: true,
    rating:        null,
  }));
}

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

function _generateBracket(players, minSize = 0) {
  if (!players || players.length < 2) return null;

  const seeded = [...players].sort((a, b) => {
    const rd = (b.rating || 3.0) - (a.rating || 3.0);
    if (Math.abs(rd) > 0.05) return rd;
    const aWp = (a.wins || 0) / Math.max(1, (a.wins || 0) + (a.losses || 0));
    const bWp = (b.wins || 0) / Math.max(1, (b.wins || 0) + (b.losses || 0));
    return bWp - aWp;
  });

  let naturalSize = 1;
  while (naturalSize < seeded.length) naturalSize *= 2;
  const size = Math.max(naturalSize, minSize);

  if (size > naturalSize) {
    const placeholders = _makePlaceholders(size - seeded.length);
    const allEntries   = [...seeded, ...placeholders].sort(() => Math.random() - 0.5);
    const r1m = [];
    for (let i = 0; i < allEntries.length; i += 2) {
      r1m.push({ p1: allEntries[i], p2: allEntries[i + 1], winner: null });
    }
    const rounds = [{ matches: r1m }];
    let cnt = r1m.length / 2;
    while (cnt >= 1) {
      rounds.push({ matches: Array.from({ length: cnt }, () => ({ p1: null, p2: null, winner: null })) });
      cnt /= 2;
    }
    return { rounds };
  }

  const positions = _bracketSlots(size);
  const r1Matches = [];
  for (let i = 0; i < positions.length; i += 2) {
    const s1 = positions[i], s2 = positions[i + 1];
    const p1 = s1 <= seeded.length ? { ...seeded[s1 - 1], seed: s1 } : null;
    const p2 = s2 <= seeded.length ? { ...seeded[s2 - 1], seed: s2 } : null;
    const autoWin = p1 === null ? p2 : (p2 === null ? p1 : null);
    r1Matches.push({ p1, p2, winner: autoWin });
  }

  const rounds = [{ matches: r1Matches }];
  let count = r1Matches.length / 2;
  while (count >= 1) {
    rounds.push({ matches: Array.from({ length: count }, () => ({ p1: null, p2: null, winner: null })) });
    count /= 2;
  }

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

function _generateRoundRobin(entries) {
  if (!entries || entries.length < 2) return null;

  const pool = [...entries];
  if (pool.length % 2 !== 0) {
    pool.push({ uid: '__BYE__', firstName: 'BYE', lastName: '', isBye: true });
  }

  const numRounds = pool.length - 1;
  const matchesPerRound = pool.length / 2;
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const roundMatches = [];
    for (let m = 0; m < matchesPerRound; m++) {
      const p1 = pool[m];
      const p2 = pool[pool.length - 1 - m];
      if (p1.isBye || p2.isBye) continue;

      roundMatches.push({ p1, p2, winner: null });
    }
    rounds.push({ matches: roundMatches });
    pool.splice(1, 0, pool.pop());
  }

  return { rounds };
}

function _pairForDoubles(players) {
  const shuffled = [...players].sort(() => Math.random() - 0.5);
  const teams = [];
  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const a = shuffled[i], b = shuffled[i + 1];
    teams.push({
      uid:       `${a.uid}__${b.uid}`,
      firstName: `${a.firstName} ${a.lastName}`,
      lastName:  `& ${b.firstName} ${b.lastName}`,
      rating:    ((a.rating || 3.0) + (b.rating || 3.0)) / 2,
      players:   [a, b],
    });
  }
  return teams;
}

async function _advanceWinner(t, roundIdx, matchIdx, winnerUid) {
  const bracket = JSON.parse(JSON.stringify(t.bracket));
  const match = bracket.rounds[roundIdx].matches[matchIdx];
  const winner = match.p1?.uid === winnerUid ? match.p1 : match.p2;
  if (!winner) return;
  match.winner = winner;

  if (t.type !== 'round_robin') {
    const next = roundIdx + 1;
    if (next < bracket.rounds.length) {
      const ni = Math.floor(matchIdx / 2);
      if (matchIdx % 2 === 0) bracket.rounds[next].matches[ni].p1 = winner;
      else                     bracket.rounds[next].matches[ni].p2 = winner;
    }
  }

  await updateDoc(doc(db, 'tournaments', t.id), { bracket });
}

// ── Name helpers ─────────────────────────────────────────────────────────────

function _abbrev(fullName) {
  const w = (fullName || '').trim().split(/\s+/);
  return w.length < 2 ? fullName : `${w[0]} ${w[w.length - 1][0]}.`;
}

function _displayName(p) {
  if (!p) return '';
  if (p.lastName?.startsWith('& ')) {
    return `${_abbrev(p.firstName)} & ${_abbrev(p.lastName.slice(2))}`;
  }
  return `${p.firstName}${p.lastName ? ' ' + p.lastName[0] + '.' : ''}`;
}

// ── Conditional Layout Rendering ──────────────────────────────────────────────

function _bracketBodyHtml(t) {
  const isRR = t.type === 'round_robin';
  const { rounds } = t.bracket;
  const total  = rounds.length;
  const staff  = _isStaff();
  const champion = !isRR ? rounds[total - 1].matches[0]?.winner : null;

  let html = '';

  if (champion) {
    html += `
      <div style="text-align:center;padding:10px 0 14px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <div style="font-size:1.4rem">🏆</div>
        <div style="font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--cyan);margin-top:4px">Champion</div>
        <div style="font-size:1rem;font-weight:700;margin-top:2px">${_displayName(champion)}</div>
      </div>`;
  }

  rounds.forEach((round, ri) => {
    const label = isRR ? `Round ${ri + 1}` : _getRoundLabel(ri, total);

    const matchesHtml = round.matches.map((m, mi) => {
      const { p1, p2, winner } = m;
      const p1Won = winner && p1 && winner.uid === p1.uid;
      const p2Won = winner && p2 && winner.uid === p2.uid;
      const canWinP1 = staff && !winner && p1 && (isRR || (!p1.isTBD && p2));
      const canWinP2 = staff && !winner && p2 && (isRR || (!p2.isTBD && p1));
      
      // Inline edit/assign button element
      const ASGN = (slot, text = 'Assign') => `<button class="slot-assign-btn" data-slot="${slot}" style="font-size:.65rem;padding:2px 6px;background:transparent;color:var(--cyan);border:1px solid var(--cyan);border-radius:4px;cursor:pointer;flex-shrink:0">${text}</button>`;

      const playerRow = (p, won, slotLabel, canWin, slotRef) => {
        if (!p) return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
            <span style="flex:1;font-size:.8rem;color:var(--text-muted);font-style:italic">${slotLabel}</span>
          </div>`;
        if (p.isTBD) return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
            ${p.seed ? `<span style="font-size:.65rem;color:var(--text-muted);min-width:20px;text-align:right">#${p.seed}</span>` : ''}
            <span style="flex:1;font-size:.8rem;color:var(--text-muted);font-style:italic">TBD</span>
            ${staff && !winner ? ASGN(slotRef) : ''}
          </div>`;
        const bg  = won ? 'background:rgba(6,182,212,.1)' : '';
        const col = won
          ? 'color:var(--cyan);font-weight:700'
          : p.isPlaceholder ? 'color:var(--text-dim);font-style:italic'
          : 'color:var(--text)';
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;${bg}">
            ${p.seed ? `<span style="font-size:.65rem;color:var(--text-muted);min-width:20px;text-align:right">#${p.seed}</span>` : '<span style="min-width:20px"></span>'}
            <span style="flex:1;font-size:.82rem;${col}">${_displayName(p)}</span>
            ${!p.isPlaceholder && p.rating != null ? `<span style="font-size:.68rem;color:var(--text-muted);margin-right:4px">${Number(p.rating).toFixed(1)}</span>` : ''}
            ${won  ? '<span style="font-size:.78rem;color:var(--cyan)">✓</span>' : ''}
            ${canWin ? `<button data-advance="${ri}:${mi}:${p.uid}" style="font-size:.68rem;padding:2px 7px;background:var(--cyan);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:700;margin-right:4px">${isRR ? 'Set Win' : 'Win'}</button>` : ''}
            ${staff && !winner ? ASGN(slotRef, p.isPlaceholder ? 'Assign' : 'Edit') : ''}
          </div>`;
      };

      const p1Label = ri === 0 && !p1 ? 'BYE' : 'TBD';
      const p2Label = ri === 0 && !p2 ? 'BYE' : 'TBD';

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:6px">
          ${playerRow(p1, p1Won, p1Label, canWinP1, `${ri}:${mi}:p1`)}
          <div style="height:1px;background:var(--border)"></div>
          ${playerRow(p2, p2Won, p2Label, canWinP2, `${ri}:${mi}:p2`)}
        </div>`;
    }).join('');

    html += `
      <div style="margin-bottom:16px">
        <div style="font-size:.67rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--cyan);margin-bottom:7px">${label}</div>
        ${matchesHtml || '<p style="font-size:.8rem;color:var(--text-muted);font-style:italic">No matches.</p>'}
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
  if (t.type === 'round_robin') return 'Round Robin';
  const rounds = t.bracket.rounds;
  if (rounds[rounds.length - 1].matches[0]?.winner) return '🏆 Complete';
  let deepest = -1;
  rounds.forEach((r, ri) => { if (r.matches.some(m => m.winner)) deepest = ri; });
  if (deepest < 0) return 'Bracket ready';
  return `${_getRoundLabel(deepest + 1, rounds.length)} in progress`;
}

function _renderSidebar(upcoming) {
  const sidebar = document.getElementById('tournamentsSidebar');
  if (!sidebar) return;

  if (upcoming.length === 0) {
    sidebar.style.display = '';
    sidebar.innerHTML = _isStaff()
      ? `<div style="${_TITLE_STYLE}">📅 Tournaments</div>
         <p style="font-size:.8rem;color:var(--text-muted);line-height:1.5;margin:0">No upcoming<br>tournaments.</p>`
      : '';
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
            <span>${_courtsLabel(t)}</span>
          </div>
          <div style="${_TIME_STYLE}">${_fmtH(t.startHour)} – ${_fmtH(t.endHour)}</div>
          <div style="${_COUNT_STYLE}">${t.format === 'doubles' ? 'Doubles' : 'Singles'}${status ? ' · ' + status : ' · ' + (t.players || []).length + ' players'}</div>
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

  const champion = hasBracket && t.type !== 'round_robin'
    ? t.bracket.rounds[t.bracket.rounds.length - 1].matches[0]?.winner
    : null;

  const actions = [makeBtn('Close', 'btn-secondary', closeModal)];
  if (_isStaff()) {
    if (hasBracket && !champion && t.type !== 'round_robin') {
      actions.unshift(makeBtn('+ Add Round', 'btn-secondary', async () => {
        try {
          await _addBracketRound(t);
          const snap = await getDoc(doc(db, 'tournaments', t.id));
          if (snap.exists()) _openTournamentModal({ id: t.id, ...snap.data() });
        } catch (err) {
          console.error(err);
          showToast('Could not add round.', 'error');
        }
      }));
    }
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

  const subLabel = `${t.type === 'round_robin' ? 'Round Robin' : 'Elimination'} · ${t.format === 'doubles' ? 'Doubles' : 'Singles'}`;

  setModal({
    title: t.name,
    sub:   `${_fmtDate(t.date)} · ${_courtsLabel(t)} · ${_fmtH(t.startHour)}–${_fmtH(t.endHour)} · ${subLabel}`,
    body,
    actions,
  });

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

    document.querySelectorAll('.slot-assign-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const [ri, mi, side] = btn.dataset.slot.split(':');
        _openSlotAssignment(t, +ri, +mi, side);
      });
    });
  }
}

async function _cancelTournament(t) {
  const courts = _getCourts(t);
  const updates = {};
  for (const c of courts) {
    for (let h = t.startHour; h < t.endHour; h++) {
      updates[`${c}_${t.dayIdx}_${h}`] = deleteField();
    }
  }
  if (Object.keys(updates).length) await updateDoc(doc(db, 'reservations', t.weekKey), updates);
  await deleteDoc(doc(db, 'tournaments', t.id));
}

// Replaces a placeholder or TBD slot with a real player/team entry
async function _doAssignSlot(t, ri, mi, side, entry) {
  const bracket = JSON.parse(JSON.stringify(t.bracket));
  bracket.rounds[ri].matches[mi][side] = entry;

  const playersToAdd = [];
  if (entry.players && Array.isArray(entry.players)) {
    playersToAdd.push(...entry.players);
  } else if (entry.uid && !entry.uid.includes('__')) {
    playersToAdd.push(entry);
  }

  const currentPlayers = Array.isArray(t.players) ? [...t.players] : [];
  const currentUids = new Set(currentPlayers.map(p => p.uid));

  playersToAdd.forEach(p => {
    if (!currentUids.has(p.uid)) {
      currentPlayers.push({
        uid: p.uid,
        firstName: p.firstName,
        lastName: p.lastName,
        rating: p.rating || null
      });
    }
  });

  await updateDoc(doc(db, 'tournaments', t.id), { 
    bracket,
    players: currentPlayers 
  });

  const snap = await getDoc(doc(db, 'tournaments', t.id));
  if (snap.exists()) _openTournamentModal({ id: t.id, ...snap.data() });
}

// Opens a picker so staff can assign or edit a player/team to a bracket slot
async function _openSlotAssignment(t, ri, mi, side) {
  const fmt = t.format || 'singles';
  const available = Array.isArray(t.players) ? [...t.players] : [];
  available.sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));

  if (available.length === 0) {
    showToast('There are no players assigned to this tournament roster.', 'error');
    return;
  }

  // Identify if an entry already occupies this specific bracket coordinate
  const existingEntry = t.bracket?.rounds?.[ri]?.matches?.[mi]?.[side];
  const isEditing = existingEntry && !existingEntry.isPlaceholder && !existingEntry.isTBD;

  const opts = available.map(p =>
    `<option value="${p.uid}">${p.firstName} ${p.lastName}${p.rating ? ' ★' + p.rating : ''}</option>`).join('');

  const backFn = () => getDoc(doc(db, 'tournaments', t.id))
    .then(s => { if (s.exists()) _openTournamentModal({ id: s.id, ...s.data() }); });

  if (fmt === 'singles') {
    setModal({
      title:   isEditing ? 'Edit Position Entry' : 'Assign Player',
      sub:     isEditing ? 'Modify the selected player for this placement slot' : 'Replace this slot with a real player',
      body:    `<div class="form-group"><label>Select Player</label><select id="asgSel">${opts}</select></div>`,
      actions: [
        makeBtn('Back', 'btn-secondary', backFn),
        makeBtn(isEditing ? 'Save Changes' : 'Assign →', 'btn-primary', async () => {
          const uid = document.getElementById('asgSel').value;
          const p   = available.find(x => x.uid === uid);
          if (!p) return;
          await _doAssignSlot(t, ri, mi, side, { uid: p.uid, firstName: p.firstName, lastName: p.lastName, rating: p.rating || null });
        }),
      ],
    });

    // Preset current single player if editing
    if (isEditing && document.getElementById('asgSel')) {
      document.getElementById('asgSel').value = existingEntry.uid;
    }
  } else {
    setModal({
      title:   isEditing ? 'Edit Doubles Team Placement' : 'Assign Doubles Team',
      sub:     'Pick two players to form a team for this slot',
      body: `
        <div class="form-group"><label>Player 1</label><select id="asgP1">${opts}</select></div>
        <div class="form-group" style="margin-top:10px"><label>Player 2</label><select id="asgP2">${opts}</select></div>
        <div class="auth-error hidden" id="asgErr" style="margin-top:8px"></div>`,
      actions: [
        makeBtn('Back', 'btn-secondary', backFn),
        makeBtn(isEditing ? 'Save Team' : 'Assign →', 'btn-primary', async () => {
          const uid1 = document.getElementById('asgP1').value;
          const uid2 = document.getElementById('asgP2').value;
          if (!uid1 || !uid2 || uid1 === uid2) {
            const e = document.getElementById('asgErr');
            e.textContent = 'Select two different players.';
            e.classList.remove('hidden');
            return;
          }
          const a = available.find(x => x.uid === uid1);
          const b = available.find(x => x.uid === uid2);
          if (!a || !b) return;
          const team = {
            uid:       `${a.uid}__${b.uid}`,
            firstName: `${a.firstName} ${a.lastName}`,
            lastName:  `& ${b.firstName} ${b.lastName}`,
            rating:    ((a.rating || 3.0) + (b.rating || 3.0)) / 2,
            players:   [a, b],
          };
          await _doAssignSlot(t, ri, mi, side, team);
        }),
      ],
    });

    // Preset current split player targets if editing a doubles entry
    if (isEditing && existingEntry.players && existingEntry.players.length === 2) {
      if (document.getElementById('asgP1')) document.getElementById('asgP1').value = existingEntry.players[0].uid;
      if (document.getElementById('asgP2')) document.getElementById('asgP2').value = existingEntry.players[1].uid;
    } else if (isEditing && existingEntry.uid.includes('__')) {
      const [u1, u2] = existingEntry.uid.split('__');
      if (document.getElementById('asgP1')) document.getElementById('asgP1').value = u1;
      if (document.getElementById('asgP2')) document.getElementById('asgP2').value = u2;
    }
  }
}

async function _addBracketRound(t) {
  const bracket = JSON.parse(JSON.stringify(t.bracket));
  const n = bracket.rounds[0].matches.length * 2;
  const ph = _makePlaceholders(n * 2);
  bracket.rounds.unshift({
    matches: Array.from({ length: n }, (_, i) => ({
      p1: ph[i * 2], p2: ph[i * 2 + 1], winner: null,
    })),
  });
  const bracketSize = Math.pow(2, bracket.rounds.length);
  await updateDoc(doc(db, 'tournaments', t.id), { bracket, bracketSize });
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function initTournamentSidebar() {
  if (_unsubscribe) _unsubscribe();

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
    _renderSidebar(upcoming);
  } catch (err) {
    console.error('Tournament fetch error:', err);
  }

  _unsubscribe = onSnapshot(
    collection(db, 'tournaments'),
    snap => {
      try {
        _renderSidebar(_filterUpcoming(snap.docs));
      } catch (err) {
        console.error('Sidebar render error:', err);
      }
    },
    err => console.error('Tournament listener error:', err)
  );
}

export async function refreshTournamentSidebar() {}

function _reservationSlots(courts, dayIdx, startHour, endHour, name, players) {
  const updates = {};
  for (const c of courts) {
    for (let h = startHour; h < endHour; h++) {
      updates[`${c}_${dayIdx}_${h}`] = {
        isTournament: true,
        tournamentName: name,
        players,
        maxPlayers: players.length,
        createdBy: state.currentUser.uid,
      };
    }
  }
  return updates;
}

export async function createTournamentRecord({ name, type, courts, date, dayIdx, weekKey, startHour, endHour, players, format, extraRounds }) {
  const fmt = format || 'singles';
  const tType = type || 'elimination';
  
  let entries = [...players];
  if (fmt === 'doubles') {
    entries = _pairForDoubles(players);
  }

  const bracket = tType === 'round_robin' 
    ? _generateRoundRobin(entries)
    : _generateBracket(entries, entries.length * Math.pow(2, parseInt(extraRounds) || 0));

  await setDoc(doc(db, 'reservations', weekKey),
    _reservationSlots(courts, dayIdx, startHour, endHour, name, players),
    { merge: true });

  const ref = await addDoc(collection(db, 'tournaments'), {
    name, type: tType, courts, format: fmt, date, dayIdx, weekKey, startHour, endHour, players,
    bracket, bracketSize: entries.length,
    createdBy: state.currentUser.uid,
    createdAt: serverTimestamp(),
  });

  return ref;
}

export async function updateTournamentRecord(old, { name, type, courts, date, dayIdx, weekKey, startHour, endHour, players, format, extraRounds }) {
  const fmt = format || 'singles';
  const tType = type || 'elimination';

  const oldCourts = _getCourts(old);
  const clearUpdates = {};
  for (const c of oldCourts) {
    for (let h = old.startHour; h < old.endHour; h++) {
      clearUpdates[`${c}_${old.dayIdx}_${h}`] = deleteField();
    }
  }
  if (Object.keys(clearUpdates).length) await updateDoc(doc(db, 'reservations', old.weekKey), clearUpdates);

  await setDoc(doc(db, 'reservations', weekKey),
    _reservationSlots(courts, dayIdx, startHour, endHour, name, players),
    { merge: true });

  let entries = [...players];
  if (fmt === 'doubles') {
    entries = _pairForDoubles(players);
  }

  const bracket = tType === 'round_robin'
    ? _generateRoundRobin(entries)
    : _generateBracket(entries, entries.length * Math.pow(2, parseInt(extraRounds) || 0));

  await updateDoc(doc(db, 'tournaments', old.id), {
    name, type: tType, courts, format: fmt, date, dayIdx, weekKey, startHour, endHour, players,
    bracket, bracketSize: entries.length,
  });
}