import {
  db, doc, setDoc, updateDoc, onSnapshot, getDocs, getDoc,
  deleteField, collection, query, where,
} from './firebase.js';
import { state } from './state.js';
import { COURTS, HOURS, MAX_PLAYERS, DAY_NAMES, DAY_SHORT } from './constants.js';
import { dayDate, slotDateTime, fmtHour, slotLabel, getInitials, WEEK_MONDAY, WEEK_KEY } from './utils.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { requireWaiver, applyProfileToHeader } from './profile.js';
import { openMatchLogModal, openMatchDetailModal } from './matches.js';

const weekDocRef = doc(db, 'reservations', WEEK_KEY);

function isStaff() {
  const r = state.currentProfile?.role;
  return r === 'admin' || r === 'manager';
}

const MAX_RESERVATIONS = 2;

function _countMyReservations() {
  const uid = state.currentUser?.uid;
  if (!uid) return 0;
  let count = 0;
  for (const courtData of Object.values(state.data)) {
    for (const dayData of Object.values(courtData)) {
      for (const res of Object.values(dayData)) {
        if (normalizeRes(res).some(p => p.uid === uid)) count++;
      }
    }
  }
  return count;
}

// ── Streak ───────────────────────────────────────────────────────────────────

async function _updateStreak() {
  const profile = state.currentProfile;
  if (!profile || !state.currentUser) return;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  // Already got credit today — nothing to do
  if (profile.lastPlayedDate === todayStr) return;

  let newStreak;
  if (!profile.lastPlayedDate) {
    newStreak = 1;
  } else {
    const [ly, lm, ld] = profile.lastPlayedDate.split('-').map(Number);
    const gapDays = Math.round((new Date(now.getFullYear(), now.getMonth(), now.getDate()) - new Date(ly, lm - 1, ld)) / 864e5);
    newStreak = gapDays <= 3 ? (profile.streak || 0) + 1 : 1;
  }

  profile.streak         = newStreak;
  profile.lastPlayedDate = todayStr;
  applyProfileToHeader(profile);

  try {
    await updateDoc(doc(db, 'players', state.currentUser.uid), { streak: newStreak, lastPlayedDate: todayStr });
  } catch (err) {
    console.error('Streak update failed:', err);
  }
}

// ── Reservation helpers ──────────────────────────────────────────────────────

export function normalizeRes(res) {
  if (!res) return [];
  if (Array.isArray(res.players)) return res.players;
  if (res.firstName) {
    return [{
      firstName: res.firstName, lastName: res.lastName,
      rating: res.rating || null, uid: res.deviceId || null, notif: res.notif || false,
    }];
  }
  return [];
}

export function getRes(court, dayIdx, hour) { return (state.data[court][dayIdx] || {})[hour]; }

export async function setRes(court, dayIdx, hour, value) {
  if (!state.data[court][dayIdx]) state.data[court][dayIdx] = {};
  state.data[court][dayIdx][hour] = value;
  render();
  try {
    await setDoc(weekDocRef, { [`${court}_${dayIdx}_${hour}`]: value }, { merge: true });
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Could not save — please try again.', 'error');
  }
}

export async function delRes(court, dayIdx, hour) {
  if (state.data[court][dayIdx]) delete state.data[court][dayIdx][hour];
  render();
  try {
    await updateDoc(weekDocRef, { [`${court}_${dayIdx}_${hour}`]: deleteField() });
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Could not cancel — please try again.', 'error');
  }
}

// ── Firestore sync ───────────────────────────────────────────────────────────

function applySnapshot(flatMap) {
  state.data = { 1: {}, 2: {} };
  for (const [key, res] of Object.entries(flatMap)) {
    const parts = key.split('_').map(Number);
    if (parts.length !== 3) continue;
    const [court, dayIdx, hour] = parts;
    if (!state.data[court]) continue;
    if (!state.data[court][dayIdx]) state.data[court][dayIdx] = {};
    state.data[court][dayIdx][hour] = res;
  }
  rescheduleAll();
  render();

  if (state.pendingJoin) {
    const { court, day, hour } = state.pendingJoin;
    state.pendingJoin = null;
    const players   = normalizeRes(getRes(court, day, hour));
    const alreadyIn = players.some(p => p.uid === state.currentUser?.uid);
    if (!alreadyIn) setTimeout(() => openJoinModal(court, day, hour, players), 150);
    else showToast("You're already in this game!");
  }
}

