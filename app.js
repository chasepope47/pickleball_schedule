/* =============================================================================
   CONSTANTS
   ============================================================================= */

const HOURS     = Array.from({ length: 16 }, (_, i) => i + 6); // 6 AM – 9 PM
const DAY_NAMES = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
const DAY_SHORT = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const COURTS    = [1, 2];


/* =============================================================================
   DATE / WEEK HELPERS
   ============================================================================= */

/** Returns the Monday of the week containing `date`, at midnight. */
function getMondayOf(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();                          // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

/** Returns a YYYY-MM-DD string for `d`. */
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

/** Returns the Date object for `dayIdx` (0=Mon … 6=Sun) in the current week. */
function dayDate(dayIdx) {
  const d = new Date(WEEK_MONDAY);
  d.setDate(d.getDate() + dayIdx);
  return d;
}

/** Returns the Date object for the start of a specific slot. */
function slotDateTime(dayIdx, hour) {
  const d = dayDate(dayIdx);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Formats a 24h hour as "9:00 AM" / "2:00 PM". */
function fmtHour(h) {
  const period  = h < 12 ? 'AM' : 'PM';
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}:00 ${period}`;
}

/** Returns a formatted time range label, e.g. "9:00 AM – 10:00 AM". */
function slotLabel(h) {
  return `${fmtHour(h)} – ${fmtHour(h + 1)}`;
}

// Computed once on load — never changes during the session
const WEEK_MONDAY   = getMondayOf(new Date());
const WEEK_KEY      = 'ss_pickleball_' + isoDate(WEEK_MONDAY);
const todayDayIdx   = (() => { const d = new Date().getDay(); return d === 0 ? 6 : d - 1; })();


/* =============================================================================
   STATE
   ============================================================================= */

/** Which day tab is currently selected (0=Mon … 6=Sun). */
let selectedDay = todayDayIdx;


/* =============================================================================
   PERSISTENCE  (localStorage, keyed by week)
   ============================================================================= */

/**
 * Data shape:
 *   data[court][dayIdx][hour] = { firstName, lastName, notif } | undefined
 */
let data = { 1: {}, 2: {} };

try {
  const raw = localStorage.getItem(WEEK_KEY);
  if (raw) data = JSON.parse(raw);
} catch (_) {}

/** Saves current week's data and removes any previous weeks. */
function save() {
  localStorage.setItem(WEEK_KEY, JSON.stringify(data));

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('ss_pickleball_') && key !== WEEK_KEY) {
      localStorage.removeItem(key);
    }
  }
}

function getRes(court, dayIdx, hour) {
  return (data[court][dayIdx] || {})[hour];
}

function setRes(court, dayIdx, hour, value) {
  if (!data[court][dayIdx]) data[court][dayIdx] = {};
  data[court][dayIdx][hour] = value;
  save();
}

function delRes(court, dayIdx, hour) {
  if (data[court][dayIdx]) delete data[court][dayIdx][hour];
  save();
}


/* =============================================================================
   NOTIFICATIONS
   ============================================================================= */

const notifTimers = {};

function timerKey(court, dayIdx, hour) {
  return `${court}_${dayIdx}_${hour}`;
}

/** Schedules a browser notification 30 minutes before the slot starts. */
function scheduleNotif(court, dayIdx, hour, res) {
  if (!res || !res.notif) return;

  const alertAt = slotDateTime(dayIdx, hour).getTime() - 30 * 60 * 1000;
  if (alertAt <= Date.now()) return;

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

/** Cancels any pending notification for a slot. */
function cancelNotif(court, dayIdx, hour) {
  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  delete notifTimers[key];
}

/** Re-schedules notifications for all existing reservations (called on page load). */
function rescheduleAll() {
  for (const court of COURTS) {
    for (const [di, hours] of Object.entries(data[court])) {
      for (const [h, res] of Object.entries(hours)) {
        if (res) scheduleNotif(court, +di, +h, res);
      }
    }
  }
}

/** Hides the banner if permission is already granted or unavailable. */
function updateNotifBanner() {
  const supported = 'Notification' in window;
  const pending   = supported && Notification.permission === 'default';
  document.getElementById('notifBanner').classList.toggle('hidden', !pending);
}

/** Called by the "Enable Reminders" button in the banner. */
function enableNotifications() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(() => {
    updateNotifBanner();
    rescheduleAll();
  });
}


/* =============================================================================
   RENDER
   ============================================================================= */

/** Rebuilds the Mon–Sun tab strip. */
function buildDayTabs() {
  const container = document.getElementById('dayTabs');
  container.innerHTML = '';

  for (let i = 0; i < 7; i++) {
    const tab = document.createElement('div');
    tab.className = [
      'day-tab',
      i === selectedDay  ? 'active'    : '',
      i === todayDayIdx  ? 'today-tab' : '',
    ].join(' ').trim();

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
        ${isPast && isOpen
          ? 'Elapsed'
          : isOpen
            ? 'Available'
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

/** Updates the week label and "Resets in N days" badge. */
function buildWeekLabels() {
  const fmt  = { month: 'short', day: 'numeric' };
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


/* =============================================================================
   MODALS
   ============================================================================= */

/** Opens the reservation form for an empty slot. */
function openReserveModal(court, dayIdx, hour) {
  const notifAvail   = 'Notification' in window;
  const notifGranted = notifAvail && Notification.permission === 'granted';

  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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

        // Validate both fields
        const firstName = fn.value.trim();
        const lastName  = ln.value.trim();
        fn.classList.toggle('error', !firstName);
        ln.classList.toggle('error', !lastName);
        if (!firstName || !lastName) return;

        // Request notification permission if needed
        const wantsNotif = notifAvail && document.getElementById('notifCheck')?.checked;
        if (wantsNotif && Notification.permission !== 'granted') {
          await Notification.requestPermission();
        }

        const res = { firstName, lastName, notif: wantsNotif };
        setRes(court, dayIdx, hour, res);
        scheduleNotif(court, dayIdx, hour, res);
        updateNotifBanner();
        render();
        closeModal();
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
      makeBtn('Cancel Reservation', 'btn-danger', () => {
        cancelNotif(court, dayIdx, hour);
        delRes(court, dayIdx, hour);
        render();
        closeModal();
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


/* =============================================================================
   INIT
   ============================================================================= */

updateNotifBanner();   // hide banner if permission already decided
buildWeekLabels();     // set week range + reset countdown
rescheduleAll();       // re-arm any existing notification timers
render();              // draw tabs and slots

// Re-render every minute so past slots dim automatically
setInterval(render, 60 * 1000);
