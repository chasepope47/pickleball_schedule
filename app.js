// =============================================================================
// FIREBASE IMPORTS  (CDN — no build step required)
// =============================================================================

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, updateDoc, onSnapshot, deleteField }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG }
  from './firebase-config.js';

const db = getFirestore(initializeApp(FIREBASE_CONFIG));


// =============================================================================
// CONSTANTS
// =============================================================================

const HOURS     = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM – 9 PM
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const COURTS    = [1, 2];
const MAX_PLAYERS = 4;

const RATINGS = [
  [2.0, '2.0 – Beginner'],
  [2.5, '2.5 – Advanced Beginner'],
  [3.0, '3.0 – Intermediate'],
  [3.5, '3.5 – Advanced Intermediate'],
  [4.0, '4.0 – Advanced'],
  [4.5, '4.5 – Expert'],
  [5.0, '5.0 – Professional'],
];

// Reusable waiver body HTML (rendered inside a .waiver-box)
const WAIVER_BODY_HTML = `
  <p class="waiver-title">Waiver &amp; Release of Liability</p>
  <p><strong>Assumption of Risk.</strong> Pickleball is a physical sport. I understand that participation involves inherent risks including, but not limited to, physical exertion, falls, collisions with other players or equipment, muscle strains, joint injuries, and other bodily harm.</p>
  <p><strong>Release of Liability.</strong> I, on behalf of myself, my heirs, and personal representatives, voluntarily release, waive, and discharge SafeStreets, its officers, employees, and agents from any and all liability, claims, or demands arising from my participation in pickleball activities at their facilities.</p>
  <p><strong>Health Acknowledgment.</strong> I confirm I am in adequate physical condition to participate in this activity. I understand it is my responsibility to consult a physician before participating if I have any health concerns.</p>
  <p><strong>Facility Rules.</strong> I agree to follow all facility rules, court etiquette, and instructions of facility staff, and to treat all participants with respect.</p>
  <p>This agreement is effective for all court reservations made through the SafeStreets scheduling system.</p>
`;


// =============================================================================
// DATE / WEEK HELPERS
// =============================================================================

function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

function isoDate(d)              { return d.toISOString().slice(0, 10); }
function dayDate(idx)            { const d = new Date(WEEK_MONDAY); d.setDate(d.getDate() + idx); return d; }
function slotDateTime(dayIdx, h) { const d = dayDate(dayIdx); d.setHours(h, 0, 0, 0); return d; }

