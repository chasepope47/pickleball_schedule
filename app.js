// =============================================================================
// FIREBASE IMPORTS  (CDN — no build step required)
// =============================================================================

import { initializeApp }
  from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, getDocs, updateDoc, onSnapshot,
  deleteField, collection, addDoc, serverTimestamp, increment, query, where,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { FIREBASE_CONFIG }
  from './firebase-config.js';

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app);
const db   = getFirestore(app);


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

const BADGES = {
  'holiday-newyear':     { icon: '🎆', name: "New Year's Day",    desc: "Played on New Year's Day" },
  'holiday-valentine':   { icon: '💝', name: "Valentine's Day",   desc: "Played on Valentine's Day" },
  'holiday-stpatrick':   { icon: '🍀', name: "St. Patrick's Day", desc: "Played on St. Patrick's Day" },
  'holiday-july4':       { icon: '🎇', name: 'Independence Day',  desc: 'Played on Independence Day' },
  'holiday-halloween':   { icon: '🎃', name: 'Halloween',         desc: 'Played on Halloween' },
  'holiday-veterans':    { icon: '🎖️', name: 'Veterans Day',      desc: 'Played on Veterans Day' },
  'holiday-xmaseve':     { icon: '⭐', name: 'Christmas Eve',     desc: 'Played on Christmas Eve' },
  'holiday-xmas':        { icon: '🎄', name: 'Christmas',         desc: 'Played on Christmas Day' },
  'holiday-newyearseve': { icon: '🥂', name: "New Year's Eve",    desc: "Played on New Year's Eve" },
  skunk:     { icon: '🦨', name: 'The Skunk',       desc: 'Won a game 11–0' },
  topDog:    { icon: '👑', name: 'Top Dog',          desc: 'Reached #1 on the leaderboard' },
  earlyBird: { icon: '🌅', name: 'Early Bird',       desc: 'Played a match before 8 AM' },
  nightOwl:  { icon: '🦉', name: 'Night Owl',        desc: 'Played a match at or after 8 PM' },
};

const WAIVER_BODY_HTML = `
  <p class="waiver-title">Waiver &amp; Release of Liability</p>
  <p><strong>Assumption of Risk.</strong> Pickleball is a physical sport. I understand that participation involves inherent risks including, but not limited to, physical exertion, falls, collisions with other players or equipment, muscle strains, joint injuries, and other bodily harm.</p>
  <p><strong>Release of Liability.</strong> I, on behalf of myself, my heirs, and personal representatives, voluntarily release, waive, and discharge SafeStreets, its officers, employees, and agents from any and all liability, claims, or demands arising from my participation in pickleball activities at their facilities.</p>
  <p><strong>Health Acknowledgment.</strong> I confirm I am in adequate physical condition to participate in this activity. I understand it is my responsibility to consult a physician before participating if I have any health concerns.</p>
  <p><strong>Facility Rules.</strong> I agree to follow all facility rules, court etiquette, and instructions of facility staff, and to treat all participants with respect.</p>
  <p>This agreement is effective for all court reservations made through the SafeStreets scheduling system.</p>
`;

// Firebase auth error codes → readable messages
const AUTH_ERRORS = {
  'auth/user-not-found':       'No account found with this email.',
  'auth/wrong-password':       'Incorrect password.',
  'auth/invalid-credential':   'Invalid email or password.',
  'auth/email-already-in-use': 'An account with this email already exists.',
  'auth/weak-password':        'Password must be at least 6 characters.',
  'auth/invalid-email':        'Please enter a valid email address.',
  'auth/too-many-requests':    'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error. Check your connection.',
};

function authMsg(code) {
  return AUTH_ERRORS[code] || `Error (${code}). Please try again.`;
}


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
// APP STATE
// =============================================================================

let currentUser    = null;  // Firebase Auth user
let currentProfile = null;  // Firestore player document
let selectedDay    = todayDayIdx;
let pendingJoin    = null;  // { court, day, hour } from a share link
let appInitialized = false; // guard so startSync only runs once

/** data[court][dayIdx][hour] = { players: [...], maxPlayers, createdBy } */
let data = { 1: {}, 2: {} };

/** slotKey (`court_dayIdx_hour`) → logged match doc for the current week */
const matchCache = new Map();


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
  iconDark.style.display  = theme === 'dark' ? 'block' : 'none';
  iconLight.style.display = theme === 'dark' ? 'none'  : 'block';
}

document.getElementById('themeToggle').addEventListener('click', () => {
  applyTheme(html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
});

try { applyTheme(localStorage.getItem(THEME_KEY) || 'dark'); } catch { applyTheme('dark'); }


// =============================================================================
// PROFILE HELPERS
// =============================================================================

const PROFILE_KEY = 'ss_profile_v2'; // v2 = Firestore-backed

function getCachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; }
}

function setCachedProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
}

function getInitials(firstName, lastName) {
  return `${(firstName?.[0] || '?')}${(lastName?.[0] || '?')}`.toUpperCase();
}

function ratingOptions(selected) {
  return RATINGS.map(([v, l]) =>
    `<option value="${v}" ${v == selected ? 'selected' : ''}>${l}</option>`
  ).join('');
}

function adjustRating(current, won) {
  const delta = won ? 0.1 : -0.1;
  const raw   = (parseFloat(current) || 3.0) + delta;
  return Math.round(Math.min(5.0, Math.max(2.0, raw)) * 10) / 10;
}

