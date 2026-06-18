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

function isoDate(d)               { return d.toISOString().slice(0, 10); }
function dayDate(idx)             { const d = new Date(WEEK_MONDAY); d.setDate(d.getDate() + idx); return d; }
function slotDateTime(dayIdx, h)  { const d = dayDate(dayIdx); d.setHours(h, 0, 0, 0); return d; }

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
// DEVICE ID  (scopes notifications to the reserving device)
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
// =============================================================================

const PROFILE_KEY = 'ss_profile';

function loadProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; }
}

function saveProfile(profile) {
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}

function getInitials(firstName, lastName) {
  return `${firstName[0]}${lastName[0]}`.toUpperCase();
}

function applyProfileToHeader(profile) {
  document.getElementById('userAvatar').textContent    = getInitials(profile.firstName, profile.lastName);
  document.getElementById('userNameLabel').textContent = `${profile.firstName} ${profile.lastName}`;
}

/** Shows the welcome overlay and resolves when the user submits a valid profile. */
function promptForProfile() {
  return new Promise(resolve => {
    const overlay = document.getElementById('welcomeOverlay');
    overlay.classList.remove('hidden');

    document.getElementById('profileSaveBtn').addEventListener('click', async () => {
      const fn = document.getElementById('profileFirst');
      const ln = document.getElementById('profileLast');
      const firstName = fn.value.trim();
      const lastName  = ln.value.trim();

      fn.classList.toggle('error', !firstName);
      ln.classList.toggle('error', !lastName);
      if (!firstName || !lastName) return;

      const wantsNotif = document.getElementById('profileNotif').checked;

      if (wantsNotif) {
        await Notification.requestPermission();
      }

      const profile = { firstName, lastName, notif: wantsNotif };
      saveProfile(profile);
      overlay.classList.add('hidden');
      resolve(profile);
    });
  });
}

