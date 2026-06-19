import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  db, doc, setDoc, updateDoc, getDocs, deleteDoc, collection, serverTimestamp,
  signOut, FIREBASE_CONFIG,
} from './firebase.js';
import { state } from './state.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { getInitials, ratingOptions } from './utils.js';

// ── Secondary Firebase app (creates users without signing out the admin) ──────

let _secondaryAuth = null;
function getSecondaryAuth() {
  if (_secondaryAuth) return _secondaryAuth;
  const existing = getApps().find(a => a.name === 'adminCreate');
  const app2 = existing ?? initializeApp(FIREBASE_CONFIG, 'adminCreate');
  _secondaryAuth = getAuth(app2);
  return _secondaryAuth;
}

// ── Role helpers ─────────────────────────────────────────────────────────────

export function isAdmin() {
  return state.currentProfile?.role === 'admin';
}

// ── Admin button in header ────────────────────────────────────────────────────
// First admin must be bootstrapped manually in Firestore:
//   players/{uid}  →  role: "admin"

export function wireAdminBtn() {
  const btn = document.getElementById('adminBtn');
  if (!btn) return;
  btn.style.display = isAdmin() ? 'flex' : 'none';
  btn.onclick = openAdminPanel;
}

// ── Admin panel shell ─────────────────────────────────────────────────────────

let _activeView = 'users';

async function openAdminPanel() {
  _activeView = 'users';
  _renderShell();
  await _loadUsers();
}

function _renderShell() {
  document.getElementById('modalTitle').textContent = '⚙️ Admin Panel';
  document.getElementById('modalSub').textContent   = 'Manage SafeStreets members';
  document.getElementById('modalActions').innerHTML = '';
  document.getElementById('modalBody').innerHTML = `
    <div class="admin-tabs" id="adminTabs">
      <button class="admin-tab active" data-view="users">Users</button>
      <button class="admin-tab"        data-view="create">+ Create Account</button>
    </div>
    <div id="adminContent"></div>
  `;
  document.getElementById('modalOverlay').classList.add('active');
  document.querySelector('.modal').classList.add('modal-wide');

  document.getElementById('adminTabs').addEventListener('click', e => {
    const tab = e.target.closest('.admin-tab');
    if (!tab) return;
    _activeView = tab.dataset.view;
    document.querySelectorAll('.admin-tab').forEach(t =>
      t.classList.toggle('active', t.dataset.view === _activeView));
    if (_activeView === 'users') _loadUsers();
    else _renderCreateForm();
  });

  const closeBtn = makeBtn('Close', 'btn-secondary', closeModal);
  document.getElementById('modalActions').appendChild(closeBtn);
}

// ── Users view ────────────────────────────────────────────────────────────────

async function _loadUsers() {
  const content = document.getElementById('adminContent');
  if (!content) return;
  content.innerHTML =
    '<p style="text-align:center;color:var(--text-muted);padding:20px 0">Loading…</p>';

  try {
    const snap    = await getDocs(collection(db, 'players'));
    const players = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .sort((a, b) =>
        `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`));

    if (players.length === 0) {
      content.innerHTML =
        '<p style="text-align:center;color:var(--text-muted);padding:20px 0">No users yet.</p>';
      return;
    }

    content.innerHTML = `<div class="admin-user-list">${players.map(_userRowHtml).join('')}</div>`;

    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = players.find(u => u.uid === btn.dataset.uid);
        if (!p) return;
        const a = btn.dataset.action;
        if (a === 'block')   _confirmBlock(p, true);
        if (a === 'unblock') _confirmBlock(p, false);
        if (a === 'delete')  _confirmDelete(p);
        if (a === 'promote') _confirmRole(p, true);
        if (a === 'demote')  _confirmRole(p, false);
      });
    });
  } catch (err) {
    console.error('Admin load failed:', err);
    content.innerHTML =
      '<p style="text-align:center;color:var(--red);padding:20px 0">Could not load users.</p>';
  }
}