export async function loadWeekMatches() {
  if (!state.currentUser) return;
  try {
    let snap;
    if (isStaff()) {
      snap = await getDocs(query(collection(db, 'matches'), where('weekKey', '==', WEEK_KEY)));
    } else {
      snap = await getDocs(query(collection(db, 'matches'), where('uid', '==', state.currentUser.uid)));
    }
    state.matchCache.clear();
    snap.docs.forEach(d => {
      const m = d.data();
      if (isStaff() || m.weekKey === WEEK_KEY) state.matchCache.set(m.slotKey, { id: d.id, ...m });
    });
    render();
  } catch (err) {
    console.warn('Could not load match history:', err);
  }
}

export function startSync() {
  loadWeekMatches();
  onSnapshot(
    weekDocRef,
    snap => applySnapshot(snap.exists() ? snap.data() : {}),
    err  => {
      console.error('Firestore sync error:', err);
      showToast('Connection error — check your network.', 'error');
    }
  );
}

// ── Notifications ────────────────────────────────────────────────────────────

const notifTimers = {};
function timerKey(c, d, h) { return `${c}_${d}_${h}`; }

function scheduleNotif(court, dayIdx, hour, res) {
  if (!state.currentUser) return;
  const players = normalizeRes(res);
  const me      = players.find(p => p.uid === state.currentUser.uid && p.notif);
  if (!me) return;

  const alertAt = slotDateTime(dayIdx, hour).getTime() - 30 * 60 * 1000;
  if (alertAt <= Date.now()) return;

  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  notifTimers[key] = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('SafeStreets Pickleball – 30 min reminder', {
        body: `${me.firstName}, Court ${court} starts at ${fmtHour(hour)}!`,
      });
    }
  }, alertAt - Date.now());
}

export function cancelNotif(court, dayIdx, hour) {
  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  delete notifTimers[key];
}

function rescheduleAll() {
  for (const court of COURTS)
    for (const [di, hours] of Object.entries(state.data[court]))
      for (const [h, res] of Object.entries(hours))
        if (res) scheduleNotif(court, +di, +h, res);
}

// ── Share link ───────────────────────────────────────────────────────────────

export function copyShareLink(court, dayIdx, hour) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('court', court);
  url.searchParams.set('day', dayIdx);
  url.searchParams.set('hour', hour);
  url.searchParams.set('week', WEEK_KEY);
  navigator.clipboard.writeText(url.toString())
    .then(() => showToast('Share link copied!'))
    .catch(() => prompt('Copy this link to share:', url.toString()));
}

export function getJoinParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has('court')) return null;
  history.replaceState(null, '', location.pathname);

  const court = parseInt(params.get('court'));
  const day   = parseInt(params.get('day'));
  const hour  = parseInt(params.get('hour'));
  const week  = params.get('week');

  if (!COURTS.includes(court) || isNaN(day) || !HOURS.includes(hour)) return null;
  if (day < 0 || day > 6) return null;
  if (week && week !== WEEK_KEY) {
    setTimeout(() => showToast('This share link is from a different week.', 'error'), 1000);
    return null;
  }
  return { court, day, hour };
}

// ── Render ───────────────────────────────────────────────────────────────────

export function buildWeekLabels() {
  const fmt = { month: 'short', day: 'numeric' };
  document.getElementById('weekLabel').textContent =
    `Week of ${WEEK_MONDAY.toLocaleDateString('en-US', fmt)} – ${dayDate(6).toLocaleDateString('en-US', fmt)}`;

  const nextMon = new Date(WEEK_MONDAY);
  nextMon.setDate(nextMon.getDate() + 7);
  const diff = Math.ceil((nextMon - new Date()) / 864e5);
  document.getElementById('resetLabel').textContent =
    `Resets in ${diff} day${diff !== 1 ? 's' : ''}`;
}

