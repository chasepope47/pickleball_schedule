// =============================================================================
// FIREBASE IMPORTS  (CDN — no build step required)
// =============================================================================

import { initializeApp }                          from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getFirestore, doc, setDoc, updateDoc,
         onSnapshot, deleteField }                from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG }                        from './firebase-config.js';

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db          = getFirestore(firebaseApp);


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

/** Returns the Monday of the week containing `date`, at midnight local time. */
function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();                            // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

/** Returns YYYY-MM-DD for a Date object. */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Returns the Date for `dayIdx` (0=Mon … 6=Sun) in the current week. */
function dayDate(dayIdx) {
  const d = new Date(WEEK_MONDAY);
  d.setDate(d.getDate() + dayIdx);
  return d;
}

/** Returns the Date for the start of a specific slot. */
function slotDateTime(dayIdx, hour) {
  const d = dayDate(dayIdx);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Formats a 24h hour as "9:00 AM" or "2:00 PM". */
function fmtHour(h) {
  const period  = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${period}`;
}

/** Returns a time-range label, e.g. "9:00 AM – 10:00 AM". */
function slotLabel(h) {
  return `${fmtHour(h)} – ${fmtHour(h + 1)}`;
}

// Computed once on load
const WEEK_MONDAY = getMondayOf(new Date());
const WEEK_KEY    = isoDate(WEEK_MONDAY);           // e.g. "2026-06-16"
const weekDocRef  = doc(db, 'reservations', WEEK_KEY);

const todayDayIdx = (() => {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;                       // Mon=0 … Sun=6
})();


// =============================================================================
// DEVICE ID  (used to scope notifications to the device that made the booking)
// =============================================================================

const DEVICE_ID = (() => {
  const key      = 'ss_deviceId';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = Math.random().toString(36).slice(2);
  localStorage.setItem(key, id);
  return id;
})();


// =============================================================================
// STATE  (local cache — kept in sync by onSnapshot)
// =============================================================================

/**
 * data[court][dayIdx][hour] = { firstName, lastName, notif, deviceId } | undefined
 * This is a client-side mirror of the Firestore document.
 * Shape in Firestore: one flat map of "{court}_{dayIdx}_{hour}" → reservation object
 */
let data = { 1: {}, 2: {} };

/** Which day tab is currently selected. */
let selectedDay = todayDayIdx;


// =============================================================================
// FIRESTORE — REAL-TIME SYNC
// =============================================================================

/**
 * Converts the flat Firestore map into the nested data[court][dayIdx][hour] shape
 * and triggers a full re-render + notification reschedule.
 */
function applySnapshot(flatMap) {
  data = { 1: {}, 2: {} };

  for (const [key, res] of Object.entries(flatMap)) {
    const [court, dayIdx, hour] = key.split('_').map(Number);
    if (!data[court])         data[court]         = {};
    if (!data[court][dayIdx]) data[court][dayIdx] = {};
    data[court][dayIdx][hour] = res;
  }

  rescheduleAll();
  render();
}

/** Starts listening for real-time updates from Firestore. */
function startSync() {
  onSnapshot(weekDocRef, (snap) => {
    applySnapshot(snap.exists() ? snap.data() : {});
  }, (err) => {
    console.error('Firestore sync error:', err);
    showToast('Connection error — check your network.', 'error');
  });
}


// =============================================================================
// FIRESTORE — WRITES
// =============================================================================

/** Optimistically updates the local cache and writes to Firestore. */
async function setRes(court, dayIdx, hour, value) {
  // Optimistic local update for instant UI response
  if (!data[court][dayIdx]) data[court][dayIdx] = {};
  data[court][dayIdx][hour] = value;
  render();

  const key = `${court}_${dayIdx}_${hour}`;
  try {
    await setDoc(weekDocRef, { [key]: value }, { merge: true });
  } catch (err) {
    console.error('Failed to save reservation:', err);
    showToast('Could not save — please try again.', 'error');
  }
}

/** Optimistically removes from the local cache and deletes from Firestore. */
async function delRes(court, dayIdx, hour) {
  // Optimistic local update
  if (data[court][dayIdx]) delete data[court][dayIdx][hour];
  render();

  const key = `${court}_${dayIdx}_${hour}`;
  try {
    await updateDoc(weekDocRef, { [key]: deleteField() });
  } catch (err) {
    console.error('Failed to delete reservation:', err);
    showToast('Could not cancel — please try again.', 'error');
  }
}

function getRes(court, dayIdx, hour) {
  return (data[court][dayIdx] || {})[hour];
}


// =============================================================================
// NOTIFICATIONS
// =============================================================================

const notifTimers = {};

function timerKey(court, dayIdx, hour) {
  return `${court}_${dayIdx}_${hour}`;
}

/**
 * Schedules a browser notification 30 minutes before the slot.
 * Only fires on the device that originally made the booking (matched via deviceId).
 */
function scheduleNotif(court, dayIdx, hour, res) {
  if (!res || !res.notif)              return; // notification not requested
  if (res.deviceId !== DEVICE_ID)      return; // not this device's booking

  const alertAt = slotDateTime(dayIdx, hour).getTime() - 30 * 60 * 1000;
  if (alertAt <= Date.now())           return; // slot already passed

  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);

  notifTimers[key] = setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('SafeStreets Pickleball – 30 min reminder', {
        body: `${res.firstName} ${res.lastName}, your Court ${court} slot starts at ${fmtHour(hour)} today!`
      });
    }
  }, alertAt - Date.now());
}

/** Cancels any pending notification timer for a slot. */
function cancelNotif(court, dayIdx, hour) {
  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  delete notifTimers[key];
}

/** Re-arms all future notification timers after a page load or sync. */
function rescheduleAll() {
  for (const court of COURTS) {
    for (const [di, hours] of Object.entries(data[court])) {
      for (const [h, res] of Object.entries(hours)) {
        if (res) scheduleNotif(court, +di, +h, res);
      }
    }
  }
}

/** Hides the banner if permission has already been decided. */
function updateNotifBanner() {
  const pending = 'Notification' in window && Notification.permission === 'default';
  document.getElementById('notifBanner').classList.toggle('hidden', !pending);
}

/** Called by the "Enable Reminders" button. Exposed globally for the HTML onclick. */
function enableNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(() => {
    updateNotifBanner();
    rescheduleAll();
  });
}
window.enableNotifications = enableNotifications; // expose to inline HTML onclick


// =============================================================================
// TOAST  (lightweight status messages)
// =============================================================================

function showToast(message, type = 'info') {
  const existing = document.getElementById('toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.textContent = message;
  Object.assign(toast.style, {
    position:     'fixed',
    bottom:       '24px',
    left:         '50%',
    transform:    'translateX(-50%)',
    background:   type === 'error' ? '#e53935' : '#00d4e8',
    color:        type === 'error' ? '#fff'    : '#000',
    padding:      '10px 20px',
    borderRadius: '8px',
    fontWeight:   '700',
    fontSize:     '0.85rem',
    zIndex:       '999',
    boxShadow:    '0 4px 20px rgba(0,0,0,0.4)',
    animation:    'pop 0.18s ease-out',
  });
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}


// =============================================================================
// RENDER
// =============================================================================

/** Rebuilds the Mon–Sun tab strip. */
function buildDayTabs() {
  const container = document.getElementById('dayTabs');
  container.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const tab = document.createElement('div');
    tab.className = [
      'day-tab',
      i === selectedDay ? 'active'    : '',
      i === todayDayIdx ? 'today-tab' : '',
    ].filter(Boolean).join(' ');

    tab.innerHTML = `
      <div class="day-name">${DAY_SHORT[i]}</div>
      <div class="day-date">${dayDate(i).getDate()}</div>
    `;
    tab.addEventListener('click', () => { selectedDay = i; render(); });
    container.appendChild(tab);
  }
}

/** Rebuilds all 16 time slots for one court. */
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
      <span class="slot-status">
        ${isPast && isOpen ? 'Elapsed'
          : isOpen         ? 'Available'
                           : `${res.firstName} ${res.lastName}`}
      </span>
      <span class="slot-action">
        ${isPast ? '' : isOpen ? 'Reserve →' : 'Cancel ✕'}
      </span>
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

/** Updates the week range label and "Resets in N days" badge. */
function buildWeekLabels() {
  const fmt   = { month: 'short', day: 'numeric' };
  const start = WEEK_MONDAY.toLocaleDateString('en-US', fmt);
  const end   = dayDate(6).toLocaleDateString('en-US', fmt);
  document.getElementById('weekLabel').textContent = `Week of ${start} – ${end}`;

  const nextMonday = new Date(WEEK_MONDAY);
  nextMonday.setDate(nextMonday.getDate() + 7);
  const daysLeft = Math.ceil((nextMonday - new Date()) / (1000 * 60 * 60 * 24));
  document.getElementById('resetLabel').textContent =
    `Resets in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}`;
}

/** Full re-render: tabs + both courts. */
function render() {
  buildDayTabs();
  buildSlots(1);
  buildSlots(2);
}


// =============================================================================
// MODALS
// =============================================================================

/** Opens the reservation form for an available slot. */
function openReserveModal(court, dayIdx, hour) {
  const notifAvail   = 'Notification' in window;
  const notifGranted = notifAvail && Notification.permission === 'granted';
  const dateStr      = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: `Reserve Court ${court}`,
    sub:   `${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="form-row">
        <div class="form-group">
          <label for="firstNameInput">First Name</label>
          <input type="text" id="firstNameInput" placeholder="Jane"
                 maxlength="40" autocomplete="given-name" />
        </div>
        <div class="form-group">
          <label for="lastNameInput">Last Name</label>
          <input type="text" id="lastNameInput" placeholder="Smith"
                 maxlength="40" autocomplete="family-name" />
        </div>
      </div>
      ${notifAvail ? `
        <div class="notif-opt">
          <input type="checkbox" id="notifCheck" ${notifGranted ? 'checked' : ''} />
          <label for="notifCheck">Remind me 30 minutes before via browser notification</label>
        </div>` : ''}
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Reserve Slot', 'btn-primary', async () => {
        const fn = document.getElementById('firstNameInput');
        const ln = document.getElementById('lastNameInput');

        const firstName = fn.value.trim();
        const lastName  = ln.value.trim();
        fn.classList.toggle('error', !firstName);
        ln.classList.toggle('error', !lastName);
        if (!firstName || !lastName) return;

        const wantsNotif = notifAvail && document.getElementById('notifCheck')?.checked;
        if (wantsNotif && Notification.permission !== 'granted') {
          await Notification.requestPermission();
        }

        const res = { firstName, lastName, notif: wantsNotif, deviceId: DEVICE_ID };
        closeModal();
        await setRes(court, dayIdx, hour, res);
        scheduleNotif(court, dayIdx, hour, res);
        updateNotifBanner();
        showToast(`Booked for ${firstName} ${lastName}!`);
      }),
    ],
  });

  setTimeout(() => document.getElementById('firstNameInput')?.focus(), 80);
}