/** Opens the edit-profile modal. */
function openEditProfileModal(currentProfile) {
  setModal({
    title: 'Edit Profile',
    sub:   'Update your name or notification preference.',
    body: `
      <div class="form-row">
        <div class="form-group">
          <label for="editFirst">First Name</label>
          <input type="text" id="editFirst" value="${currentProfile.firstName}"
                 maxlength="40" autocomplete="given-name" />
        </div>
        <div class="form-group">
          <label for="editLast">Last Name</label>
          <input type="text" id="editLast" value="${currentProfile.lastName}"
                 maxlength="40" autocomplete="family-name" />
        </div>
      </div>
      ${'Notification' in window ? `
        <div class="notif-opt">
          <input type="checkbox" id="editNotif"
                 ${currentProfile.notif && Notification.permission === 'granted' ? 'checked' : ''} />
          <label for="editNotif">Remind me 30 minutes before my reservation via browser notification</label>
        </div>` : ''}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Save', 'btn-primary', async () => {
        const fn = document.getElementById('editFirst');
        const ln = document.getElementById('editLast');
        const firstName = fn.value.trim();
        const lastName  = ln.value.trim();
        fn.classList.toggle('error', !firstName);
        ln.classList.toggle('error', !lastName);
        if (!firstName || !lastName) return;

        const wantsNotif = document.getElementById('editNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          await Notification.requestPermission();
        }

        const updated = { firstName, lastName, notif: wantsNotif };
        saveProfile(updated);
        applyProfileToHeader(updated);
        closeModal();
        showToast('Profile updated.');
      }),
    ],
  });
}


// =============================================================================
// THEME
// =============================================================================

const THEME_KEY     = 'ss_theme';
const html          = document.documentElement;
const iconDark      = document.getElementById('themeIconDark');
const iconLight     = document.getElementById('themeIconLight');

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

/** data[court][dayIdx][hour] = { firstName, lastName, notif, deviceId } */
let data       = { 1: {}, 2: {} };
let selectedDay = todayDayIdx;


// =============================================================================
// FIRESTORE — REAL-TIME SYNC
// =============================================================================

/** Converts Firestore's flat map into the nested data shape and re-renders. */
function applySnapshot(flatMap) {
  data = { 1: {}, 2: {} };
  for (const [key, res] of Object.entries(flatMap)) {
    const [court, dayIdx, hour] = key.split('_').map(Number);
    if (!data[court][dayIdx]) data[court][dayIdx] = {};
    data[court][dayIdx][hour] = res;
  }
  rescheduleAll();
  render();
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
// NOTIFICATIONS
// =============================================================================

const notifTimers = {};

function timerKey(court, dayIdx, hour) { return `${court}_${dayIdx}_${hour}`; }

function scheduleNotif(court, dayIdx, hour, res) {
  if (!res?.notif || res.deviceId !== DEVICE_ID) return;
  const alertAt = slotDateTime(dayIdx, hour).getTime() - 30 * 60 * 1000;
  if (alertAt <= Date.now()) return;

  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  notifTimers[key] = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('SafeStreets Pickleball – 30 min reminder', {
        body: `${res.firstName} ${res.lastName}, Court ${court} starts at ${fmtHour(hour)} today!`
      });
    }
  }, alertAt - Date.now());
}

function cancelNotif(court, dayIdx, hour) {
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
// RENDER
// =============================================================================

function buildWeekLabels() {
  const fmt = { month: 'short', day: 'numeric' };
  document.getElementById('weekLabel').textContent =
    `Week of ${WEEK_MONDAY.toLocaleDateString('en-US', fmt)} – ${dayDate(6).toLocaleDateString('en-US', fmt)}`;

  const nextMon  = new Date(WEEK_MONDAY);
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
      i === selectedDay  ? 'active'    : '',
      i === todayDayIdx  ? 'today-tab' : '',
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
  let freeCount = 0;
  const now = new Date();

  for (const hour of HOURS) {
    const isPast = slotDateTime(selectedDay, hour + 1) <= now;
    const res    = getRes(court, selectedDay, hour);
    const isOpen = !res;
    if (isOpen && !isPast) freeCount++;

    const slot = document.createElement('div');
    slot.className = `slot ${isPast ? 'past' : isOpen ? 'open' : 'booked'}`;
    slot.innerHTML = `
      <span class="slot-time">${slotLabel(hour)}</span>
      <span class="slot-status">${
        isPast && isOpen ? 'Elapsed' : isOpen ? 'Available' : `${res.firstName} ${res.lastName}`
      }</span>
      <span class="slot-action">${isPast ? '' : isOpen ? 'Reserve →' : 'Cancel ✕'}</span>
    `;

    if (!isPast) {
      slot.addEventListener('click', () =>
        isOpen
          ? openReserveModal(court, selectedDay, hour)
          : openCancelModal(court, selectedDay, hour, res)
      );
    }
    container.appendChild(slot);
  }

  freeEl.textContent = `${freeCount} open`;
}

function render() {
  buildDayTabs();
  buildSlots(1);
  buildSlots(2);
}


// =============================================================================
// MODALS
// =============================================================================

function openReserveModal(court, dayIdx, hour) {
  const profile      = loadProfile();
  const notifAvail   = 'Notification' in window;
  const notifGranted = notifAvail && Notification.permission === 'granted';
  const dateStr      = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: `Reserve Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="form-row">
        <div class="form-group">
          <label for="resFirst">First Name</label>
          <input type="text" id="resFirst" placeholder="Jane"
                 maxlength="40" autocomplete="given-name"
                 value="${profile?.firstName ?? ''}" />
        </div>
        <div class="form-group">
          <label for="resLast">Last Name</label>
          <input type="text" id="resLast" placeholder="Smith"
                 maxlength="40" autocomplete="family-name"
                 value="${profile?.lastName ?? ''}" />
        </div>
      </div>
      ${notifAvail ? `
        <div class="notif-opt">
          <input type="checkbox" id="resNotif"
                 ${profile?.notif && notifGranted ? 'checked' : ''} />
          <label for="resNotif">Remind me 30 minutes before via browser notification</label>
        </div>` : ''}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Reserve Slot', 'btn-primary', async () => {
        const fn = document.getElementById('resFirst');
        const ln = document.getElementById('resLast');
        const firstName = fn.value.trim();
        const lastName  = ln.value.trim();
        fn.classList.toggle('error', !firstName);
        ln.classList.toggle('error', !lastName);
        if (!firstName || !lastName) return;

        const wantsNotif = notifAvail && document.getElementById('resNotif')?.checked;
        if (wantsNotif && Notification.permission !== 'granted') await Notification.requestPermission();

        const res = { firstName, lastName, notif: wantsNotif, deviceId: DEVICE_ID };
        closeModal();
        await setRes(court, dayIdx, hour, res);
        scheduleNotif(court, dayIdx, hour, res);
        showToast(`Booked for ${firstName} ${lastName}!`);
      }),
    ],
  });

  setTimeout(() => {
    const el = document.getElementById('resFirst');
    if (!el?.value) el?.focus();
    else document.getElementById('resLast')?.focus?.();
  }, 80);
}

function openCancelModal(court, dayIdx, hour, res) {
  setModal({
    title: 'Cancel Reservation',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]} · ${slotLabel(hour)}`,
    body: `
      <p style="font-size:.86rem;color:var(--text-dim);line-height:1.6">
        Currently reserved by
        <strong style="color:var(--text)">${res.firstName} ${res.lastName}</strong>.<br>
        Remove this reservation?
      </p>
    `,
    actions: [
      makeBtn('Keep It', 'btn-secondary', closeModal),
      makeBtn('Cancel Reservation', 'btn-danger', async () => {
        cancelNotif(court, dayIdx, hour);
        closeModal();
        await delRes(court, dayIdx, hour);
        showToast('Reservation cancelled.');
      }),
    ],
  });
}

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


// =============================================================================
// INIT
// =============================================================================

(async () => {
  // 1. Apply saved theme
  applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

  // 2. Ensure user has a profile (blocks until submitted if first visit)
  let profile = loadProfile();
  if (!profile) {
    profile = await promptForProfile();
  } else {
    document.getElementById('welcomeOverlay').classList.add('hidden');
  }
  applyProfileToHeader(profile);

  // 3. Wire up profile pill click → edit modal
  document.getElementById('userPill').addEventListener('click', () => {
    openEditProfileModal(loadProfile());
  });

  // 4. Render skeleton immediately, then open Firestore listener
  buildWeekLabels();
  render();
  startSync();

  // Re-render every minute so past slots dim automatically
  setInterval(render, 60 * 1000);
})();
