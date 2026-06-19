import {
  auth, db, doc, setDoc, serverTimestamp,
  signInWithEmailAndPassword,
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
import { wireAdminBtn } from './admin.js';
import { refreshDeptSection } from './departments.js';

// ── Auth overlay helpers ─────────────────────────────────────────────────────

const overlay = document.getElementById('welcomeOverlay');

function showAuthOverlay() {
  overlay.classList.remove('hidden');
  document.getElementById('loginBtn').textContent = 'Sign In →';
}
function hideAuthOverlay() { overlay.classList.add('hidden'); }

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

// ── Auth State Listener (app entry point) ────────────────────────────────────

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    state.currentUser    = null;
    state.currentProfile = null;
    state.appInitialized = false;
    showAuthOverlay();
    return;
  }

  state.currentUser = user;

  state.currentProfile = getCachedProfile() || null;
  if (state.currentProfile) applyProfileToHeader(state.currentProfile);

  try {
    const firestoreProfile = await loadFirestoreProfile(user.uid);

    if (firestoreProfile?.status === 'blocked') {
      showToast('Your account has been suspended. Contact management.', 'error');
      await signOut(auth);
      return;
    }

    if (firestoreProfile) {
      state.currentProfile = firestoreProfile;
      applyProfileToHeader(state.currentProfile);
    }
  } catch (err) {
    console.warn('Profile load failed, using cache:', err);
  }

  if (!state.currentProfile) {
    showToast('Could not load your profile. Contact management.', 'error');
    await signOut(auth);
    return;
  }

  hideAuthOverlay();

  if (!state.appInitialized) {
    state.appInitialized = true;
    wireProfilePill();
    wireAdminBtn();
    buildWeekLabels();

    const joinParams = getJoinParams();
    if (joinParams) {
      state.selectedDay = joinParams.day;
      state.pendingJoin = joinParams;
    }

    render();
    startSync();
    setInterval(render, 60_000);
    // Re-apply header after dept icons load so the avatar badge shows
    refreshDeptSection().then(() => {
      if (state.currentProfile) applyProfileToHeader(state.currentProfile);
    });
  } else {
    applyProfileToHeader(state.currentProfile);
    wireAdminBtn();
  }
});