function _userRowHtml(p) {
  const isMe      = p.uid === state.currentUser?.uid;
  const isBlocked = p.status === 'blocked';
  const isAdminP  = p.role === 'admin';
  const avatar    = p.photoUrl
    ? `<img src="${p.photoUrl}" alt="" />`
    : getInitials(p.firstName, p.lastName);

  const statusBadge = isBlocked
    ? `<span class="admin-badge blocked">Blocked</span>`
    : `<span class="admin-badge active">Active</span>`;
  const roleBadge = isAdminP ? `<span class="admin-badge admin-role">Admin</span>` : '';

  const actions = isMe ? '<span class="admin-you">(you)</span>' : `
    ${isBlocked
      ? `<button class="admin-btn unblock" data-action="unblock" data-uid="${p.uid}">Unblock</button>`
      : `<button class="admin-btn block"   data-action="block"   data-uid="${p.uid}">Block</button>`}
    ${isAdminP
      ? `<button class="admin-btn demote"  data-action="demote"  data-uid="${p.uid}">Revoke Admin</button>`
      : `<button class="admin-btn promote" data-action="promote" data-uid="${p.uid}">Make Admin</button>`}
    <button class="admin-btn delete" data-action="delete" data-uid="${p.uid}">Remove</button>
  `;

  return `
    <div class="admin-user-row ${isBlocked ? 'is-blocked' : ''}">
      <div class="admin-avatar ${p.photoUrl ? 'has-photo' : ''}">${avatar}</div>
      <div class="admin-user-info">
        <div class="admin-user-name">${p.firstName} ${p.lastName}</div>
        <div class="admin-user-meta">${p.email || '—'} · ★${p.rating || '—'} · ${p.wins||0}W ${p.losses||0}L</div>
        <div class="admin-user-badges">${statusBadge}${roleBadge}</div>
      </div>
      <div class="admin-user-actions">${actions}</div>
    </div>
  `;
}

// ── Confirmation modals ───────────────────────────────────────────────────────

function _confirmBlock(player, blocking) {
  setModal({
    title: blocking ? 'Block User' : 'Unblock User',
    sub:   `${player.firstName} ${player.lastName}`,
    body: `<p style="font-size:.88rem;color:var(--text-dim)">
      ${blocking
        ? `<strong>${player.firstName}</strong> will be unable to access the app and signed out on their next visit.`
        : `<strong>${player.firstName}</strong> will regain full access to the app.`}
    </p>`,
    actions: [
      makeBtn('Cancel', 'btn-secondary', () => openAdminPanel()),
      makeBtn(
        blocking ? 'Block User' : 'Unblock User',
        blocking ? 'btn-danger'  : 'btn-primary',
        async () => {
          try {
            await updateDoc(doc(db, 'players', player.uid), {
              status: blocking ? 'blocked' : 'active',
            });
            showToast(`${player.firstName} ${blocking ? 'blocked' : 'unblocked'}.`);
            openAdminPanel();
          } catch (err) {
            console.error(err);
            showToast('Could not update user.', 'error');
          }
        }
      ),
    ],
  });
  document.querySelector('.modal').classList.add('modal-wide');
}