function getHoliday() {
  const now  = new Date();
  const key  = `${now.getMonth() + 1}/${now.getDate()}`;
  const days = {
    '1/1':   { id: 'holiday-newyear',     name: "New Year's Day" },
    '2/14':  { id: 'holiday-valentine',   name: "Valentine's Day" },
    '3/17':  { id: 'holiday-stpatrick',   name: "St. Patrick's Day" },
    '7/4':   { id: 'holiday-july4',       name: 'Independence Day' },
    '10/31': { id: 'holiday-halloween',   name: 'Halloween' },
    '11/11': { id: 'holiday-veterans',    name: 'Veterans Day' },
    '12/24': { id: 'holiday-xmaseve',     name: 'Christmas Eve' },
    '12/25': { id: 'holiday-xmas',        name: 'Christmas' },
    '12/31': { id: 'holiday-newyearseve', name: "New Year's Eve" },
  };
  return days[key] || null;
}

function resizeImage(file, size, quality, callback) {
  const img = new Image();
  const url = URL.createObjectURL(file);
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx   = canvas.getContext('2d');
    const ratio = Math.max(size / img.width, size / img.height);
    const sw    = size / ratio, sh = size / ratio;
    const sx    = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
    URL.revokeObjectURL(url);
    callback(canvas.toDataURL('image/jpeg', quality));
  };
  img.src = url;
}

async function loadFirestoreProfile(uid) {
  const snap = await getDoc(doc(db, 'players', uid));
  if (!snap.exists()) return null;
  const p = snap.data();
  setCachedProfile(p);
  return p;
}

async function saveFirestoreProfile(uid, profile) {
  await setDoc(doc(db, 'players', uid), profile, { merge: true });
  setCachedProfile(profile);
  currentProfile = profile;
}

function applyProfileToHeader(profile) {
  const avatar = document.getElementById('userAvatar');
  if (profile.photoUrl) {
    avatar.innerHTML    = `<img src="${profile.photoUrl}" alt="" />`;
  } else {
    avatar.textContent  = getInitials(profile.firstName, profile.lastName);
    avatar.innerHTML    = avatar.textContent; // clear any old img
  }
  document.getElementById('userNameLabel').textContent = `${profile.firstName} ${profile.lastName}`;
}


// =============================================================================
// AUTH OVERLAY
// =============================================================================

const overlay = document.getElementById('welcomeOverlay');

function showAuthOverlay() { overlay.classList.remove('hidden'); }
function hideAuthOverlay() { overlay.classList.add('hidden'); }

// Tab switching
document.getElementById('authTabs').addEventListener('click', e => {
  const tab = e.target.closest('.auth-tab');
  if (!tab) return;
  document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
  tab.classList.add('active');
  const panel = tab.dataset.panel;
  document.getElementById('panelSignIn').style.display = panel === 'signIn' ? 'block' : 'none';
  document.getElementById('panelSignUp').style.display = panel === 'signUp' ? 'block' : 'none';
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('signupError').classList.add('hidden');
});

// Sign In
document.getElementById('loginBtn').addEventListener('click', async () => {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errorEl  = document.getElementById('loginError');
  errorEl.classList.add('hidden');

  if (!email || !password) {
    errorEl.textContent = 'Please enter your email and password.';
    errorEl.classList.remove('hidden');
    return;
  }

  try {
    document.getElementById('loginBtn').textContent = 'Signing in…';
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged handles the rest
  } catch (err) {
    document.getElementById('loginBtn').textContent = 'Sign In →';
    errorEl.textContent = authMsg(err.code);
    errorEl.classList.remove('hidden');
  }
});

// Forgot password
document.getElementById('forgotBtn').addEventListener('click', async () => {
  const email = document.getElementById('loginEmail').value.trim();
  if (!email) {
    const errorEl = document.getElementById('loginError');
    errorEl.textContent = 'Enter your email above, then click Forgot password.';
    errorEl.classList.remove('hidden');
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    showToast('Password reset email sent!');
  } catch (err) {
    showToast(authMsg(err.code), 'error');
  }
});

// Create Account
document.getElementById('signupBtn').addEventListener('click', async () => {
  const fn       = document.getElementById('signupFirst');
  const ln       = document.getElementById('signupLast');
  const emailEl  = document.getElementById('signupEmail');
  const passEl   = document.getElementById('signupPassword');
  const waiverCb = document.getElementById('signupWaiver');
  const errorEl  = document.getElementById('signupError');

  const firstName = fn.value.trim();
  const lastName  = ln.value.trim();
  const email     = emailEl.value.trim();
  const password  = passEl.value;

  fn.classList.toggle('error', !firstName);
  ln.classList.toggle('error', !lastName);
  emailEl.classList.toggle('error', !email);
  passEl.classList.toggle('error', password.length < 6);

  if (!firstName || !lastName || !email || password.length < 6) return;

  // Require waiver
  if (!waiverCb.checked) {
    const label = document.getElementById('signupWaiverLabel');
    const box   = document.getElementById('signupWaiverBox');
    label.classList.add('error');
    box.classList.add('error');
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return;
  }

  errorEl.classList.add('hidden');
  const rating = parseFloat(document.getElementById('signupRating').value) || 3.0;

  try {
    document.getElementById('signupBtn').textContent = 'Creating account…';
    const { user } = await createUserWithEmailAndPassword(auth, email, password);

    const profile = {
      firstName, lastName, rating,
      wins: 0, losses: 0,
      waiverSigned: true,
      email: user.email,
      createdAt: serverTimestamp(),
    };
    await setDoc(doc(db, 'players', user.uid), profile);
    setCachedProfile(profile);
    // onAuthStateChanged handles the rest
  } catch (err) {
    document.getElementById('signupBtn').textContent = 'Create Account →';
    errorEl.textContent = authMsg(err.code);
    errorEl.classList.remove('hidden');
  }
});