/** Opens the cancellation confirmation for a reserved slot. */
function openCancelModal(court, dayIdx, hour, res) {
  setModal({
    title: 'Cancel Reservation',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]} · ${slotLabel(hour)}`,
    body: `
      <p style="font-size:.86rem; color:#888; line-height:1.6">
        Currently reserved by
        <strong style="color:#e8e8e8">${res.firstName} ${res.lastName}</strong>.<br>
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

/** Populates and opens the shared modal shell. */
function setModal({ title, sub, body, actions }) {
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalSub').textContent   = sub;
  document.getElementById('modalBody').innerHTML    = body;

  const actionsEl = document.getElementById('modalActions');
  actionsEl.innerHTML = '';
  actions.forEach(btn => actionsEl.appendChild(btn));

  document.getElementById('modalOverlay').classList.add('active');
}

function closeModal() {
  document.getElementById('modalOverlay').classList.remove('active');
}

/** Creates a styled <button> element. */
function makeBtn(text, cls, handler) {
  const btn = document.createElement('button');
  btn.className   = `btn ${cls}`;
  btn.textContent = text;
  btn.addEventListener('click', handler);
  return btn;
}

// Close modal on backdrop click or Escape key
document.getElementById('modalOverlay').addEventListener('click', e => {
  if (e.target === document.getElementById('modalOverlay')) closeModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeModal();
});


// =============================================================================
// INIT
// =============================================================================

updateNotifBanner();   // hide banner if permission already decided
buildWeekLabels();     // week range + reset countdown
render();              // initial render with empty data while Firestore loads
startSync();           // open real-time Firestore listener (fills data + re-renders)

// Re-render every minute so past slots dim automatically
setInterval(render, 60 * 1000);