function fmtHour(h) {
  const p = h < 12 ? 'AM' : 'PM';
  const d = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${d}:00 ${p}`;
}

function slotLabel(h) { return `${fmtHour(h)} – ${fmtHour(h + 1)}`; }

const WEEK_MONDAY = getMondayOf(new Date());
const WEEK_KEY    = isoDate(WEEK_MONDAY);
const weekDocRef  = doc(db, 'reservations', WEEK_KEY);

const todayDayIdx = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();


// =============================================================================
// DEVICE ID
// =============================================================================

const DEVICE_ID = (() => {
  const k = 'ss_deviceId';
  return localStorage.getItem(k) || (() => {
    const id = Math.random().toString(36).slice(2);
    localStorage.setItem(k, id);
    return id;
  })();
})();


// =============================================================================
// USER PROFILE
// Profile shape: { firstName, lastName, rating, wins, losses, notif }
// =============================================================================

const PROFILE_KEY = 'ss_profile';

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function getInitials(firstName, lastName) {
  return `${(firstName[0] || '?')}${(lastName[0] || '?')}`.toUpperCase();
}

function applyProfileToHeader(profile) {
  document.getElementById('userAvatar').textContent    = getInitials(profile.firstName, profile.lastName);
  document.getElementById('userNameLabel').textContent = `${profile.firstName} ${profile.lastName}`;
}

function logout() {
  try { localStorage.removeItem(PROFILE_KEY); } catch (_) {}
  location.reload();
}

function ratingOptions(selected) {
  return RATINGS.map(([v, l]) =>
    `<option value="${v}" ${v == selected ? 'selected' : ''}>${l}</option>`
  ).join('');
}

/** Shows welcome overlay and resolves when user submits a valid profile.
 *  Fully synchronous — no Notification API calls to prevent browser hangs. */
function promptForProfile() {
  return new Promise(resolve => {
    const overlay = document.getElementById('welcomeOverlay');
    overlay.classList.remove('hidden');

    document.getElementById('profileSaveBtn').addEventListener('click', () => {
      const fn = document.getElementById('profileFirst');
      const ln = document.getElementById('profileLast');
      const firstName = fn.value.trim();
      const lastName  = ln.value.trim();

      fn.classList.toggle('error', !firstName);
      ln.classList.toggle('error', !lastName);
      if (!firstName || !lastName) return;

      // Require waiver agreement
      const waiverCb    = document.getElementById('profileWaiver');
      const waiverLabel = document.getElementById('waiverCheckLabel');
      const waiverBox   = document.getElementById('waiverBox');
      if (!waiverCb.checked) {
        waiverLabel.classList.add('error');
        waiverBox.classList.add('error');
        waiverBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        return;
      }
      waiverLabel.classList.remove('error');
      waiverBox.classList.remove('error');

      const rating  = parseFloat(document.getElementById('profileRating').value) || 3.0;
      const profile = { firstName, lastName, rating, wins: 0, losses: 0, notif: false, waiverSigned: true };
      saveProfile(profile);
      overlay.classList.add('hidden');
      resolve(profile);
    }, { once: true });
  });
}


// =============================================================================
// THEME
// =============================================================================

const THEME_KEY  = 'ss_theme';
const html       = document.documentElement;
const iconDark   = document.getElementById('themeIconDark');
const iconLight  = document.getElementById('themeIconLight');

function applyTheme(theme) {
  html.setAttribute('data-theme', theme);
  localStorage.setItem(THEME_KEY, theme);
  const isDark = theme === 'dark';
  iconDark.style.display  = isDark ? 'block' : 'none';
  iconLight.style.display = isDark ? 'none'  : 'block';
}

function toggleTheme() {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
}

document.getElementById('themeToggle').addEventListener('click', toggleTheme);


// =============================================================================
// STATE
// =============================================================================

/** data[court][dayIdx][hour] = { players: [...], maxPlayers, createdBy } */
let data        = { 1: {}, 2: {} };
let selectedDay = todayDayIdx;

/** Pending join from a share link — set before startSync, consumed on first snapshot. */
let pendingJoin = null;


// =============================================================================
// RESERVATION HELPERS
// =============================================================================

/**
 * Returns a normalized players array from a Firestore reservation object.
 * Handles both the new multi-player format and the legacy single-player format.
 */
function normalizeRes(res) {
  if (!res) return [];
  if (Array.isArray(res.players)) return res.players;
  // Legacy format: { firstName, lastName, deviceId, notif, rating? }
  if (res.firstName) {
    return [{
      firstName: res.firstName,
      lastName:  res.lastName,
      rating:    res.rating || null,
      deviceId:  res.deviceId,
      notif:     res.notif || false,
    }];
  }
  return [];
}

function getRes(court, dayIdx, hour) { return (data[court][dayIdx] || {})[hour]; }

async function setRes(court, dayIdx, hour, value) {
  if (!data[court][dayIdx]) data[court][dayIdx] = {};
  data[court][dayIdx][hour] = value;
  render();
  try {
    await setDoc(weekDocRef, { [`${court}_${dayIdx}_${hour}`]: value }, { merge: true });
  } catch (err) {
    console.error('Save failed:', err);
    showToast('Could not save — please try again.', 'error');
  }
}

async function delRes(court, dayIdx, hour) {
  if (data[court][dayIdx]) delete data[court][dayIdx][hour];
  render();
  try {
    await updateDoc(weekDocRef, { [`${court}_${dayIdx}_${hour}`]: deleteField() });
  } catch (err) {
    console.error('Delete failed:', err);
    showToast('Could not cancel — please try again.', 'error');
  }
}


// =============================================================================
// FIRESTORE — REAL-TIME SYNC
// =============================================================================

function applySnapshot(flatMap) {
  data = { 1: {}, 2: {} };
  for (const [key, res] of Object.entries(flatMap)) {
    const parts = key.split('_').map(Number);
    if (parts.length !== 3) continue;
    const [court, dayIdx, hour] = parts;
    if (!data[court]) continue;
    if (!data[court][dayIdx]) data[court][dayIdx] = {};
    data[court][dayIdx][hour] = res;
  }
  rescheduleAll();
  render();

  // Handle a pending join link (fires once after first snapshot)
  if (pendingJoin) {
    const { court, day, hour } = pendingJoin;
    pendingJoin = null;
    const players = normalizeRes(getRes(court, day, hour));
    const alreadyIn = players.some(p => p.deviceId === DEVICE_ID);
    if (!alreadyIn) {
      setTimeout(() => openJoinModal(court, day, hour, players), 150);
    } else {
      showToast('You\'re already in this game!');
    }
  }
}

function startSync() {
  onSnapshot(
    weekDocRef,
    snap => applySnapshot(snap.exists() ? snap.data() : {}),
    err  => {
      console.error('Firestore sync error:', err);
      showToast('Connection error — check your network.', 'error');
    }
  );
}


// =============================================================================
// NOTIFICATIONS
// =============================================================================

const notifTimers = {};

function timerKey(court, dayIdx, hour) { return `${court}_${dayIdx}_${hour}`; }

function scheduleNotif(court, dayIdx, hour, res) {
  const players  = normalizeRes(res);
  const myPlayer = players.find(p => p.deviceId === DEVICE_ID && p.notif);
  if (!myPlayer) return;

  const alertAt = slotDateTime(dayIdx, hour).getTime() - 30 * 60 * 1000;
  if (alertAt <= Date.now()) return;

  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  notifTimers[key] = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('SafeStreets Pickleball – 30 min reminder', {
        body: `${myPlayer.firstName} ${myPlayer.lastName}, Court ${court} starts at ${fmtHour(hour)}!`
      });
    }
  }, alertAt - Date.now());
}

function cancelNotifForDevice(court, dayIdx, hour) {
  clearTimeout(notifTimers[timerKey(court, dayIdx, hour)]);
  delete notifTimers[timerKey(court, dayIdx, hour)];
}

function rescheduleAll() {
  for (const court of COURTS)
    for (const [di, hours] of Object.entries(data[court]))
      for (const [h, res] of Object.entries(hours))
        if (res) scheduleNotif(court, +di, +h, res);
}


// =============================================================================
// TOAST
// =============================================================================

function showToast(message, type = 'success') {
  document.getElementById('toast')?.remove();
  const t = document.createElement('div');
  t.id = 'toast';
  t.textContent = message;
  t.style.background = type === 'error' ? '#e53935' : 'var(--cyan)';
  t.style.color      = type === 'error' ? '#fff'    : '#000';
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}


// =============================================================================
// SHARE LINK
// =============================================================================

function copyShareLink(court, dayIdx, hour) {
  const url = new URL(location.href);
  url.search = '';
  url.searchParams.set('court', court);
  url.searchParams.set('day', dayIdx);
  url.searchParams.set('hour', hour);
  url.searchParams.set('week', WEEK_KEY);
  navigator.clipboard.writeText(url.toString())
    .then(() => showToast('Share link copied!'))
    .catch(() => {
      // Fallback: show the URL in a prompt
      prompt('Copy this link to share:', url.toString());
    });
}

function getJoinParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has('court')) return null;

  // Consume params from URL immediately so refresh doesn't re-trigger
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


// =============================================================================
// RENDER
// =============================================================================

function buildWeekLabels() {
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
  for (let i = 0; i < 7; i++) {
    const tab = document.createElement('div');
    tab.className = ['day-tab',
      i === selectedDay ? 'active'    : '',
      i === todayDayIdx ? 'today-tab' : '',
    ].filter(Boolean).join(' ');
    tab.innerHTML = `<div class="day-name">${DAY_SHORT[i]}</div><div class="day-date">${dayDate(i).getDate()}</div>`;
    tab.addEventListener('click', () => { selectedDay = i; render(); });
    container.appendChild(tab);
  }
}

function buildSlots(court) {
  const container = document.getElementById(`slots${court}`);
  const freeEl    = document.getElementById(`free${court}`);
  container.innerHTML = '';
  let openCount = 0;
  const now = new Date();

  for (const hour of HOURS) {
    const slotEnd = slotDateTime(selectedDay, hour + 1);
    const isPast  = slotEnd <= now;
    const res     = getRes(court, selectedDay, hour);
    const players = normalizeRes(res);
    const isFull  = players.length >= MAX_PLAYERS;
    const amIIn   = players.some(p => p.deviceId === DEVICE_ID);
    const isOpen  = players.length === 0;

    if (isOpen && !isPast) openCount++;

    // Determine slot state
    let stateClass, actionText, clickable;
    if (isPast) {
      if (amIIn) {
        stateClass = 'past-result'; actionText = 'Log Result'; clickable = true;
      } else {
        stateClass = 'past'; actionText = ''; clickable = false;
      }
    } else if (isOpen) {
      stateClass = 'open'; actionText = 'Reserve →'; clickable = true;
    } else if (amIIn) {
      stateClass = 'mine';
      actionText = players.length === 1 ? 'Cancel ✕' : 'Leave ✕';
      clickable = true;
    } else if (isFull) {
      stateClass = 'full'; actionText = '🔒 Full'; clickable = false;
    } else {
      stateClass = 'joinable'; actionText = 'Join →'; clickable = true;
    }

    // Build player chips
    const chips = players.map(p => {
      const isMe  = p.deviceId === DEVICE_ID;
      const name  = `${p.firstName} ${p.lastName[0]}.`;
      const stars = p.rating ? ` ★${p.rating}` : '';
      return `<span class="player-chip ${isMe ? 'mine-chip' : 'filled'}">${name}${stars}</span>`;
    });
    const openSpots = MAX_PLAYERS - players.length;
    for (let i = 0; i < openSpots; i++) {
      chips.push(`<span class="player-chip empty-spot">+ Open</span>`);
    }

    const showShare = !isPast && !isOpen;

    const slot = document.createElement('div');
    slot.className = `slot ${stateClass}`;
    slot.innerHTML = `
      <div class="slot-row1">
        <span class="slot-time">${slotLabel(hour)}</span>
        ${!isOpen ? `<span class="slot-count">${players.length}/${MAX_PLAYERS}</span>` : ''}
        ${actionText ? `<span class="slot-action">${actionText}</span>` : ''}
        ${showShare ? `<button class="slot-share-btn" title="Copy share link">🔗</button>` : ''}
      </div>
      ${players.length > 0 ? `<div class="slot-players">${chips.join('')}</div>` : ''}
    `;

    if (clickable) {
      const mainClickTarget = slot;
      if (isPast && amIIn) {
        mainClickTarget.addEventListener('click', () => openLogResultModal(court, selectedDay, hour));
      } else if (isOpen) {
        mainClickTarget.addEventListener('click', () => openReserveModal(court, selectedDay, hour));
      } else if (amIIn) {
        mainClickTarget.addEventListener('click', () => openLeaveModal(court, selectedDay, hour, players));
      } else if (!isFull) {
        mainClickTarget.addEventListener('click', () => openJoinModal(court, selectedDay, hour, players));
      }
    }

    // Share button — separate click (stops propagation so it doesn't trigger main click)
    const shareBtn = slot.querySelector('.slot-share-btn');
    if (shareBtn) {
      shareBtn.addEventListener('click', e => {
        e.stopPropagation();
        copyShareLink(court, selectedDay, hour);
      });
    }

    container.appendChild(slot);
  }

  freeEl.textContent = `${openCount} open`;
}

function render() {
  buildDayTabs();
  buildSlots(1);
  buildSlots(2);
}


// =============================================================================
// MODALS
// =============================================================================

function setModal({ title, sub, body, actions }) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalSub').textContent   = sub;
  document.getElementById('modalBody').innerHTML    = body;
  const el = document.getElementById('modalActions');
  el.innerHTML = '';
  actions.forEach(b => el.appendChild(b));
  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

function makeBtn(text, cls, handler) {
  const b = document.createElement('button');
  b.className = `btn ${cls}`;
  b.textContent = text;
  b.addEventListener('click', handler);
  return b;
}

document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// Notification opt-in HTML helper
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

// Builds a player row for the modal player list
function playerRowHtml(p, isMe) {
  const initials = getInitials(p.firstName, p.lastName);
  const label    = `${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}`;
  const rating   = p.rating ? `★ ${p.rating}` : '—';
  return `
    <div class="modal-player-row ${isMe ? 'is-me' : ''}">
      <div class="p-avatar">${initials}</div>
      <span class="p-name">${label}</span>
      <span class="p-rating">${rating}</span>
    </div>
  `;
}

// ── Waiver gate ──

/** Opens a modal for users who missed the waiver on the welcome screen. */
function openWaiverModal(onSigned) {
  setModal({
    title: 'Waiver Required',
    sub:   'You must agree before reserving or joining a court.',
    body: `
      <div class="waiver-box" id="modalWaiverBox" style="max-height:220px">
        ${WAIVER_BODY_HTML}
      </div>
      <label class="waiver-check" id="modalWaiverLabel" style="margin-top:12px">
        <input type="checkbox" id="modalWaiverCb" />
        <span>I have read and agree to the Waiver &amp; Release of Liability</span>
      </label>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Sign & Continue', 'btn-primary', () => {
        const cb    = document.getElementById('modalWaiverCb');
        const label = document.getElementById('modalWaiverLabel');
        const box   = document.getElementById('modalWaiverBox');
        if (!cb.checked) {
          label.classList.add('error');
          box.classList.add('error');
          return;
        }
        const p = loadProfile();
        p.waiverSigned = true;
        saveProfile(p);
        closeModal();
        showToast('Waiver signed — you can now reserve courts.');
        if (typeof onSigned === 'function') setTimeout(onSigned, 300);
      }),
    ],
  });
}