// =============================================================================
// AUTH STATE LISTENER  (entry point after Firebase loads)
// =============================================================================

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentUser    = null;
    currentProfile = null;
    appInitialized = false;
    showAuthOverlay();
    // Reset button labels in case of failed attempt
    document.getElementById('loginBtn').textContent   = 'Sign In →';
    document.getElementById('signupBtn').textContent  = 'Create Account →';
    return;
  }

  currentUser = user;

  // Load profile — try Firestore, fall back to cache while it loads
  currentProfile = getCachedProfile() || null;
  if (currentProfile) applyProfileToHeader(currentProfile);

  try {
    const firestoreProfile = await loadFirestoreProfile(user.uid);
    if (firestoreProfile) {
      currentProfile = firestoreProfile;
      applyProfileToHeader(currentProfile);
    }
  } catch (err) {
    console.warn('Profile load failed, using cache:', err);
  }

  if (!currentProfile) {
    showToast('Could not load your profile. Please sign in again.', 'error');
    await signOut(auth);
    return;
  }

  hideAuthOverlay();

  if (!appInitialized) {
    appInitialized = true;
    wireProfilePill();
    buildWeekLabels();

    const joinParams = getJoinParams();
    if (joinParams) {
      selectedDay = joinParams.day;
      pendingJoin = joinParams;
    }

    render();
    startSync();
    setInterval(render, 60_000);
  } else {
    // Profile may have changed (e.g. display name update) — just re-render header
    applyProfileToHeader(currentProfile);
  }
});


// =============================================================================
// RESERVATION DATA HELPERS
// =============================================================================

/**
 * Normalises a Firestore reservation object to always return a players array.
 * Handles the new multi-player format and the legacy deviceId single-player format.
 */
function normalizeRes(res) {
  if (!res) return [];
  if (Array.isArray(res.players)) return res.players;
  // Legacy: { firstName, lastName, deviceId, notif, rating? }
  if (res.firstName) {
    return [{
      firstName: res.firstName, lastName: res.lastName,
      rating: res.rating || null, uid: res.deviceId || null, notif: res.notif || false,
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
// FIRESTORE SYNC
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

  if (pendingJoin) {
    const { court, day, hour } = pendingJoin;
    pendingJoin = null;
    const players  = normalizeRes(getRes(court, day, hour));
    const alreadyIn = players.some(p => p.uid === currentUser?.uid);
    if (!alreadyIn) setTimeout(() => openJoinModal(court, day, hour, players), 150);
    else showToast('You\'re already in this game!');
  }
}

async function loadWeekMatches() {
  if (!currentUser) return;
  try {
    const snap = await getDocs(
      query(collection(db, 'matches'), where('uid', '==', currentUser.uid))
    );
    matchCache.clear();
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.weekKey === WEEK_KEY) matchCache.set(m.slotKey, { id: d.id, ...m });
    });
    render();
  } catch (err) {
    console.warn('Could not load match history:', err);
  }
}

function startSync() {
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


// =============================================================================
// NOTIFICATIONS
// =============================================================================

const notifTimers = {};
function timerKey(c, d, h) { return `${c}_${d}_${h}`; }

function scheduleNotif(court, dayIdx, hour, res) {
  if (!currentUser) return;
  const players  = normalizeRes(res);
  const me       = players.find(p => p.uid === currentUser.uid && p.notif);
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

function cancelNotif(court, dayIdx, hour) {
  const key = timerKey(court, dayIdx, hour);
  clearTimeout(notifTimers[key]);
  delete notifTimers[key];
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
    .catch(() => prompt('Copy this link to share:', url.toString()));
}

function getJoinParams() {
  const params = new URLSearchParams(location.search);
  if (!params.has('court')) return null;
  history.replaceState(null, '', location.pathname); // clean URL

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
    const amIIn   = players.some(p => p.uid === currentUser?.uid);
    const isOpen  = players.length === 0;

    if (isOpen && !isPast) openCount++;

    let stateClass, actionText, clickable;
    if (isPast) {
      if (amIIn) {
        const logged = matchCache.get(`${court}_${selectedDay}_${hour}`);
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
      const isMe  = p.uid === currentUser?.uid;
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
      </div>
      ${players.length > 0 ? `<div class="slot-players">${chips.join('')}</div>` : ''}
    `;

    if (clickable) {
      if (isPast && amIIn) {
        const logged = matchCache.get(`${court}_${selectedDay}_${hour}`);
        slot.addEventListener('click', () => {
          if (logged) openMatchDetailModal(logged);
          else openMatchLogModal(court, selectedDay, hour);
        });
      } else if (isOpen) {
        slot.addEventListener('click', () => openReserveModal(court, selectedDay, hour));
      } else if (amIIn) {
        slot.addEventListener('click', () => openLeaveModal(court, selectedDay, hour, players));
      } else if (!isFull) {
        slot.addEventListener('click', () => openJoinModal(court, selectedDay, hour, players));
      }
    }

    slot.querySelector('.slot-share-btn')?.addEventListener('click', e => {
      e.stopPropagation();
      copyShareLink(court, selectedDay, hour);
    });

    container.appendChild(slot);
  }

  freeEl.textContent = `${openCount} open`;
}

function render() {
  if (!currentUser) return; // don't render until authenticated
  buildDayTabs();
  buildSlots(1);
  buildSlots(2);
}


// =============================================================================
// MODAL FRAMEWORK
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

function playerRowHtml(p, isMe) {
  return `
    <div class="modal-player-row ${isMe ? 'is-me' : ''}">
      <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
      <span class="p-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}</span>
      <span class="p-rating">${p.rating ? `★ ${p.rating}` : '—'}</span>
    </div>
  `;
}


// =============================================================================
// WAIVER GATE
// =============================================================================

function openWaiverModal(onSigned) {
  setModal({
    title: 'Waiver Required',
    sub:   'Required before reserving or joining a court.',
    body: `
      <div class="waiver-box" id="mWaiverBox" style="max-height:220px">${WAIVER_BODY_HTML}</div>
      <label class="waiver-check" id="mWaiverLabel" style="margin-top:12px">
        <input type="checkbox" id="mWaiverCb" />
        <span>I have read and agree to the Waiver &amp; Release of Liability</span>
      </label>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Sign & Continue', 'btn-primary', async () => {
        const cb = document.getElementById('mWaiverCb');
        if (!cb.checked) {
          document.getElementById('mWaiverLabel').classList.add('error');
          document.getElementById('mWaiverBox').classList.add('error');
          return;
        }
        const updated = { ...currentProfile, waiverSigned: true };
        await saveFirestoreProfile(currentUser.uid, updated);
        closeModal();
        showToast('Waiver signed — you can now reserve courts.');
        if (typeof onSigned === 'function') setTimeout(onSigned, 300);
      }),
    ],
  });
}