function buildDayTabs() {
  const container = document.getElementById('dayTabs');
  container.innerHTML = '';
  const todayDayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();
  for (let i = 0; i < 7; i++) {
    const tab = document.createElement('div');
    tab.className = ['day-tab',
      i === state.selectedDay ? 'active'    : '',
      i === todayDayIdx       ? 'today-tab' : '',
    ].filter(Boolean).join(' ');
    tab.innerHTML = `<div class="day-name">${DAY_SHORT[i]}</div><div class="day-date">${dayDate(i).getDate()}</div>`;
    tab.addEventListener('click', () => { state.selectedDay = i; render(); });
    container.appendChild(tab);
  }
}

function playerRowHtml(p, isMe) {
  return `
    <div class="modal-player-row ${isMe ? 'is-me' : ''}">
      <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
      <span class="p-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}</span>
      <span class="p-rating">${p.rating ? `★ ${p.rating}` : '—'}</span>
    </div>
  `;
}

function notifOptHtml(profile) {
  if (!('Notification' in window)) return '';
  const checked = profile.notif && Notification.permission === 'granted';
  return `
    <div class="notif-opt" style="margin-top:12px">
      <input type="checkbox" id="resNotif" ${checked ? 'checked' : ''} />
      <label for="resNotif">Remind me 30 min before via browser notification</label>
    </div>
  `;
}

function buildSlots(court) {
  const container = document.getElementById(`slots${court}`);
  const freeEl    = document.getElementById(`free${court}`);
  container.innerHTML = '';
  let openCount = 0;
  const now = new Date();

  for (const hour of HOURS) {
    const slotEnd = slotDateTime(state.selectedDay, hour + 1);
    const isPast  = slotEnd <= now;
    const res     = getRes(court, state.selectedDay, hour);
    const players = normalizeRes(res);
    const isFull  = players.length >= MAX_PLAYERS;
    const amIIn   = players.some(p => p.uid === state.currentUser?.uid);
    const isOpen  = players.length === 0;

    if (isOpen && !isPast) openCount++;

    let stateClass, actionText, clickable;
    if (isPast) {
      const logged = state.matchCache.get(`${court}_${state.selectedDay}_${hour}`);
      if (logged && (amIIn || isStaff())) {
        const lt   = logged.type;
        stateClass = lt === 'competitive'
          ? (logged.won ? 'past-result win-logged' : 'past-result loss-logged')
          : 'past-result friendly-logged';
        actionText = lt === 'competitive'
          ? (logged.won ? '✓ Win' : '✗ Loss')
          : '🤝 Friendly';
          
        if (!amIIn && isStaff()) actionText = '⚙ Edit'; 
        clickable = true;
      } else if (amIIn) {
        stateClass = 'past-result';
        actionText = 'Log Match';
        clickable = true;
      } else {
        stateClass = 'past';
        actionText = '';
        clickable  = false;
      }
    } else if (isOpen) {
      stateClass = 'open';     actionText = 'Reserve →'; clickable = true;
    } else if (amIIn) {
      stateClass = 'mine';
      actionText = players.length === 1 ? 'Cancel ✕' : 'Leave ✕';
      clickable  = true;
    } else if (isFull) {
      stateClass = 'full'; actionText = '🔒 Full'; clickable = false;
    } else {
      stateClass = 'joinable'; actionText = 'Join →'; clickable = true;
    }

    const chips = players.map(p => {
      const isMe  = p.uid === state.currentUser?.uid;
      const name  = `${p.firstName} ${p.lastName[0]}.`;
      const stars = p.rating ? ` ★${p.rating}` : '';
      return `<span class="player-chip ${isMe ? 'mine-chip' : 'filled'}">${name}${stars}</span>`;
    });
    for (let i = 0; i < MAX_PLAYERS - players.length; i++) {
      chips.push(`<span class="player-chip empty-spot">+ Open</span>`);
    }

    const slotIndex = HOURS.indexOf(hour);
    const slot = document.createElement('div');
    slot.className = `slot ${stateClass}`;
    slot.style.animationDelay = `${slotIndex * 0.035}s`;
    slot.innerHTML = `
      <div class="slot-row1">
        <span class="slot-time">${slotLabel(hour)}</span>
        ${!isOpen ? `<span class="slot-count">${players.length}/${MAX_PLAYERS}</span>` : ''}
        ${actionText ? `<span class="slot-action">${actionText}</span>` : ''}
        ${!isPast && !isOpen ? `<button class="slot-share-btn" title="Copy share link">🔗</button>` : ''}
        ${isStaff() && players.length > 0 ? `<button class="slot-admin-btn" title="Manage slot">⚙</button>` : ''}
      </div>
      ${players.length > 0 ? `<div class="slot-players">${chips.join('')}</div>` : ''}
    `;

    if (clickable) {
      if (isPast) {
        const logged = state.matchCache.get(`${court}_${state.selectedDay}_${hour}`);
        if (logged && (amIIn || isStaff())) {
          slot.addEventListener('click', () => openMatchDetailModal(logged));
        } else if (amIIn) {
          slot.addEventListener('click', () => openMatchLogModal(court, state.selectedDay, hour));
        }
      } else if (isOpen) {
        slot.addEventListener('click', () => openReserveModal(court, state.selectedDay, hour));
      } else if (amIIn) {
        slot.addEventListener('click', () => openLeaveModal(court, state.selectedDay, hour, players));
      } else if (!isFull) {
        slot.addEventListener('click', () => openJoinModal(court, state.selectedDay, hour, players));
      }
    }

    slot.querySelector('.slot-share-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      copyShareLink(court, state.selectedDay, hour);
    });

    slot.querySelector('.slot-admin-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      openManageSlotModal(court, state.selectedDay, hour);
    });

    container.appendChild(slot);
  }

  freeEl.textContent = `${openCount} open`;
}