/**
 * Returns true if the user has a signed waiver.
 * If not, opens the waiver modal and returns false so the caller can abort.
 * Pass `onSigned` to re-attempt the action after the user signs.
 */
function requireWaiver(onSigned) {
  const profile = loadProfile();
  if (profile?.waiverSigned) return true;
  openWaiverModal(onSigned);
  return false;
}

// ── Reserve (first player creates the slot) ──
function openReserveModal(court, dayIdx, hour) {
  if (!requireWaiver(() => openReserveModal(court, dayIdx, hour))) return;
  const profile = loadProfile();
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: `Reserve Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:12px">
        You'll be the first player. Share the link after to invite up to 3 others.
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
          try { await Notification.requestPermission(); } catch (_) {}
        }

        const player = {
          firstName: profile.firstName,
          lastName:  profile.lastName,
          rating:    profile.rating || null,
          deviceId:  DEVICE_ID,
          notif:     wantsNotif,
        };
        const resObj = { players: [player], maxPlayers: MAX_PLAYERS, createdBy: DEVICE_ID };
        closeModal();
        await setRes(court, dayIdx, hour, resObj);
        scheduleNotif(court, dayIdx, hour, resObj);
        showToast(`Court ${court} reserved for ${profile.firstName}!`);
      }),
    ],
  });
}

// ── Join (add current user to existing slot) ──
function openJoinModal(court, dayIdx, hour, currentPlayers) {
  if (!requireWaiver(() => openJoinModal(court, dayIdx, hour, currentPlayers))) return;
  const profile = loadProfile();
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const openLeft = MAX_PLAYERS - currentPlayers.length - 1;

  const existingRows = currentPlayers.map(p => playerRowHtml(p, false)).join('');
  const youRow = playerRowHtml(profile, true);
  const moreOpen = openLeft > 0
    ? `<div class="modal-open-spots">+ ${openLeft} open spot${openLeft !== 1 ? 's' : ''}</div>`
    : '';

  const shareUrl = (() => {
    const url = new URL(location.href);
    url.search = '';
    url.searchParams.set('court', court);
    url.searchParams.set('day', dayIdx);
    url.searchParams.set('hour', hour);
    url.searchParams.set('week', WEEK_KEY);
    return url.toString();
  })();

  setModal({
    title: `Join Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="modal-player-list">
        ${existingRows}
        ${youRow}
        ${moreOpen}
      </div>
      ${notifOptHtml(profile)}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Join Game', 'btn-primary', async () => {
        const wantsNotif = document.getElementById('resNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          try { await Notification.requestPermission(); } catch (_) {}
        }

        const newPlayer = {
          firstName: profile.firstName,
          lastName:  profile.lastName,
          rating:    profile.rating || null,
          deviceId:  DEVICE_ID,
          notif:     wantsNotif,
        };

        const existing   = getRes(court, dayIdx, hour);
        const newPlayers = [...normalizeRes(existing), newPlayer];
        const newRes     = {
          players:    newPlayers,
          maxPlayers: MAX_PLAYERS,
          createdBy:  existing?.createdBy || DEVICE_ID,
        };

        closeModal();
        await setRes(court, dayIdx, hour, newRes);
        scheduleNotif(court, dayIdx, hour, newRes);
        showToast(`Joined! Court ${court} on ${DAY_NAMES[dayIdx]}.`);
      }),
    ],
  });
}