function requireWaiver(onSigned) {
  if (currentProfile?.waiverSigned) return true;
  openWaiverModal(onSigned);
  return false;
}


// =============================================================================
// RESERVATION MODALS
// =============================================================================

function openReserveModal(court, dayIdx, hour) {
  if (!requireWaiver(() => openReserveModal(court, dayIdx, hour))) return;
  const profile = currentProfile;
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
          rating: profile.rating || null, uid: currentUser.uid, notif: wantsNotif,
        };
        const resObj = { players: [player], maxPlayers: MAX_PLAYERS, createdBy: currentUser.uid };
        closeModal();
        await setRes(court, dayIdx, hour, resObj);
        scheduleNotif(court, dayIdx, hour, resObj);
        showToast(`Court ${court} reserved for ${profile.firstName}!`);
      }),
    ],
  });
}

function openJoinModal(court, dayIdx, hour, currentPlayers) {
  if (!requireWaiver(() => openJoinModal(court, dayIdx, hour, currentPlayers))) return;
  const profile = currentProfile;
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
          rating: profile.rating || null, uid: currentUser.uid, notif: wantsNotif,
        };
        const existing   = getRes(court, dayIdx, hour);
        const newPlayers = [...normalizeRes(existing), newPlayer];
        const newRes     = { players: newPlayers, maxPlayers: MAX_PLAYERS, createdBy: existing?.createdBy || currentUser.uid };
        closeModal();
        await setRes(court, dayIdx, hour, newRes);
        scheduleNotif(court, dayIdx, hour, newRes);
        showToast(`Joined! Court ${court} on ${DAY_NAMES[dayIdx]}.`);
      }),
    ],
  });
}

