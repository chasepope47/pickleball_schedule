import {
  db, doc, setDoc, updateDoc, onSnapshot, getDocs,
  deleteField, collection, query, where,
} from './firebase.js';
import { state } from './state.js';
import { COURTS, HOURS, MAX_PLAYERS, DAY_NAMES, DAY_SHORT } from './constants.js';
import { dayDate, slotDateTime, fmtHour, slotLabel, getInitials, WEEK_MONDAY, WEEK_KEY } from './utils.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { requireWaiver } from './profile.js';
import { openMatchLogModal, openMatchDetailModal } from './matches.js';

const weekDocRef = doc(db, 'reservations', WEEK_KEY);

function isStaff() {
  const r = state.currentProfile?.role;
  return r === 'admin' || r === 'manager';
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
    const snap = await getDocs(
      query(collection(db, 'matches'), where('uid', '==', state.currentUser.uid))
    );
    state.matchCache.clear();
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.weekKey === WEEK_KEY) state.matchCache.set(m.slotKey, { id: d.id, ...m });
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
      if (amIIn) {
        const logged = state.matchCache.get(`${court}_${state.selectedDay}_${hour}`);
        if (logged) {
          const lt   = logged.type;
          stateClass = lt === 'competitive'
            ? (logged.won ? 'past-result win-logged' : 'past-result loss-logged')
            : 'past-result friendly-logged';
          actionText = lt === 'competitive'
            ? (logged.won ? '✓ Win' : '✗ Loss')
            : '🤝 Friendly';
        } else {
          stateClass = 'past-result';
          actionText = 'Log Match';
        }
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

    const slot = document.createElement('div');
    slot.className = `slot ${stateClass}`;
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
      if (isPast && amIIn) {
        const logged = state.matchCache.get(`${court}_${state.selectedDay}_${hour}`);
        slot.addEventListener('click', () => {
          if (logged) openMatchDetailModal(logged);
          else openMatchLogModal(court, state.selectedDay, hour);
        });
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
  buildSlots(1);
  buildSlots(2);
}

// ── Reservation modals ───────────────────────────────────────────────────────

export function openReserveModal(court, dayIdx, hour) {
  if (!requireWaiver(() => openReserveModal(court, dayIdx, hour))) return;
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
      }),
    ],
  });
}

export function openJoinModal(court, dayIdx, hour, currentPlayers) {
  if (!requireWaiver(() => openJoinModal(court, dayIdx, hour, currentPlayers))) return;
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

  function buildModal() {
    const res     = getRes(court, dayIdx, hour);
    const players = normalizeRes(res);

    setModal({
      title: `Manage Slot`,
      sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
      body: players.length === 0
        ? `<p style="text-align:center;color:var(--text-muted);padding:16px">No players in this slot.</p>`
        : `
          <div class="modal-player-list" id="mgSlotList">
            ${players.map(p => {
              const isMe = p.uid === state.currentUser?.uid;
              return `
                <div class="modal-player-row ${isMe ? 'is-me' : ''}">
                  <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
                  <span class="p-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}</span>
                  <span class="p-rating">${p.rating ? `★ ${p.rating}` : '—'}</span>
                  <button class="admin-btn delete" style="font-size:.72rem;padding:3px 8px;flex-shrink:0"
                          data-uid="${p.uid}">Remove</button>
                </div>`;
            }).join('')}
          </div>
          <p style="font-size:.78rem;color:var(--text-muted);margin-top:10px">
            Removing the last player cancels the slot entirely.
          </p>
        `,
      actions: [
        players.length > 0
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
        const uid      = btn.dataset.uid;
        const current  = getRes(court, dayIdx, hour);
        const remaining = normalizeRes(current).filter(p => p.uid !== uid);
        if (remaining.length === 0) {
          await delRes(court, dayIdx, hour);
          closeModal();
          showToast('Player removed — slot cleared.');
        } else {
          await setRes(court, dayIdx, hour, { ...current, players: remaining });
          showToast('Player removed.');
          buildModal(); // refresh modal with updated list
        }
      });
    });
  }

  buildModal();
}