// ── Leave / Cancel ──
function openLeaveModal(court, dayIdx, hour, players) {
  const solo    = players.length === 1;
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: solo ? 'Cancel Reservation' : 'Leave Game',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="modal-player-list">
        ${players.map(p => playerRowHtml(p, p.deviceId === DEVICE_ID)).join('')}
      </div>
      <p style="font-size:.85rem;color:var(--text-dim);margin-top:10px">
        ${solo
          ? 'This will remove the reservation entirely.'
          : 'You\'ll be removed. Others keep their spots.'}
      </p>
    `,
    actions: [
      makeBtn('Keep Spot', 'btn-secondary', closeModal),
      makeBtn(solo ? 'Cancel Reservation' : 'Leave Game', 'btn-danger', async () => {
        cancelNotifForDevice(court, dayIdx, hour);
        closeModal();

        const remaining = players.filter(p => p.deviceId !== DEVICE_ID);
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

// ── Log match result (for past slots I played in) ──
function openLogResultModal(court, dayIdx, hour) {
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: 'Log Match Result',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${fmtHour(hour)}`,
    body: `
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:16px">
        How did your match go? This updates your profile record.
      </p>
      <div class="log-result-row">
        <button class="btn-win" id="logWinBtn">+ Win</button>
        <button class="btn-loss" id="logLossBtn">+ Loss</button>
      </div>
    `,
    actions: [makeBtn('Close', 'btn-secondary', closeModal)],
  });

  document.getElementById('logWinBtn').addEventListener('click', () => {
    const p = loadProfile();
    p.wins = (p.wins || 0) + 1;
    saveProfile(p);
    closeModal();
    showToast('Win recorded! Nice game!');
  });

  document.getElementById('logLossBtn').addEventListener('click', () => {
    const p = loadProfile();
    p.losses = (p.losses || 0) + 1;
    saveProfile(p);
    closeModal();
    showToast('Loss recorded. Better luck next time!');
  });
}