function _confirmDelete(player) {
  setModal({
    title: 'Remove User',
    sub:   `${player.firstName} ${player.lastName}`,
    body: `
      <p style="font-size:.88rem;color:var(--text-dim);margin-bottom:10px">
        This removes <strong>${player.firstName} ${player.lastName}</strong>'s profile and data.
        They will not be able to sign in until an admin creates a new account for them.
      </p>
      <p style="font-size:.8rem;color:var(--red)">This cannot be undone.</p>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', () => openAdminPanel()),
      makeBtn('Remove User', 'btn-danger', async () => {
        try {
          await deleteDoc(doc(db, 'players', player.uid));
          showToast(`${player.firstName} ${player.lastName} removed.`);
          openAdminPanel();
        } catch (err) {
          console.error(err);
          showToast('Could not remove user.', 'error');
        }
      }),
    ],
  });
  document.querySelector('.modal').classList.add('modal-wide');
}

function _confirmRole(player, promoting) {
  setModal({
    title: promoting ? 'Grant Admin Access' : 'Revoke Admin Access',
    sub:   `${player.firstName} ${player.lastName}`,
    body: `<p style="font-size:.88rem;color:var(--text-dim)">
      ${promoting
        ? `<strong>${player.firstName}</strong> will be able to manage users and create accounts.`
        : `<strong>${player.firstName}</strong> will be demoted to a regular user.`}
    </p>`,
    actions: [
      makeBtn('Cancel', 'btn-secondary', () => openAdminPanel()),
      makeBtn(
        promoting ? 'Grant Admin' : 'Revoke Admin',
        promoting ? 'btn-primary'  : 'btn-danger',
        async () => {
          try {
            await updateDoc(doc(db, 'players', player.uid), {
              role: promoting ? 'admin' : 'user',
            });
            showToast(`${player.firstName} is now ${promoting ? 'an admin' : 'a regular user'}.`);
            openAdminPanel();
          } catch (err) {
            console.error(err);
            showToast('Could not update role.', 'error');
          }
        }
      ),
    ],
  });
  document.querySelector('.modal').classList.add('modal-wide');
}

// ── Create Account view ───────────────────────────────────────────────────────

function _renderCreateForm() {
  const content = document.getElementById('adminContent');
  if (!content) return;
  content.innerHTML = `
    <div style="padding-top:8px">
      <div class="form-row">
        <div class="form-group">
          <label for="newFirst">First Name</label>
          <input type="text" id="newFirst" placeholder="Jane" maxlength="40" autocomplete="off" />
        </div>
        <div class="form-group">
          <label for="newLast">Last Name</label>
          <input type="text" id="newLast" placeholder="Smith" maxlength="40" autocomplete="off" />
        </div>
      </div>
      <div class="form-group">
        <label for="newEmail">Email</label>
        <input type="email" id="newEmail" placeholder="jane@safestreets.com" autocomplete="off" />
      </div>
      <div class="form-group">
        <label for="newPassword">Temporary Password <span class="label-hint">(share with user)</span></label>
        <input type="text" id="newPassword" placeholder="min 6 characters" autocomplete="off" />
      </div>
      <div class="form-row">
        <div class="form-group">
          <label for="newRating">Skill Level</label>
          <select id="newRating">${ratingOptions(3.0)}</select>
        </div>
        <div class="form-group">
          <label for="newRole">Role</label>
          <select id="newRole">
            <option value="user" selected>User</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>
      <div class="auth-error hidden" id="createUserError"></div>
      <button class="btn btn-primary btn-full" id="doCreateBtn">Create Account →</button>
    </div>
  `;

  document.getElementById('doCreateBtn').addEventListener('click', _submitCreateUser);
}

async function _submitCreateUser() {
  const fn      = document.getElementById('newFirst');
  const ln      = document.getElementById('newLast');
  const emailEl = document.getElementById('newEmail');
  const passEl  = document.getElementById('newPassword');
  const errorEl = document.getElementById('createUserError');
  const btn     = document.getElementById('doCreateBtn');

  const firstName = fn.value.trim();
  const lastName  = ln.value.trim();
  const email     = emailEl.value.trim();
  const password  = passEl.value.trim();

  fn.classList.toggle('error', !firstName);
  ln.classList.toggle('error', !lastName);
  emailEl.classList.toggle('error', !email);
  passEl.classList.toggle('error', password.length < 6);
  if (!firstName || !lastName || !email || password.length < 6) return;

  errorEl.classList.add('hidden');
  btn.textContent = 'Creating…';
  btn.disabled    = true;

  try {
    const secAuth     = getSecondaryAuth();
    const { user }    = await createUserWithEmailAndPassword(secAuth, email, password);
    const rating      = parseFloat(document.getElementById('newRating').value) || 3.0;
    const role        = document.getElementById('newRole').value;

    await setDoc(doc(db, 'players', user.uid), {
      firstName, lastName, email, rating, role,
      wins: 0, losses: 0,
      status: 'active',
      waiverSigned: false,
      createdAt: serverTimestamp(),
    });

    // Sign out of the secondary session so it doesn't linger
    await signOut(secAuth);

    const tempPass = password;
    const content  = document.getElementById('adminContent');
    if (content) {
      content.innerHTML = `
        <div class="admin-created-card">
          <p class="admin-created-title">✓ Account Created</p>
          <div class="admin-created-row"><strong>Name</strong><span>${firstName} ${lastName}</span></div>
          <div class="admin-created-row"><strong>Email</strong><span>${email}</span></div>
          <div class="admin-created-row"><strong>Temp Password</strong><span class="mono">${tempPass}</span></div>
          <p class="admin-created-hint">Share these credentials with the user. They should change their password after first sign-in.</p>
        </div>
        <button class="btn btn-secondary" id="createAnotherBtn" style="width:100%;margin-top:12px">Create Another Account</button>
      `;
      document.getElementById('createAnotherBtn').addEventListener('click', _renderCreateForm);
    }
    showToast(`Account created for ${firstName} ${lastName}.`);
  } catch (err) {
    console.error('Create user failed:', err);
    btn.textContent = 'Create Account →';
    btn.disabled    = false;
    errorEl.textContent = err.code === 'auth/email-already-in-use'
      ? 'An account with this email already exists.'
      : `Error: ${err.message}`;
    errorEl.classList.remove('hidden');
  }
}