function openLeaveModal(court, dayIdx, hour, players) {
  const solo    = players.length === 1;
  const dateStr = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  setModal({
    title: solo ? 'Cancel Reservation' : 'Leave Game',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${slotLabel(hour)}`,
    body: `
      <div class="modal-player-list">
        ${players.map(p => playerRowHtml(p, p.uid === currentUser?.uid)).join('')}
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
        const remaining = players.filter(p => p.uid !== currentUser?.uid);
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


// =============================================================================
// MATCH LOG MODAL
// =============================================================================

function openMatchLogModal(court, dayIdx, hour) {
  const dateStr      = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let matchType      = 'friendly';
  let matchResult    = null;
  let numGames       = 3;
  const slotPlayers  = normalizeRes(getRes(court, dayIdx, hour));
  const otherPlayers = slotPlayers.filter(p => p.uid !== currentUser?.uid);

  setModal({
    title: 'Log Match Result',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${fmtHour(hour)}`,
    body: `
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:14px">
        Record this session. Competitive results update your W/L record and rating.
      </p>
      <div class="match-type-row">
        <button class="match-type-btn active" id="mtFriendly">🤝 Friendly</button>
        <button class="match-type-btn"        id="mtCompetitive">🏆 Competitive</button>
      </div>
      <div id="competitiveFields" style="display:none">
        <div class="form-group">
          <label for="gamesPlayed">Games Played</label>
          <select id="gamesPlayed">
            <option value="1">1 game</option>
            <option value="2">2 games</option>
            <option value="3" selected>3 games</option>
            <option value="4">4 games</option>
            <option value="5">5 games</option>
          </select>
        </div>
        <div id="scoreFields"></div>
        <div class="form-group" style="margin-top:6px">
          <label>Your Result</label>
          <div class="result-row">
            <button class="result-btn win"  id="resultWin">✓ Win</button>
            <button class="result-btn loss" id="resultLoss">✗ Loss</button>
          </div>
        </div>
      </div>
      ${otherPlayers.length > 0 ? `
      <div class="form-group" style="margin-top:14px">
        <label>Rate your opponents / teammates</label>
        <div class="player-rate-list" id="playerRateList">
          ${otherPlayers.map(p => `
            <div class="player-rate-row">
              <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
              <span class="p-rate-name">${p.firstName} ${p.lastName[0]}.</span>
              <div class="thumb-btns">
                <button class="thumb-btn up" data-uid="${p.uid}" data-thumb="up" type="button">👍</button>
                <button class="thumb-btn dn" data-uid="${p.uid}" data-thumb="down" type="button">👎</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="form-group" style="margin-top:10px">
        <label for="matchComment">Match Notes <span class="label-hint">(optional)</span></label>
        <textarea id="matchComment" class="match-comment" placeholder="How did the game go?..." rows="2"></textarea>
      </div>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Record Match', 'btn-primary', async () => {
        if (matchType === 'competitive' && !matchResult) {
          showToast('Please select Win or Loss.', 'error');
          return;
        }

        // Collect scores
        const scores = [];
        if (matchType === 'competitive') {
          for (let i = 1; i <= numGames; i++) {
            const a = parseInt(document.getElementById(`sg${i}a`)?.value || '0');
            const b = parseInt(document.getElementById(`sg${i}b`)?.value || '0');
            scores.push({ mine: a, theirs: b });
          }
        }

        // Collect player ratings and comment
        const playerRatings = {};
        document.querySelectorAll('#playerRateList .thumb-btn.active').forEach(btn => {
          playerRatings[btn.dataset.uid] = btn.dataset.thumb;
        });
        const comment = document.getElementById('matchComment')?.value.trim() || '';

        try {
          const slotKey   = `${court}_${dayIdx}_${hour}`;
          const matchData = {
            uid: currentUser.uid,
            slotKey,
            weekKey: WEEK_KEY,
            court, dayIdx, hour,
            type: matchType,
            players: slotPlayers,
            ...(Object.keys(playerRatings).length ? { playerRatings } : {}),
            ...(comment ? { comment } : {}),
            ...(matchType === 'competitive' ? {
              gamesPlayed: numGames, scores, won: matchResult === 'win',
            } : {}),
            recordedAt: serverTimestamp(),
          };
          const matchRef = await addDoc(collection(db, 'matches'), matchData);
          matchCache.set(slotKey, { id: matchRef.id, ...matchData });
          checkAndAwardBadges(matchData); // fire-and-forget

          if (matchType === 'competitive') {
            const won       = matchResult === 'win';
            const field     = won ? 'wins' : 'losses';
            const newRating = adjustRating(currentProfile.rating, won);
            await updateDoc(doc(db, 'players', currentUser.uid), {
              [field]: increment(1),
              rating: newRating,
            });
            currentProfile = {
              ...currentProfile,
              [field]: (currentProfile[field] || 0) + 1,
              rating: newRating,
            };
            setCachedProfile(currentProfile);
            closeModal();
            showToast(`${won ? 'Win' : 'Loss'} recorded! Rating → ${newRating}`);
          } else {
            closeModal();
            showToast('Friendly match recorded!');
          }
          render();
        } catch (err) {
          console.error('Match log failed:', err);
          showToast('Could not save match — please try again.', 'error');
        }
      }),
    ],
  });

  // Wire thumb buttons
  document.querySelectorAll('#playerRateList .thumb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      document.querySelectorAll(`#playerRateList .thumb-btn[data-uid="${uid}"]`)
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Type toggle
  function setType(type) {
    matchType = type;
    document.getElementById('mtFriendly').classList.toggle('active', type === 'friendly');
    document.getElementById('mtCompetitive').classList.toggle('active', type === 'competitive');
    document.getElementById('competitiveFields').style.display = type === 'competitive' ? 'block' : 'none';
    if (type === 'competitive') buildScoreFields();
  }

  function buildScoreFields() {
    numGames = parseInt(document.getElementById('gamesPlayed').value);
    const el = document.getElementById('scoreFields');
    el.innerHTML = '';
    for (let i = 1; i <= numGames; i++) {
      el.innerHTML += `
        <div class="score-row">
          <span class="score-label">Game ${i}</span>
          <input type="number" class="score-input" id="sg${i}a" min="0" max="99" placeholder="Yours" />
          <span class="score-dash">–</span>
          <input type="number" class="score-input" id="sg${i}b" min="0" max="99" placeholder="Theirs" />
        </div>
      `;
    }
  }

  document.getElementById('mtFriendly').addEventListener('click', () => setType('friendly'));
  document.getElementById('mtCompetitive').addEventListener('click', () => setType('competitive'));
  document.getElementById('gamesPlayed').addEventListener('change', buildScoreFields);

  document.getElementById('resultWin').addEventListener('click', () => {
    matchResult = 'win';
    document.getElementById('resultWin').classList.add('active');
    document.getElementById('resultLoss').classList.remove('active');
  });

  document.getElementById('resultLoss').addEventListener('click', () => {
    matchResult = 'loss';
    document.getElementById('resultLoss').classList.add('active');
    document.getElementById('resultWin').classList.remove('active');
  });
}


// =============================================================================
// MATCH DETAIL MODAL
// =============================================================================

function openMatchDetailModal(match) {
  const dateStr   = dayDate(match.dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let matchType   = match.type;
  let matchResult = match.type === 'competitive' ? (match.won ? 'win' : 'loss') : null;
  let numGames    = match.gamesPlayed || (match.scores || []).length || 3;

  // Pre-build score rows for initial render
  const initScores = Array.from({ length: numGames }, (_, i) => {
    const s = (match.scores || [])[i] || {};
    return `
      <div class="score-row">
        <span class="score-label">Game ${i + 1}</span>
        <input type="number" class="score-input" id="esg${i + 1}a" min="0" max="99" value="${s.mine ?? ''}" placeholder="Yours" />
        <span class="score-dash">–</span>
        <input type="number" class="score-input" id="esg${i + 1}b" min="0" max="99" value="${s.theirs ?? ''}" placeholder="Theirs" />
      </div>`;
  }).join('');

  const ratedPlayers = (match.players || []).filter(p =>
    p.uid !== currentUser?.uid && match.playerRatings?.[p.uid]
  );
  const ratingsHtml = ratedPlayers.length
    ? `<div class="match-player-ratings" style="margin-top:12px">
        ${ratedPlayers.map(p => `
          <div class="match-rate-row">
            <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
            <span class="match-rate-name">${p.firstName} ${p.lastName[0]}.</span>
            <span class="rate-thumb">${match.playerRatings[p.uid] === 'up' ? '👍' : '👎'}</span>
          </div>`).join('')}
      </div>`
    : '';

  setModal({
    title: 'Edit Match',
    sub:   `Court ${match.court} · ${DAY_NAMES[match.dayIdx]}, ${dateStr} · ${fmtHour(match.hour)}`,
    body: `
      <div class="match-type-row">
        <button class="match-type-btn ${matchType === 'friendly'    ? 'active' : ''}" id="editMtFriendly">🤝 Friendly</button>
        <button class="match-type-btn ${matchType === 'competitive' ? 'active' : ''}" id="editMtCompetitive">🏆 Competitive</button>
      </div>
      <div id="editCompetitiveFields" style="display:${matchType === 'competitive' ? 'block' : 'none'}">
        <div class="form-group">
          <label for="editGamesPlayed">Games Played</label>
          <select id="editGamesPlayed">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n === numGames ? 'selected' : ''}>${n} game${n !== 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>
        <div id="editScoreFields">${initScores}</div>
        <div class="form-group" style="margin-top:6px">
          <label>Your Result</label>
          <div class="result-row">
            <button class="result-btn win  ${matchResult === 'win'  ? 'active' : ''}" id="editResultWin">✓ Win</button>
            <button class="result-btn loss ${matchResult === 'loss' ? 'active' : ''}" id="editResultLoss">✗ Loss</button>
          </div>
        </div>
      </div>
      ${ratingsHtml}
      <div class="form-group" style="margin-top:12px">
        <label for="editMatchComment">Match Notes <span class="label-hint">(optional)</span></label>
        <textarea id="editMatchComment" class="match-comment" rows="2" placeholder="Add a note...">${typeof match.comment === 'string' ? match.comment : ''}</textarea>
      </div>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Save Changes', 'btn-primary', async () => {
        if (matchType === 'competitive' && !matchResult) {
          showToast('Please select Win or Loss.', 'error');
          return;
        }

        const scores = [];
        if (matchType === 'competitive') {
          for (let i = 1; i <= numGames; i++) {
            const a = parseInt(document.getElementById(`esg${i}a`)?.value || '0');
            const b = parseInt(document.getElementById(`esg${i}b`)?.value || '0');
            scores.push({ mine: a, theirs: b });
          }
        }
        const comment = document.getElementById('editMatchComment').value.trim();
        const newWon  = matchResult === 'win';

        // Compute stat delta
        const profileUpdates = {};
        const oldComp = match.type === 'competitive';
        const newComp = matchType === 'competitive';

        if (oldComp && !newComp) {
          profileUpdates[match.won ? 'wins' : 'losses'] = increment(-1);
          profileUpdates.rating = adjustRating(currentProfile.rating, !match.won);
        } else if (!oldComp && newComp) {
          profileUpdates[newWon ? 'wins' : 'losses'] = increment(1);
          profileUpdates.rating = adjustRating(currentProfile.rating, newWon);
        } else if (oldComp && newComp && match.won !== newWon) {
          profileUpdates[match.won ? 'wins' : 'losses'] = increment(-1);
          profileUpdates[newWon   ? 'wins' : 'losses']  = increment(1);
          profileUpdates.rating = adjustRating(adjustRating(currentProfile.rating, !match.won), newWon);
        }

        try {
          const updatedFields = {
            type: matchType,
            ...(comment ? { comment } : { comment: deleteField() }),
            ...(newComp
              ? { gamesPlayed: numGames, scores, won: newWon }
              : { gamesPlayed: deleteField(), scores: deleteField(), won: deleteField() }),
          };
          await updateDoc(doc(db, 'matches', match.id), updatedFields);

          if (Object.keys(profileUpdates).length > 0) {
            await updateDoc(doc(db, 'players', currentUser.uid), profileUpdates);
            const fresh = await loadFirestoreProfile(currentUser.uid);
            if (fresh) { currentProfile = fresh; applyProfileToHeader(fresh); }
          }

          // Build cache entry using plain values (never Firestore sentinels)
          const cachedMatch = { ...match, type: matchType };
          if (comment) cachedMatch.comment = comment;
          else delete cachedMatch.comment;
          if (newComp) Object.assign(cachedMatch, { gamesPlayed: numGames, scores, won: newWon });
          else { delete cachedMatch.gamesPlayed; delete cachedMatch.scores; delete cachedMatch.won; }
          matchCache.set(match.slotKey, cachedMatch);
          closeModal();
          showToast('Match updated!');
          render();
        } catch (err) {
          console.error('Match update failed:', err);
          showToast('Could not update — please try again.', 'error');
        }
      }),
    ],
  });

  function setEditType(type) {
    matchType = type;
    document.getElementById('editMtFriendly').classList.toggle('active', type === 'friendly');
    document.getElementById('editMtCompetitive').classList.toggle('active', type === 'competitive');
    document.getElementById('editCompetitiveFields').style.display = type === 'competitive' ? 'block' : 'none';
    if (type === 'competitive') buildEditScoreFields();
  }

  function buildEditScoreFields() {
    numGames = parseInt(document.getElementById('editGamesPlayed').value);
    const el = document.getElementById('editScoreFields');
    el.innerHTML = '';
    for (let i = 1; i <= numGames; i++) {
      const s = (match.scores || [])[i - 1] || {};
      el.innerHTML += `
        <div class="score-row">
          <span class="score-label">Game ${i}</span>
          <input type="number" class="score-input" id="esg${i}a" min="0" max="99" value="${s.mine ?? ''}" placeholder="Yours" />
          <span class="score-dash">–</span>
          <input type="number" class="score-input" id="esg${i}b" min="0" max="99" value="${s.theirs ?? ''}" placeholder="Theirs" />
        </div>`;
    }
  }

  document.getElementById('editMtFriendly').addEventListener('click', () => setEditType('friendly'));
  document.getElementById('editMtCompetitive').addEventListener('click', () => setEditType('competitive'));
  document.getElementById('editGamesPlayed')?.addEventListener('change', buildEditScoreFields);

  document.getElementById('editResultWin').addEventListener('click', () => {
    matchResult = 'win';
    document.getElementById('editResultWin').classList.add('active');
    document.getElementById('editResultLoss').classList.remove('active');
  });

  document.getElementById('editResultLoss').addEventListener('click', () => {
    matchResult = 'loss';
    document.getElementById('editResultLoss').classList.add('active');
    document.getElementById('editResultWin').classList.remove('active');
  });
}


// =============================================================================
// EASTER EGG BADGES
// =============================================================================

function showBadgeToast(badge) {
  const existing = document.getElementById('badgeToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'badgeToast';
  t.innerHTML = `
    <div class="badge-toast-header">🏅 Badge Unlocked!</div>
    <div class="badge-toast-body">
      <span class="badge-toast-icon">${badge.icon}</span>
      <div class="badge-toast-text">
        <div class="badge-toast-name">${badge.name}</div>
        <div class="badge-toast-desc">${badge.desc}</div>
      </div>
    </div>
    <div class="badge-toast-hint">Tap here to view all your badges →</div>
  `;
  t.addEventListener('click', () => { t.remove(); openEditProfileModal(); });
  document.body.appendChild(t);
  setTimeout(() => { if (document.getElementById('badgeToast') === t) t.remove(); }, 7000);
}

async function checkAndAwardBadges(matchData) {
  const earned = new Set(currentProfile.badges || []);
  const toAdd  = [];

  const holiday = getHoliday();
  if (holiday && !earned.has(holiday.id)) toAdd.push(holiday.id);

  if (!earned.has('earlyBird') && matchData.hour < 8)  toAdd.push('earlyBird');
  if (!earned.has('nightOwl')  && matchData.hour >= 20) toAdd.push('nightOwl');

  if (!earned.has('skunk') && matchData.type === 'competitive' && matchData.won) {
    if ((matchData.scores || []).some(s => s.mine === 11 && s.theirs === 0))
      toAdd.push('skunk');
  }

  if (!earned.has('topDog') && matchData.type === 'competitive' && matchData.won) {
    try {
      const snap    = await getDocs(collection(db, 'players'));
      const myWins  = (currentProfile.wins || 0) + 1;
      const topOther = snap.docs
        .filter(d => d.id !== currentUser.uid)
        .reduce((max, d) => Math.max(max, d.data().wins || 0), 0);
      if (myWins > topOther) toAdd.push('topDog');
    } catch {}
  }

  if (toAdd.length === 0) return;

  const allBadges = [...earned, ...toAdd];
  try {
    await updateDoc(doc(db, 'players', currentUser.uid), { badges: allBadges });
    currentProfile = { ...currentProfile, badges: allBadges };
    setCachedProfile(currentProfile);
    toAdd.forEach((id, i) => {
      const b = BADGES[id];
      if (b) setTimeout(() => showBadgeToast(b), 900 + i * 2200);
    });
  } catch (err) {
    console.warn('Badge award failed:', err);
  }
}


// =============================================================================
// LEADERBOARD
// =============================================================================

document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);

async function openLeaderboard() {
  setModal({
    title: '🏆 Leaderboard',
    sub:   'SafeStreets Pickleball — All Players',
    body:  '<p style="text-align:center;color:var(--text-muted);padding:20px">Loading…</p>',
    actions: [makeBtn('Close', 'btn-secondary', closeModal)],
  });

  try {
    const snap    = await getDocs(collection(db, 'players'));
    const players = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => {
        const aw = a.wins || 0, bw = b.wins || 0;
        if (bw !== aw) return bw - aw;
        return (b.rating || 0) - (a.rating || 0);
      });

    if (players.length === 0) {
      document.getElementById('modalBody').innerHTML =
        '<p style="text-align:center;color:var(--text-muted);padding:20px">No players yet.</p>';
      return;
    }

    const rows = players.map((p, i) => {
      const w     = p.wins || 0;
      const l     = p.losses || 0;
      const total = w + l;
      const pct   = total > 0 ? Math.round((w / total) * 100) + '%' : '—';
      const isMe       = p.uid === currentUser?.uid;
      const medal      = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const avatar     = p.photoUrl
        ? `<img src="${p.photoUrl}" alt="" />`
        : getInitials(p.firstName, p.lastName);
      const badgePips  = (p.badges || []).slice(0, 3).map(id => BADGES[id]?.icon || '').join('');
      return `
        <div class="leaderboard-row ${isMe ? 'me' : ''}">
          <span class="lb-rank">${medal}</span>
          <div class="lb-avatar ${p.photoUrl ? 'has-photo' : ''}">${avatar}</div>
          <div class="lb-info">
            <span class="lb-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}${badgePips ? ` <span class="lb-badges">${badgePips}</span>` : ''}</span>
            <span class="lb-rating">★ ${p.rating || '—'}</span>
          </div>
          <div class="lb-record">
            <span class="lb-w">${w}W</span>
            <span class="lb-l">${l}L</span>
            <span class="lb-pct">${pct}</span>
          </div>
        </div>
      `;
    }).join('');

    document.getElementById('modalBody').innerHTML =
      `<div class="leaderboard-list">${rows}</div>`;
  } catch (err) {
    console.error('Leaderboard failed:', err);
    document.getElementById('modalBody').innerHTML =
      '<p style="text-align:center;color:var(--red);padding:20px">Could not load leaderboard.</p>';
  }
}


// =============================================================================
// PROFILE MODAL
// =============================================================================

function wireProfilePill() {
  document.getElementById('userPill').addEventListener('click', () => {
    openEditProfileModal();
  });
}

function openEditProfileModal() {
  const p = currentProfile;
  const w = p.wins   || 0;
  const l = p.losses || 0;
  const r = p.rating || 3.0;
  let pendingPhotoUrl = null;

  setModal({
    title: 'My Profile',
    sub:   p.email || '',
    body: `
      <div class="photo-upload-area">
        <div class="photo-preview" id="photoPreview">
          ${p.photoUrl ? `<img src="${p.photoUrl}" alt="" />` : getInitials(p.firstName, p.lastName)}
        </div>
        <label class="photo-upload-btn" for="photoFileInput">
          📷 Change Photo
          <input type="file" id="photoFileInput" accept="image/*" style="display:none" />
        </label>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="editFirst">First Name</label>
          <input type="text" id="editFirst" value="${p.firstName}" maxlength="40" />
        </div>
        <div class="form-group">
          <label for="editLast">Last Name</label>
          <input type="text" id="editLast" value="${p.lastName}" maxlength="40" />
        </div>
      </div>

      <div class="profile-stats">
        <div class="stat-box wins">
          <div class="stat-val">${w}</div>
          <div class="stat-lbl">Wins</div>
        </div>
        <div class="stat-box losses">
          <div class="stat-val">${l}</div>
          <div class="stat-lbl">Losses</div>
        </div>
        <div class="stat-box rating">
          <div class="stat-val">${r}</div>
          <div class="stat-lbl">Rating ★</div>
        </div>
      </div>
      <p style="font-size:.7rem;color:var(--text-muted);text-align:center;margin-top:-6px;margin-bottom:10px">
        Rating adjusts automatically after each competitive match
      </p>

      ${(p.badges || []).length > 0 ? `
      <div class="badge-shelf">
        <div class="badge-shelf-label">Badges Earned</div>
        <div class="badge-card-list">
          ${(p.badges || []).map(id => {
            const b = BADGES[id];
            return b ? `
              <div class="badge-card">
                <div class="badge-card-icon">${b.icon}</div>
                <div class="badge-card-info">
                  <div class="badge-card-name">${b.name}</div>
                  <div class="badge-card-desc">${b.desc}</div>
                </div>
              </div>` : '';
          }).join('')}
        </div>
      </div>` : ''}

      ${'Notification' in window ? `
        <div class="notif-opt" style="margin-top:12px">
          <input type="checkbox" id="editNotif"
                 ${p.notif && Notification.permission === 'granted' ? 'checked' : ''} />
          <label for="editNotif">Remind me 30 min before reservations (browser notification)</label>
        </div>` : ''}

      <div class="waiver-status ${p.waiverSigned ? 'signed' : 'unsigned'}" style="margin-top:12px">
        ${p.waiverSigned
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

        const wantsNotif = document.getElementById('editNotif')?.checked ?? false;
        if (wantsNotif && Notification.permission !== 'granted') {
          try { await Notification.requestPermission(); } catch {}
        }

        const updated = { ...p, firstName, lastName, notif: wantsNotif };
        if (pendingPhotoUrl !== null) updated.photoUrl = pendingPhotoUrl;
        await saveFirestoreProfile(currentUser.uid, updated);
        applyProfileToHeader(updated);
        closeModal();
        showToast('Profile updated.');
      }),
    ],
  });

  document.getElementById('photoFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    resizeImage(file, 128, 0.75, dataUrl => {
      pendingPhotoUrl = dataUrl;
      document.getElementById('photoPreview').innerHTML = `<img src="${dataUrl}" alt="" />`;
    });
  });

  document.getElementById('signWaiverBtn')?.addEventListener('click', () => {
    closeModal();
    openWaiverModal(() => openEditProfileModal());
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    closeModal();
    try { await signOut(auth); } catch {}
  });
}