export function render() {
  if (!state.currentUser) return;
  buildDayTabs();
  const grid = document.querySelector('.courts-grid');
  if (grid) {
    grid.classList.add('switching');
    setTimeout(() => {
      buildSlots(1);
      buildSlots(2);
      grid.classList.remove('switching');
    }, 150);
  } else {
    buildSlots(1);
    buildSlots(2);
  }
}

// ── Reservation modals ───────────────────────────────────────────────────────

export function openReserveModal(court, dayIdx, hour) {
  if (!requireWaiver(() => openReserveModal(court, dayIdx, hour))) return;
  if (!isStaff() && _countMyReservations() >= MAX_RESERVATIONS) {
    showToast(`You can only reserve up to ${MAX_RESERVATIONS} time slots per week.`, 'error');
    return;
  }
  const profile = state.currentProfile;
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: `Reserve Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px">
        You'll be the first player. Share the link to invite up to 3 others.
      </p>
      <div class="modal-player-list">
        ${playerRowHtml(profile, true)}
        <div class="modal-open-spots">+ 3 open spots</div>
      </div>
      ${notifOptHtml(profile)}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Reserve Slot', 'btn-primary', async () => {
        const wantsNotif = document.getElementById('resNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          try { await Notification.requestPermission(); } catch {}
        }
        const player = {
          firstName: profile.firstName, lastName: profile.lastName,
          rating: profile.rating || null, uid: state.currentUser.uid, notif: wantsNotif,
        };
        const resObj = { players: [player], maxPlayers: MAX_PLAYERS, createdBy: state.currentUser.uid };
        closeModal();
        await setRes(court, dayIdx, hour, resObj);
        scheduleNotif(court, dayIdx, hour, resObj);
        showToast(`Court ${court} reserved for ${profile.firstName}!`);
        _updateStreak();
      }),
    ],
  });
}

export function openJoinModal(court, dayIdx, hour, currentPlayers) {
  if (!requireWaiver(() => openJoinModal(court, dayIdx, hour, currentPlayers))) return;
  if (!isStaff() && _countMyReservations() >= MAX_RESERVATIONS) {
    showToast(`You can only reserve up to ${MAX_RESERVATIONS} time slots per week.`, 'error');
    return;
  }
  const profile  = state.currentProfile;
  const dateStr  = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const openLeft = MAX_PLAYERS - currentPlayers.length - 1;

  setModal({
    title: `Join Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="modal-player-list">
        ${currentPlayers.map(p => playerRowHtml(p, false)).join('')}
        ${playerRowHtml(profile, true)}
        ${openLeft > 0 ? `<div class="modal-open-spots">+ ${openLeft} open spot${openLeft !== 1 ? 's' : ''}</div>` : ''}
      </div>
      ${notifOptHtml(profile)}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Join Game', 'btn-primary', async () => {
        const wantsNotif = document.getElementById('resNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          try { await Notification.requestPermission(); } catch {}
        }
        const newPlayer = {
          firstName: profile.firstName, lastName: profile.lastName,
          rating: profile.rating || null, uid: state.currentUser.uid, notif: wantsNotif,
        };
        const existing   = getRes(court, dayIdx, hour);
        const newPlayers = [...normalizeRes(existing), newPlayer];
        const newRes     = { players: newPlayers, maxPlayers: MAX_PLAYERS, createdBy: existing?.createdBy || state.currentUser.uid };
        closeModal();
        await setRes(court, dayIdx, hour, newRes);
        scheduleNotif(court, dayIdx, hour, newRes);
        showToast(`Joined! Court ${court} on ${DAY_NAMES[dayIdx]}.`);
        _updateStreak();
      }),
    ],
  });
}