// ── Edit Profile ──
function openEditProfileModal(currentProfile) {
  const w = currentProfile.wins   || 0;
  const l = currentProfile.losses || 0;
  const r = currentProfile.rating || 3.0;

  setModal({
    title: 'My Profile',
    sub:   'Update your details or sign out.',
    body: `
      <div class="form-row">
        <div class="form-group">
          <label for="editFirst">First Name</label>
          <input type="text" id="editFirst" value="${currentProfile.firstName}" maxlength="40" autocomplete="given-name" />
        </div>
        <div class="form-group">
          <label for="editLast">Last Name</label>
          <input type="text" id="editLast" value="${currentProfile.lastName}" maxlength="40" autocomplete="family-name" />
        </div>
      </div>

      <div class="form-group">
        <label for="editRating">Skill Level</label>
        <select id="editRating">${ratingOptions(r)}</select>
      </div>

      <div class="profile-stats">
        <div class="stat-box wins">
          <div class="stat-val" id="statWins">${w}</div>
          <div class="stat-lbl">Wins</div>
        </div>
        <div class="stat-box losses">
          <div class="stat-val" id="statLosses">${l}</div>
          <div class="stat-lbl">Losses</div>
        </div>
        <div class="stat-box rating">
          <div class="stat-val">${r}</div>
          <div class="stat-lbl">Rating</div>
        </div>
      </div>

      <div class="log-result-row">
        <button class="btn-win"  id="editWinBtn">+ Win</button>
        <button class="btn-loss" id="editLossBtn">+ Loss</button>
      </div>

      ${'Notification' in window ? `
        <div class="notif-opt" style="margin-top:12px">
          <input type="checkbox" id="editNotif"
                 ${currentProfile.notif && Notification.permission === 'granted' ? 'checked' : ''} />
          <label for="editNotif">Remind me 30 min before reservations</label>
        </div>` : ''}

      <div class="waiver-status ${currentProfile.waiverSigned ? 'signed' : 'unsigned'}" style="margin-top:12px">
        ${currentProfile.waiverSigned
          ? '✓ Liability waiver signed'
          : `⚠ Waiver not signed — required to reserve courts
             <button class="sign-link" id="signWaiverBtn">Sign Now</button>`}
      </div>

      <hr class="modal-divider" />
      <button class="btn-logout" id="logoutBtn">Sign Out</button>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Save Changes', 'btn-primary', async () => {
        const fn = document.getElementById('editFirst');
        const ln = document.getElementById('editLast');
        const firstName = fn.value.trim();
        const lastName  = ln.value.trim();
        fn.classList.toggle('error', !firstName);
        ln.classList.toggle('error', !lastName);
        if (!firstName || !lastName) return;

        const rating     = parseFloat(document.getElementById('editRating').value) || r;
        const wantsNotif = document.getElementById('editNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          try { await Notification.requestPermission(); } catch (_) {}
        }

        const updated = { ...currentProfile, firstName, lastName, rating, notif: wantsNotif };
        saveProfile(updated);
        applyProfileToHeader(updated);
        closeModal();
        showToast('Profile updated.');
      }),
    ],
  });

  document.getElementById('editWinBtn').addEventListener('click', () => {
    const p = loadProfile();
    p.wins = (p.wins || 0) + 1;
    saveProfile(p);
    document.getElementById('statWins').textContent = p.wins;
    showToast('Win recorded!');
  });

  document.getElementById('editLossBtn').addEventListener('click', () => {
    const p = loadProfile();
    p.losses = (p.losses || 0) + 1;
    saveProfile(p);
    document.getElementById('statLosses').textContent = p.losses;
    showToast('Loss recorded.');
  });

  document.getElementById('signWaiverBtn')?.addEventListener('click', () => {
    closeModal();
    openWaiverModal(() => openEditProfileModal(loadProfile()));
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    closeModal();
    logout();
  });
}


// =============================================================================
// INIT
// =============================================================================

(async () => {
  // 1. Apply saved theme
  try { applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch (_) { applyTheme('dark'); }

  // 2. Check for share link params before anything else (clears URL immediately)
  const joinParams = getJoinParams();

  // 3. Load or collect profile
  let profile = null;
  try { profile = loadProfile(); } catch (_) {}

  if (profile) {
    document.getElementById('welcomeOverlay').classList.add('hidden');
  } else {
    profile = await promptForProfile();
  }

  applyProfileToHeader(profile);

  // 4. Wire profile pill → edit modal
  document.getElementById('userPill').addEventListener('click', () => {
    openEditProfileModal(loadProfile());
  });

  // 5. If a valid join link was detected, set state to show that day and queue the modal
  if (joinParams) {
    selectedDay = joinParams.day;
    pendingJoin = joinParams;
  }

  // 6. Build static labels, render shell, open Firestore listener
  buildWeekLabels();
  render();
  startSync();

  // Re-render every minute so past slots dim automatically
  setInterval(render, 60 * 1000);
})();
