import {
  auth, db, doc, setDoc, serverTimestamp,
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  sendPasswordResetEmail, onAuthStateChanged, signOut,
} from './firebase.js';
import { state } from './state.js';
import { authMsg } from './utils.js';
import { showToast } from './ui.js';
import {
  getCachedProfile, setCachedProfile, loadFirestoreProfile,
  applyProfileToHeader, wireProfilePill,
} from './profile.js';
import {
  buildWeekLabels, startSync, render, getJoinParams, openJoinModal,
} from './schedule.js';

// ── Auth overlay helpers ─────────────────────────────────────────────────────

const overlay = document.getElementById('welcomeOverlay');

function showAuthOverlay() { overlay.classList.remove('hidden'); }
function hideAuthOverlay() { overlay.classList.add('hidden'); }

// ── Tab switching ────────────────────────────────────────────────────────────

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

// ── Sign In ──────────────────────────────────────────────────────────────────

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
  } catch (err) {
    document.getElementById('loginBtn').textContent = 'Sign In →';
    errorEl.textContent = authMsg(err.code);
    errorEl.classList.remove('hidden');
  }
});

// ── Forgot Password ──────────────────────────────────────────────────────────

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

// ── Create Account ───────────────────────────────────────────────────────────

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
  } catch (err) {
    document.getElementById('signupBtn').textContent = 'Create Account →';
    errorEl.textContent = authMsg(err.code);
    errorEl.classList.remove('hidden');
  }
});

// ── Auth State Listener (app entry point) ────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser    = null;
    state.currentProfile = null;
    state.appInitialized = false;
    showAuthOverlay();
    document.getElementById('loginBtn').textContent  = 'Sign In →';
    document.getElementById('signupBtn').textContent = 'Create Account →';
    return;
  }

  state.currentUser = user;

  state.currentProfile = getCachedProfile() || null;
  if (state.currentProfile) applyProfileToHeader(state.currentProfile);

  try {
    const firestoreProfile = await loadFirestoreProfile(user.uid);
    if (firestoreProfile) {
      state.currentProfile = firestoreProfile;
      applyProfileToHeader(state.currentProfile);
    }
  } catch (err) {
    console.warn('Profile load failed, using cache:', err);
  }

  if (!state.currentProfile) {
    showToast('Could not load your profile. Please sign in again.', 'error');
    await signOut(auth);
    return;
  }

  hideAuthOverlay();

  if (!state.appInitialized) {
    state.appInitialized = true;
    wireProfilePill();
    buildWeekLabels();

    const joinParams = getJoinParams();
    if (joinParams) {
      state.selectedDay = joinParams.day;
      state.pendingJoin = joinParams;
    }

    render();
    startSync();
    setInterval(render, 60_000);
  } else {
    applyProfileToHeader(state.currentProfile);
  }
});