export function openLeaveModal(court, dayIdx, hour, players) {
  const solo    = players.length === 1;
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: solo ? 'Cancel Reservation' : 'Leave Game',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="modal-player-list">
        ${players.map(p => playerRowHtml(p, p.uid === state.currentUser?.uid)).join('')}
      </div>
      <p style="font-size:.85rem;color:var(--text-dim);margin-top:10px">
        ${solo ? 'This will remove the reservation entirely.'
                : "You'll be removed. Others keep their spots."}
      </p>
    `,
    actions: [
      makeBtn('Keep Spot', 'btn-secondary', closeModal),
      makeBtn(solo ? 'Cancel Reservation' : 'Leave Game', 'btn-danger', async () => {
        cancelNotif(court, dayIdx, hour);
        closeModal();
        const remaining = players.filter(p => p.uid !== state.currentUser?.uid);
        if (remaining.length === 0) {
          await delRes(court, dayIdx, hour);
        } else {
          const current = getRes(court, dayIdx, hour);
          await setRes(court, dayIdx, hour, { ...current, players: remaining });
        }
        showToast(solo ? 'Reservation cancelled.' : "You've left the game.");
      }),
    ],
  });
}

// ── Staff: manage any slot ────────────────────────────────────────────────────

export function openManageSlotModal(court, dayIdx, hour) {
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const myRole  = state.currentProfile?.role || 'user';
  const isPast  = slotDateTime(dayIdx, hour + 1) <= new Date();
  let _allPlayers = null; // fetched once, reused on re-renders

  async function buildModal() {
    const res     = getRes(court, dayIdx, hour);
    const players = normalizeRes(res);

    // Fetch all players on first render for role lookups + Add Player dropdown
    if (_allPlayers === null) {
      try {
        const snap = await getDocs(collection(db, 'players'));
        _allPlayers = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
      } catch { _allPlayers = []; }
    }

    const playersWithRoles = players.map(p => {
      if (p.uid === state.currentUser?.uid) return { ...p, role: myRole };
      const found = _allPlayers.find(ap => ap.uid === p.uid);
      return { ...p, role: found?.role || 'user' };
    });

    const canRemove = (targetRole) =>
      myRole === 'admin' || (myRole === 'manager' && targetRole !== 'admin');

    const hasAdmin     = playersWithRoles.some(p => p.role === 'admin');
    const canClearSlot = myRole === 'admin' || (myRole === 'manager' && !hasAdmin);
    const isFull       = players.length >= MAX_PLAYERS;

    const available = isPast ? [] : (_allPlayers || [])
      .filter(ap => ap.status !== 'blocked' && !players.some(p => p.uid === ap.uid))
      .sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));

    setModal({
      title: `Manage Slot`,
      sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
      body: `
        ${playersWithRoles.length === 0
          ? `<p style="text-align:center;color:var(--text-muted);padding:16px">No players in this slot.</p>`
          : `
            <div class="modal-player-list" id="mgSlotList">
              ${playersWithRoles.map(p => {
                const isMe = p.uid === state.currentUser?.uid;
                const removeBtn = canRemove(p.role)
                  ? `<button class="admin-btn delete" style="font-size:.72rem;padding:3px 8px;flex-shrink:0" data-uid="${p.uid}">Remove</button>`
                  : `<span style="font-size:.75rem;color:var(--text-muted)">Protected</span>`;
                return `
                  <div class="modal-player-row ${isMe ? 'is-me' : ''}">
                    <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
                    <span class="p-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}</span>
                    <span class="p-rating">${p.rating ? `★ ${p.rating}` : '—'}</span>
                    ${removeBtn}
                  </div>`;
              }).join('')}
            </div>
            <p style="font-size:.78rem;color:var(--text-muted);margin-top:10px">
              Removing the last player cancels the slot entirely.
            </p>`}
        ${!isPast && !isFull && available.length > 0 ? `
          <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
            <label style="font-size:.8rem;font-weight:600;color:var(--text-dim);display:block;margin-bottom:6px">Add player to slot</label>
            <div style="display:flex;gap:8px;align-items:center">
              <select id="addToSlotSelect" style="flex:1">
                <option value="">— select player —</option>
                ${available.map(ap => `<option value="${ap.uid}">${ap.firstName} ${ap.lastName}${ap.rating ? ' ★' + ap.rating : ''}</option>`).join('')}
              </select>
              <button class="btn btn-primary" id="addToSlotBtn" style="padding:8px 14px;white-space:nowrap;flex-shrink:0">Add</button>
            </div>
          </div>` : ''}
      `,
      actions: [
        (playersWithRoles.length > 0 && canClearSlot)
          ? makeBtn('Clear Entire Slot', 'btn-danger', async () => {
              await delRes(court, dayIdx, hour);
              closeModal();
              showToast('Slot cleared.');
            })
          : null,
        makeBtn('Close', 'btn-secondary', closeModal),
      ].filter(Boolean),
    });

    document.querySelectorAll('#mgSlotList [data-uid]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const uid       = btn.dataset.uid;
        const current   = getRes(court, dayIdx, hour);
        const remaining = normalizeRes(current).filter(p => p.uid !== uid);
        if (remaining.length === 0) {
          await delRes(court, dayIdx, hour);
          closeModal();
          showToast('Player removed — slot cleared.');
        } else {
          await setRes(court, dayIdx, hour, { ...current, players: remaining });
          showToast('Player removed.');
          buildModal();
        }
      });
    });

    document.getElementById('addToSlotBtn')?.addEventListener('click', async () => {
      const uid = document.getElementById('addToSlotSelect').value;
      if (!uid) return;
      const ap = (_allPlayers || []).find(p => p.uid === uid);
      if (!ap) return;

      const current    = getRes(court, dayIdx, hour);
      const curPlayers = normalizeRes(current);
      if (curPlayers.length >= MAX_PLAYERS) return showToast('Slot is full.', 'error');
      if (curPlayers.some(p => p.uid === uid)) return showToast('Player already in slot.', 'error');

      const newPlayer = { firstName: ap.firstName, lastName: ap.lastName, rating: ap.rating || null, uid, notif: false };
      const newPlayers = [...curPlayers, newPlayer];
      const newRes = current
        ? { ...current, players: newPlayers }
        : { players: newPlayers, maxPlayers: MAX_PLAYERS, createdBy: state.currentUser.uid };

      await setRes(court, dayIdx, hour, newRes);
      showToast(`${ap.firstName} ${ap.lastName} added to slot.`);
      buildModal();
    });
  }

  buildModal();
}