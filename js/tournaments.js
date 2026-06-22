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

// ── Generation Math ──────────────────────────────────────────────────────────

const _PLACEHOLDER_POOL = [
  'The Picklers', 'Net Ninjas', 'Dink Squad', 'Volley Kings',
  'Court Crushers', 'Lob Stars', 'Baseline Crew', 'Kitchen Cats',
  'Smash Pack', 'Rally Squad', 'Ace Team', 'Drop Shot Boys',
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

function _getRoundLabel(roundIdx, totalRounds, isRR = false) {
  if (isRR) {
    const fromEnd = totalRounds - 1 - roundIdx;
    if (fromEnd === 0) return 'Playoffs: Final';
    if (fromEnd === 1) return 'Playoffs: Semifinals';
    return `Round ${roundIdx + 1}`;
  }
  const fromEnd = totalRounds - 1 - roundIdx;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semifinals';
  if (fromEnd === 2) return 'Quarterfinals';
  return `Round of ${Math.pow(2, fromEnd + 1)}`;
}

function _generateBracket(players, minSize = 0) {
  if (!players || players.length < 2) return null;
  const shuffledEntries = [...players].sort(() => Math.random() - 0.5);

  let naturalSize = 1;
  while (naturalSize < shuffledEntries.length) naturalSize *= 2;
  const size = Math.max(naturalSize, minSize);

  if (shuffledEntries.length < size) {
    const structuralPaddings = _makePlaceholders(size - shuffledEntries.length);
    shuffledEntries.push(...structuralPaddings);
  }

  const r1m = [];
  for (let i = 0; i < shuffledEntries.length; i += 2) {
    r1m.push({ p1: shuffledEntries[i], p2: shuffledEntries[i + 1], winner: null });
  }

  const rounds = [{ matches: r1m }];
  let cnt = r1m.length / 2;
  while (cnt >= 1) {
    rounds.push({ matches: Array.from({ length: cnt }, () => ({ p1: null, p2: null, winner: null })) });
    cnt /= 2;
  }
  return { rounds };
}

// Generates a true individual round robin schedule (King of the Court) where partners change each round
function _generateRoundRobin(players, format) {
  if (!players || players.length < 2) return null;

  // Handle Singles style round robin directly
  if (format !== 'doubles') {
    const pool = [...players].sort(() => Math.random() - 0.5);
    if (pool.length % 2 !== 0) pool.push({ uid: '__BYE__', firstName: 'BYE', lastName: '', isBye: true });
    
    const numRounds = pool.length - 1;
    const rounds = [];
    for (let r = 0; r < numRounds; r++) {
      const matches = [];
      for (let m = 0; m < pool.length / 2; m++) {
        const p1 = pool[m];
        const p2 = pool[pool.length - 1 - m];
        if (!p1.isBye && !p2.isBye) matches.push({ p1, p2, winner: null });
      }
      rounds.push({ matches });
      pool.splice(1, 0, pool.pop());
    }
    rounds.push({ isPlayoff: true, isSemi: true, matches: Array.from({ length: 2 }, () => ({ p1: { isTBD: true }, p2: { isTBD: true }, winner: null })) });
    rounds.push({ isPlayoff: true, isFinal: true, matches: Array.from({ length: 1 }, () => ({ p1: null, p2: null, winner: null })) });
    return { rounds };
  }

  // Doubles individual mix-and-match schedule (King of the Court)
  const pool = [...players].sort(() => Math.random() - 0.5);
  while (pool.length % 4 !== 0) {
    pool.push({ uid: `__GHOST_${Date.now()}_${pool.length}__`, firstName: 'Ghost', lastName: 'Player', isGhost: true, rating: 3.0 });
  }

  const numRounds = pool.length - 1; 
  const rounds = [];

  for (let r = 0; r < numRounds; r++) {
    const matches = [];
    const half = pool.length / 2;

    // Cross-circle alignment pairings avoid clones playing together
    for (let i = 0; i < half; i += 2) {
      const a = pool[i];
      const b = pool[pool.length - 1 - i];
      const c = pool[i + 1];
      const d = pool[pool.length - 2 - i];

      const team1 = {
        uid: `${a.uid}__${b.uid}`,
        firstName: `${a.firstName} ${a.lastName}`,
        lastName: `& ${b.firstName} ${b.lastName}`,
        rating: ((a.rating || 3.0) + (b.rating || 3.0)) / 2,
        players: [a, b],
        isTemporaryTeam: true
      };

      const team2 = {
        uid: `${c.uid}__${d.uid}`,
        firstName: `${c.firstName} ${c.lastName}`,
        lastName: `& ${d.firstName} ${d.lastName}`,
        rating: ((c.rating || 3.0) + (d.rating || 3.0)) / 2,
        players: [c, d],
        isTemporaryTeam: true
      };

      matches.push({ p1: team1, p2: team2, winner: null });
    }
    rounds.push({ matches });
    // Rotate pool elements keeping position [0] locked down to secure fresh combinations
    pool.splice(1, 0, pool.pop());
  }

  // Inject structural playoff cuts
  rounds.push({ isPlayoff: true, isSemi: true, matches: Array.from({ length: 2 }, () => ({ p1: { isTBD: true }, p2: { isTBD: true }, winner: null })) });
  rounds.push({ isPlayoff: true, isFinal: true, matches: Array.from({ length: 1 }, () => ({ p1: null, p2: null, winner: null })) });

  return { rounds };
}

function _calculateStandingsAndAdvance(bracket, format) {
  const standings = {};

  // Track wins for single players inside temporary team combinations
  bracket.rounds.forEach(round => {
    if (round.isPlayoff) return;
    round.matches.forEach(m => {
      if (!m.winner) return;
      if (m.winner.isTemporaryTeam && Array.isArray(m.winner.players)) {
        m.winner.players.forEach(p => {
          standings[p.uid] = (standings[p.uid] || 0) + 1;
        });
      } else {
        standings[m.winner.uid] = (standings[m.winner.uid] || 0) + 1;
      }
    });
  });

  // Extract real individual players from the first round setup blocks
  const individualPlayersMap = new Map();
  bracket.rounds[0].matches.forEach(m => {
    [m.p1, m.p2].forEach(entry => {
      if (!entry) return;
      if (entry.isTemporaryTeam && Array.isArray(entry.players)) {
        entry.players.forEach(p => { if (!p.isGhost) individualPlayersMap.set(p.uid, p); });
      } else if (!entry.isPlaceholder && !entry.isTBD) {
        individualPlayersMap.set(entry.uid, entry);
      }
    });
  });

  // Sort players cleanly by total individual wins earned
  const sortedLeaderboard = Array.from(individualPlayersMap.values()).sort((a, b) => {
    return (standings[b.uid] || 0) - (standings[a.uid] || 0);
  });

  const semiIndex = bracket.rounds.findIndex(r => r.isPlayoff && r.isSemi);
  if (semiIndex === -1) return;

  const semiMatches = bracket.rounds[semiIndex].matches;

  // Build high performance post-season matches out of top 4 individual winners
  if (format === 'doubles') {
    if (sortedLeaderboard.length >= 4) {
      const p1 = sortedLeaderboard[0], p2 = sortedLeaderboard[1], p3 = sortedLeaderboard[2], p4 = sortedLeaderboard[3];
      
      // Semifinal Match 1: Seed 1 & Seed 4
      semiMatches[0].p1 = {
        uid: `${p1.uid}__${p4.uid}`,
        firstName: `${p1.firstName} ${p1.lastName}`,
        lastName: `& ${p4.firstName} ${p4.lastName}`,
        rating: ((p1.rating || 3.0) + (p4.rating || 3.0)) / 2,
        players: [p1, p4],
        seed: '1&4'
      };
      semiMatches[0].p2 = { isTBD: true };

      // Semifinal Match 2: Seed 2 & Seed 3
      semiMatches[1].p1 = {
        uid: `${p2.uid}__${p3.uid}`,
        firstName: `${p2.firstName} ${p2.lastName}`,
        lastName: `& ${p3.firstName} ${p3.lastName}`,
        rating: ((p2.rating || 3.0) + (p3.rating || 3.0)) / 2,
        players: [p2, p3],
        seed: '2&3'
      };
      semiMatches[1].p2 = { isTBD: true };
    }
  } else {
    if (sortedLeaderboard.length >= 2) {
      semiMatches[0].p1 = sortedLeaderboard[0] ? { ...sortedLeaderboard[0], seed: 1 } : { isTBD: true };
      semiMatches[0].p2 = sortedLeaderboard[3] ? { ...sortedLeaderboard[3], seed: 4 } : (sortedLeaderboard[2] ? { ...sortedLeaderboard[2], seed: 3 } : { isTBD: true });
      semiMatches[1].p1 = sortedLeaderboard[1] ? { ...sortedLeaderboard[1], seed: 2 } : { isTBD: true };
      semiMatches[1].p2 = sortedLeaderboard[2] ? { ...sortedLeaderboard[2], seed: 3 } : { isTBD: true };
    }
  }
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

  if (t.type === 'round_robin') {
    _calculateStandingsAndAdvance(bracket, t.format);

    const currentRound = bracket.rounds[roundIdx];
    if (currentRound.isPlayoff && roundIdx + 1 < bracket.rounds.length) {
      const nextRound = bracket.rounds[roundIdx + 1];
      if (matchIdx === 0) nextRound.matches[0].p1 = winner;
      if (matchIdx === 1) nextRound.matches[0].p2 = winner;
    }
  } else {
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
  const champion = rounds[total - 1].matches[0]?.winner;

  let html = '';

  if (champion) {
    html += `
      <div style="text-align:center;padding:10px 0 14px;border-bottom:1px solid var(--border);margin-bottom:14px">
        <div style="font-size:1.4rem">🏆</div>
        <div style="font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--cyan);margin-top:4px">Tournament Champion</div>
        <div style="font-size:1rem;font-weight:700;margin-top:2px">${_displayName(champion)}</div>
      </div>`;
  }

  rounds.forEach((round, ri) => {
    const label = _getRoundLabel(ri, total, isRR);

    const matchesHtml = round.matches.map((m, mi) => {
      const { p1, p2, winner } = m;
      const p1Won = winner && p1 && winner.uid === p1.uid;
      const p2Won = winner && p2 && winner.uid === p2.uid;
      const canWinP1 = staff && !winner && p1 && !p1.isTBD && p2 && !p2.isTBD;
      const canWinP2 = staff && !winner && p2 && !p2.isTBD && p1 && !p1.isTBD;
      
      const ASGN = slot => `<button class="slot-assign-btn" data-slot="${slot}" style="font-size:.65rem;padding:2px 6px;background:transparent;color:var(--cyan);border:1px solid var(--cyan);border-radius:4px;cursor:pointer;flex-shrink:0">Edit</button>`;

      const playerRow = (p, won, slotLabel, canWin, slotRef) => {
        if (!p) return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
            <span style="flex:1;font-size:.8rem;color:var(--text-muted);font-style:italic">${slotLabel}</span>
          </div>`;
        if (p.isTBD) return `
          <div style="display:flex;align-items:center;gap:8px;padding:7px 10px">
            <span style="flex:1;font-size:.8rem;color:var(--text-muted);font-style:italic">TBD (Leaderboard Cut)</span>
          </div>`;
        const bg  = won ? 'background:rgba(6,182,212,.1)' : '';
        const col = won ? 'color:var(--cyan);font-weight:700' : 'color:var(--text)';
        
        return `
          <div style="display:flex;align-items:center;gap:6px;padding:7px 10px;${bg}">
            ${p.seed ? `<span style="font-size:.65rem;color:var(--cyan);font-weight:800;margin-right:2px">[#${p.seed}]</span>` : ''}
            <span style="flex:1;font-size:.82rem;${col}">${_displayName(p)}</span>
            ${p.rating != null ? `<span style="font-size:.68rem;color:var(--text-muted);margin-right:4px">${Number(p.rating).toFixed(1)}</span>` : ''}
            ${won  ? '<span style="font-size:.78rem;color:var(--cyan)">✓</span>' : ''}
            ${canWin ? `<button data-advance="${ri}:${mi}:${p.uid}" style="font-size:.68rem;padding:2px 7px;background:var(--cyan);color:#000;border:none;border-radius:4px;cursor:pointer;font-weight:700;margin-right:4px">Win</button>` : ''}
            ${staff && !winner && !round.isPlayoff ? ASGN(slotRef) : ''}
          </div>`;
      };

      return `
        <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;overflow:hidden;margin-bottom:6px">
          ${playerRow(p1, p1Won, 'TBD', canWinP1, `${ri}:${mi}:p1`)}
          <div style="height:1px;background:var(--border)"></div>
          ${playerRow(p2, p2Won, 'TBD', canWinP2, `${ri}:${mi}:p2`)}
        </div>`;
    }).join('');

    html += `
      <div style="margin-bottom:16px">
        <div style="font-size:.67rem;font-weight:800;text-transform:uppercase;letter-spacing:.07em;color:var(--cyan);margin-bottom:7px">${label}</div>
        ${matchesHtml || '<p style="font-size:.8rem;color:var(--text-muted);font-style:italic">No matches scheduled.</p>'}
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
  if (t.type === 'round_robin') return 'Mixed Round Robin';
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

  const subLabel = `${t.type === 'round_robin' ? 'Round Robin + Playoffs' : 'Elimination'} · ${t.format === 'doubles' ? 'Doubles' : 'Singles'}`;

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

  if (t.type === 'round_robin') {
    _calculateStandingsAndAdvance(bracket, t.format);
  }

  await updateDoc(doc(db, 'tournaments', t.id), { 
    bracket,
    players: currentPlayers 
  });

  const snap = await getDoc(doc(db, 'tournaments', t.id));
  if (snap.exists()) _openTournamentModal({ id: t.id, ...snap.data() });
}

async function _openSlotAssignment(t, ri, mi, side) {
  const fmt = t.format || 'singles';
  const available = Array.isArray(t.players) ? [...t.players] : [];
  available.sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));

  if (available.length === 0) {
    showToast('There are no players assigned to this tournament roster.', 'error');
    return;
  }

  const existingEntry = t.bracket?.rounds?.[ri]?.matches?.[mi]?.[side];
  const isEditing = existingEntry && !existingEntry.isPlaceholder && !existingEntry.isTBD;

  const opts = available.map(p =>
    `<option value="${p.uid}">${p.firstName} ${p.lastName}${p.rating ? ' ★' + p.rating : ''}</option>`).join('');

  const backFn = () => getDoc(doc(db, 'tournaments', t.id))
    .then(s => { if (s.exists()) _openTournamentModal({ id: s.id, ...s.data() }); });

  if (fmt === 'singles') {
    setModal({
      title:   isEditing ? 'Edit Entry' : 'Assign Player',
      sub:     'Replace this slot with an option from the roster',
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

  const bracket = tType === 'round_robin' 
    ? _generateRoundRobin(players, fmt)
    : _generateBracket(fmt === 'doubles' ? _pairForDoubles(players) : players, players.length * Math.pow(2, parseInt(extraRounds) || 0));

  await setDoc(doc(db, 'reservations', weekKey),
    _reservationSlots(courts, dayIdx, startHour, endHour, name, players),
    { merge: true });

  const ref = await addDoc(collection(db, 'tournaments'), {
    name, type: tType, courts, format: fmt, date, dayIdx, weekKey, startHour, endHour, players,
    bracket, bracketSize: players.length,
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

  const bracket = tType === 'round_robin'
    ? _generateRoundRobin(players, fmt)
    : _generateBracket(fmt === 'doubles' ? _pairForDoubles(players) : players, players.length * Math.pow(2, parseInt(extraRounds) || 0));

  await updateDoc(doc(db, 'tournaments', old.id), {
    name, type: tType, courts, format: fmt, date, dayIdx, weekKey, startHour, endHour, players,
    bracket, bracketSize: players.length,
  });
}