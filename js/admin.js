import { initializeApp, getApps } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, createUserWithEmailAndPassword } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  db, doc, setDoc, updateDoc, getDocs, deleteDoc, deleteField, collection, serverTimestamp,
  signOut, FIREBASE_CONFIG,
} from './firebase.js';
import { state } from './state.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { getInitials, ratingOptions } from './utils.js';
import { renderAdminDeptContent } from './departments.js';
import { createTournamentRecord, updateTournamentRecord, refreshTournamentSidebar } from './tournaments.js';
import { BADGES } from './constants.js';

// ── Secondary Firebase app (creates users without signing out the current user) ─

let _secondaryAuth = null;
function getSecondaryAuth() {
  if (_secondaryAuth) return _secondaryAuth;
  const existing = getApps().find(a => a.name === 'adminCreate');
  const app2 = existing ?? initializeApp(FIREBASE_CONFIG, 'adminCreate');
  _secondaryAuth = getAuth(app2);
  return _secondaryAuth;
}

// ── Role helpers ──────────────────────────────────────────────────────────────

export function isAdmin()   { return state.currentProfile?.role === 'admin';   }
export function isManager() { return state.currentProfile?.role === 'manager'; }

function canManageUsers() { return isAdmin() || isManager(); }

function canActOn(targetRole) {
  if (isAdmin()) return true;             
  return targetRole !== 'admin';          
}

// ── Admin button ──────────────────────────────────────────────────────────────

export function wireAdminBtn() {
  const btn = document.getElementById('adminBtn');
  if (!btn) return;
  btn.style.display = canManageUsers() ? 'flex' : 'none';
  btn.onclick = openAdminPanel;
}

// ── Panel shell ───────────────────────────────────────────────────────────────

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
      <button class="admin-tab"        data-view="departments">Departments</button>
      <button class="admin-tab"        data-view="tournaments">🏆 Tournaments</button>
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
    else if (_activeView === 'departments') renderAdminDeptContent(document.getElementById('adminContent'));
    else if (_activeView === 'tournaments') _renderTournamentsForm();
    else _renderCreateForm();
  });

  document.getElementById('modalActions').appendChild(makeBtn('Close', 'btn-secondary', closeModal));
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

    content.innerHTML =
      `<div class="admin-user-list">${players.map(_userRowHtml).join('')}</div>`;

    content.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const p = players.find(u => u.uid === btn.dataset.uid);
        if (!p) return;
        switch (btn.dataset.action) {
          case 'block':      return _confirmBlock(p, true);
          case 'unblock':    return _confirmBlock(p, false);
          case 'delete':     return _confirmDelete(p);
          case 'makeadmin':  return _confirmRole(p, 'admin');
          case 'makemgr':    return _confirmRole(p, 'manager');
          case 'setuser':    return _confirmRole(p, 'user');
          case 'edit-stats': return _openEditStatsModal(p);
        }
      });
    });
  } catch (err) {
    console.error('Admin load failed:', err);
    content.innerHTML =
      '<p style="text-align:center;color:var(--red);padding:20px 0">Could not load users.</p>';
  }
}

function _mkBtn(label, cls, action, uid) {
  return `<button class="admin-btn ${cls}" data-action="${action}" data-uid="${uid}">${label}</button>`;
}

function _userRowHtml(p) {
  const isMe       = p.uid === state.currentUser?.uid;
  const isBlocked  = p.status === 'blocked';
  const targetRole = p.role || 'user';
  const avatar     = p.photoUrl
    ? `<img src="${p.photoUrl}" alt="" />`
    : getInitials(p.firstName, p.lastName);

  const statusBadge = isBlocked
    ? `<span class="admin-badge blocked">Blocked</span>`
    : `<span class="admin-badge active">Active</span>`;

  const roleBadge = targetRole === 'admin'
    ? `<span class="admin-badge role-admin">Admin</span>`
    : targetRole === 'manager'
    ? `<span class="admin-badge role-manager">Manager</span>`
    : '';

  let actions;
  if (isMe) {
    actions = '<span class="admin-you">(you)</span>';
  } else if (!canActOn(targetRole)) {
    actions = '<span class="admin-protected">🔒</span>';
  } else {
    const editStatsBtn = _mkBtn('Edit Stats', 'edit-stats', 'edit-stats', p.uid);
    const blockBtn = isBlocked ? _mkBtn('Unblock', 'unblock', 'unblock', p.uid) : _mkBtn('Block', 'block', 'block', p.uid);

    let roleBtn = '';
    if (targetRole === 'admin') {
      roleBtn = _mkBtn('Revoke Admin', 'demote', 'setuser', p.uid);
    } else if (targetRole === 'manager') {
      roleBtn = _mkBtn('Revoke Manager', 'demote', 'setuser', p.uid);
      if (isAdmin()) roleBtn += _mkBtn('Make Admin', 'promote', 'makeadmin', p.uid);
    } else {
      roleBtn = _mkBtn('Make Manager', 'promote', 'makemgr', p.uid);
      if (isAdmin()) roleBtn += _mkBtn('Make Admin', 'promote', 'makeadmin', p.uid);
    }

    const deleteBtn = _mkBtn('Remove', 'delete', 'delete', p.uid);
    actions = editStatsBtn + blockBtn + roleBtn + deleteBtn;
  }

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

function _reopenWide() { openAdminPanel(); }

function _confirmBlock(player, blocking) {
  setModal({
    title: player ? (blocking ? 'Block User' : 'Unblock User') : '',
    sub:   player ? `${player.firstName} ${player.lastName}` : '',
    body: `<p style="font-size:.88rem;color:var(--text-dim)">
      ${blocking
        ? `<strong>${player.firstName}</strong> will be unable to access the app and signed out on their next visit.`
        : `<strong>${player.firstName}</strong> will regain full access to the app.`}
    </p>`,
    actions: [
      makeBtn('Cancel', 'btn-secondary', _reopenWide),
      makeBtn(
        blocking ? 'Block User' : 'Unblock User',
        blocking ? 'btn-danger'  : 'btn-primary',
        async () => {
          try {
            await updateDoc(doc(db, 'players', player.uid), { status: blocking ? 'blocked' : 'active' });
            showToast(`${player.firstName} ${blocking ? 'blocked' : 'unblocked'}.`);
            _reopenWide();
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
      </p>
      <p style="font-size:.8rem;color:var(--red)">This cannot be undone.</p>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', _reopenWide),
      makeBtn('Remove User', 'btn-danger', async () => {
        try {
          await deleteDoc(doc(db, 'players', player.uid));
          showToast(`${player.firstName} ${player.lastName} removed.`);
          _reopenWide();
        } catch (err) {
          console.error(err);
          showToast('Could not remove user.', 'error');
        }
      }),
    ],
  });
  document.querySelector('.modal').classList.add('modal-wide');
}

const ROLE_LABELS = { admin: 'Admin', manager: 'Manager', user: 'User' };

function _confirmRole(player, newRole) {
  const current = player.role || 'user';
  const isUpgrade = (newRole === 'admin') || (newRole === 'manager' && current === 'user');

  setModal({
    title: `Change Role → ${ROLE_LABELS[newRole]}`,
    sub:   `${player.firstName} ${player.lastName}`,
    body: `<p style="font-size:.88rem;color:var(--text-dim)">
      ${newRole === 'admin'
        ? `<strong>${player.firstName}</strong> will be able to manage all users including other managers and admins.`
        : newRole === 'manager'
        ? `<strong>${player.firstName}</strong> will be able to manage users and create accounts, but cannot act on admins.`
        : `<strong>${player.firstName}</strong> will be a regular user with no management access.`}
    </p>`,
    actions: [
      makeBtn('Cancel', 'btn-secondary', _reopenWide),
      makeBtn(`Set as ${ROLE_LABELS[newRole]}`, isUpgrade ? 'btn-primary' : 'btn-danger', async () => {
          try {
            await updateDoc(doc(db, 'players', player.uid), { role: newRole });
            showToast(`${player.firstName} is now ${ROLE_LABELS[newRole]}.`);
            _reopenWide();
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

// ── Edit Stats Modal ──────────────────────────────────────────────────────────

function _openEditStatsModal(player) {
  const badgeHtml = Object.entries(BADGES).map(([id, b]) => `
    <label style="display:flex; align-items:center; gap:8px; margin-bottom:6px; cursor:pointer;">
      <input type="checkbox" class="admin-badge-cb" value="${id}" ${(player.badges || []).includes(id) ? 'checked' : ''} />
      <span>${b.icon} ${b.name}</span>
    </label>
  `).join('');

  setModal({
    title: 'Edit Player Stats',
    sub: `${player.firstName} ${player.lastName}`,
    body: `
      <div class="form-row">
        <div class="form-group">
          <label>Rating</label>
          <input type="number" id="adminEditRating" step="0.1" value="${player.rating || 3.0}" />
        </div>
        <div class="form-group">
          <label>Wins</label>
          <input type="number" id="adminEditWins" value="${player.wins || 0}" />
        </div>
        <div class="form-group">
          <label>Losses</label>
          <input type="number" id="adminEditLosses" value="${player.losses || 0}" />
        </div>
      </div>
      <div class="form-group" style="margin-top:12px">
        <label>Awarded Badges</label>
        <div style="background:var(--card); padding:10px; border:1px solid var(--border); border-radius:8px; max-height: 160px; overflow-y: auto;">
          ${badgeHtml || '<span style="font-size:0.8rem; color:var(--text-muted)">No badges configured.</span>'}
        </div>
      </div>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', _reopenWide),
      makeBtn('Save Stats', 'btn-primary', async () => {
         const newRating = parseFloat(document.getElementById('adminEditRating').value) || 3.0;
         const newWins   = parseInt(document.getElementById('adminEditWins').value) || 0;
         const newLosses = parseInt(document.getElementById('adminEditLosses').value) || 0;
         const newBadges = Array.from(document.querySelectorAll('.admin-badge-cb:checked')).map(cb => cb.value);

         try {
            await updateDoc(doc(db, 'players', player.uid), {
              rating: newRating,
              wins: newWins,
              losses: newLosses,
              badges: newBadges
            });
            showToast(`Stats updated for ${player.firstName}.`);
            _reopenWide(); 
         } catch (err) {
            console.error(err);
            showToast('Could not update stats.', 'error');
         }
      })
    ]
  });
  
  document.querySelector('.modal').classList.add('modal-wide');
}

// ── Create Account view ───────────────────────────────────────────────────────

function _roleOptions() {
  const opts = [
    `<option value="user">User</option>`,
    `<option value="manager">Manager</option>`,
  ];
  if (isAdmin()) opts.push(`<option value="admin">Admin</option>`);
  return opts.join('');
}

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
          <select id="newRole">${_roleOptions()}</select>
        </div>
      </div>
      <div class="auth-error hidden" id="createUserError"></div>
      <button class="btn btn-primary btn-full" id="doCreateBtn">Create Account →</button>
    </div>
  `;

  document.getElementById('doCreateBtn').addEventListener('click', _submitCreate);
}

async function _submitCreate() {
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

  const role = document.getElementById('newRole').value;
  if (role === 'admin' && !isAdmin()) {
    showToast('Only admins can create admin accounts.', 'error');
    return;
  }

  errorEl.classList.add('hidden');
  btn.textContent = 'Creating…';
  btn.disabled    = true;

  try {
    const secAuth  = getSecondaryAuth();
    const { user } = await createUserWithEmailAndPassword(secAuth, email, password);
    const rating   = parseFloat(document.getElementById('newRating').value) || 3.0;

    await setDoc(doc(db, 'players', user.uid), {
      firstName, lastName, email, rating, role,
      wins: 0, losses: 0,
      status: 'active',
      waiverSigned: false,
      mustChangePassword: true,
      createdAt: serverTimestamp(),
    });

    await signOut(secAuth); 

    const tempPass = password;
    const content  = document.getElementById('adminContent');
    if (content) {
      content.innerHTML = `
        <div class="admin-created-card">
          <p class="admin-created-title">✓ Account Created</p>
          <div class="admin-created-row"><strong>Name</strong><span>${firstName} ${lastName}</span></div>
          <div class="admin-created-row"><strong>Email</strong><span>${email}</span></div>
          <div class="admin-created-row"><strong>Role</strong><span>${ROLE_LABELS[role]}</span></div>
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

// ── Tournaments View ──────────────────────────────────────────────────────────

let _editingTournamentId = null;

async function _renderTournamentsForm() {
  const content = document.getElementById('adminContent');
  if (!content) return;
  content.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:20px 0">Loading…</p>';

  try {
    const [playerSnap, tourneySnap] = await Promise.all([
      getDocs(collection(db, 'players')),
      getDocs(collection(db, 'tournaments')),
    ]);
    const players = playerSnap.docs.map(d => ({ uid: d.id, ...d.data() })).filter(p => p.status !== 'blocked');

    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

    const upcoming = tourneySnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(t => t.date >= todayStr)
      .sort((a, b) => a.date.localeCompare(b.date));

    const fmtH = h => h === 0 ? '12AM' : h === 12 ? '12PM' : h > 12 ? `${h - 12}PM` : `${h}AM`;
    const fmtD = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
    const getCourts = t => Array.isArray(t.courts) ? t.courts : (t.court != null ? [t.court] : []);
    const courtsLabel = t => { const c = getCourts(t); return c.length > 1 ? `Courts ${c.join(' & ')}` : `Court ${c[0]}`; };
    const courtHoursSelect = (id, vals, sel) => vals.map(h => `<option value="${h}" ${h === sel ? 'selected' : ''}>${fmtH(h)}</option>`).join('');

    const upcomingHtml = upcoming.length === 0
      ? '<p style="font-size:.82rem;color:var(--text-muted);padding:10px 0">No upcoming tournaments.</p>'
      : upcoming.map(t => {
          const tCourts = getCourts(t);
          const existingUids = new Set((t.players || []).map(p => p.uid));

          if (_editingTournamentId === t.id) {
            const tEntryCount = (t.format || 'singles') === 'doubles'
              ? Math.floor((t.players || []).length / 2)
              : (t.players || []).length;
            let tAutoSize = 1;
            while (tAutoSize < tEntryCount) tAutoSize *= 2;
            const tCurrentExtra = t.bracketSize && t.bracketSize > tAutoSize
              ? Math.round(Math.log2(t.bracketSize / tAutoSize))
              : 0;
            return `
              <div style="background:var(--card);border:1px solid var(--cyan-border);border-radius:10px;padding:14px;margin-bottom:8px">
                <div style="font-size:.78rem;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--cyan);margin-bottom:12px">Edit Tournament</div>
                <div class="form-group">
                  <label>Tournament Name</label>
                  <input type="text" id="editTName" value="${t.name.replace(/"/g, '&quot;')}" />
                </div>
                <div class="form-group">
                  <label>Tournament Style</label>
                  <div style="display:flex;gap:20px;padding:6px 0">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                      <input type="radio" name="editType" value="elimination" ${(t.type || 'elimination') === 'elimination' ? 'checked' : ''}> Single Elimination
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                      <input type="radio" name="editType" value="round_robin" ${t.type === 'round_robin' ? 'checked' : ''}> Round Robin + Playoffs
                    </label>
                  </div>
                </div>
                <div class="form-group">
                  <label>Format</label>
                  <div style="display:flex;gap:20px;padding:6px 0">
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                      <input type="radio" name="editFormat" value="singles" ${(t.format || 'singles') === 'singles' ? 'checked' : ''}> Singles (1v1)
                    </label>
                    <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                      <input type="radio" name="editFormat" value="doubles" ${t.format === 'doubles' ? 'checked' : ''}> Doubles (2v2)
                    </label>
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Courts</label>
                    <div style="display:flex;gap:14px;padding:6px 0">
                      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                        <input type="checkbox" class="edit-court-cb" value="1" ${tCourts.includes(1) ? 'checked' : ''}> Court 1
                      </label>
                      <label style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:.85rem">
                        <input type="checkbox" class="edit-court-cb" value="2" ${tCourts.includes(2) ? 'checked' : ''}> Court 2
                      </label>
                    </div>
                  </div>
                  <div class="form-group">
                    <label>Date</label>
                    <input type="date" id="editTDate" value="${t.date}" min="${todayStr}" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>Start Hour</label>
                    <select id="editTStart">${courtHoursSelect('editTStart', [6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21], t.startHour)}</select>
                  </div>
                  <div class="form-group">
                    <label>End Hour</label>
                    <select id="editTEnd">${courtHoursSelect('editTEnd', [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22], t.endHour)}</select>
                  </div>
                </div>
                <div class="form-group">
                  <label>Roster</label>
                  <div style="background:var(--hover);padding:10px;border:1px solid var(--border);border-radius:8px;max-height:130px;overflow-y:auto">
                    ${players.map(p => `
                      <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">
                        <input type="checkbox" class="edit-player-cb" value="${p.uid}" data-name="${p.firstName} ${p.lastName}" ${existingUids.has(p.uid) ? 'checked' : ''} />
                        <span style="font-size:.85rem">${p.firstName} ${p.lastName}</span>
                      </label>`).join('')}
                  </div>
                </div>
                <div class="form-group" style="margin-top:8px">
                  <label>Extra Bracket Rounds</label>
                  <select id="editExtraRounds">
                    <option value="0" ${tCurrentExtra === 0 ? 'selected' : ''}>None — auto</option>
                    <option value="1" ${tCurrentExtra === 1 ? 'selected' : ''}>+1 Round</option>
                    <option value="2" ${tCurrentExtra === 2 ? 'selected' : ''}>+2 Rounds</option>
                    <option value="3" ${tCurrentExtra === 3 ? 'selected' : ''}>+3 Rounds</option>
                    <option value="4" ${tCurrentExtra === 4 ? 'selected' : ''}>+4 Rounds</option>
                    <option value="5" ${tCurrentExtra === 5 ? 'selected' : ''}>+5 Rounds</option>
                  </select>
                </div>
                <div style="display:flex;gap:8px;margin-top:12px">
                  <button class="btn btn-primary" id="saveEditBtn" data-id="${t.id}" style="flex:1">Save Changes</button>
                  <button class="btn btn-secondary" id="discardEditBtn">Discard</button>
                </div>
              </div>`;
          }

          const typeLabel = t.type === 'round_robin' ? 'Round Robin' : 'Elimination';
          return `
            <div class="dept-admin-row" style="flex-wrap:wrap;gap:6px">
              <div class="dept-admin-info">
                <div class="dept-admin-name">${t.name}</div>
                <div class="dept-admin-meta">${fmtD(t.date)} · ${courtsLabel(t)} · ${fmtH(t.startHour)}–${fmtH(t.endHour)} · ${typeLabel} · ${(t.players || []).length} players</div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="admin-btn promote" data-action="edit-tourney" data-id="${t.id}">Edit</button>
                <button class="admin-btn delete" data-action="cancel-tourney" data-id="${t.id}">Cancel</button>
              </div>
            </div>`;
        }).join('');

    content.innerHTML = `
      <div style="padding-top:8px">
        <div style="margin-bottom:18px">
          <div style="font-size:.78rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--text-dim);margin-bottom:8px">Upcoming Tournaments</div>
          <div class="dept-admin-list">${upcomingHtml}</div>
        </div>
        <div style="border-top:1px solid var(--border);padding-top:16px">
          <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:14px">
            Schedule a tournament for any future date. This automatically blocks the selected courts.
          </p>
          <div class="form-group">
            <label>Tournament Name</label>
            <input type="text" id="tName" placeholder="e.g., SafeStreets Summer Classic" />
          </div>
          <div class="form-group">
            <label>Tournament Style</label>
            <div style="display:flex;gap:20px;padding:6px 0">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="tType" value="elimination" checked> Single Elimination Bracket
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="tType" value="round_robin"> Round Robin + Playoffs
              </label>
            </div>
          </div>
          <div class="form-group">
            <label>Format</label>
            <div style="display:flex;gap:20px;padding:6px 0">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="tFormat" value="singles" checked> Singles (1v1)
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                <input type="radio" name="tFormat" value="doubles"> Doubles (2v2)
              </label>
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Courts</label>
              <div style="display:flex;gap:14px;padding:6px 0">
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" class="t-court-cb" value="1" checked> Court 1
                </label>
                <label style="display:flex;align-items:center;gap:6px;cursor:pointer">
                  <input type="checkbox" class="t-court-cb" value="2"> Court 2
                </label>
              </div>
            </div>
            <div class="form-group">
              <label>Date</label>
              <input type="date" id="tDate" min="${todayStr}" />
            </div>
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Start Hour</label>
              <select id="tStart">${[6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21].map(h => `<option value="${h}">${fmtH(h)}</option>`).join('')}</select>
            </div>
            <div class="form-group">
              <label>End Hour</label>
              <select id="tEnd">${[7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22].map(h => `<option value="${h}">${fmtH(h)}</option>`).join('')}</select>
            </div>
          </div>
          <div class="form-group">
            <label>Tournament Roster (Select Players)</label>
            <p style="font-size:.75rem;color:var(--text-muted);margin:0 0 6px">More players = more bracket rounds (4 teams → Semis, 8 → Quarters, 16 → Round of 16…)</p>
            <div style="background:var(--card);padding:10px;border:1px solid var(--border);border-radius:8px;max-height:150px;overflow-y:auto">
              ${players.map(p => `
                <label style="display:flex;align-items:center;gap:8px;margin-bottom:6px;cursor:pointer">
                  <input type="checkbox" class="t-player-cb" value="${p.uid}" data-name="${p.firstName} ${p.lastName}" />
                  <span>${p.firstName} ${p.lastName}</span>
                </label>`).join('')}
            </div>
          </div>
          <div class="form-group">
            <label>Extra Bracket Rounds</label>
            <p style="font-size:.75rem;color:var(--text-muted);margin:0 0 6px">Reserve TBD slots for players joining later. Use Edit to add them when they register.</p>
            <select id="tExtraRounds">
              <option value="0">None — auto based on player count</option>
              <option value="1">+1 Round (doubles the bracket slots)</option>
              <option value="2">+2 Rounds (4× the bracket slots)</option>
              <option value="3">+3 Rounds (8× the bracket slots)</option>
              <option value="4">+4 Rounds (16× the bracket slots)</option>
              <option value="5">+5 Rounds (32× the bracket slots)</option>
            </select>
          </div>
          <button class="btn btn-primary btn-full" id="doTournamentBtn" style="margin-top:12px">Lock Schedule</button>
        </div>
      </div>
    `;

    // ── Edit button ──
    content.querySelectorAll('[data-action="edit-tourney"]').forEach(btn => {
      btn.addEventListener('click', () => {
        _editingTournamentId = btn.dataset.id;
        _renderTournamentsForm();
      });
    });

    // ── Discard edit ──
    document.getElementById('discardEditBtn')?.addEventListener('click', () => {
      _editingTournamentId = null;
      _renderTournamentsForm();
    });

    // ── Save edit ──
    document.getElementById('saveEditBtn')?.addEventListener('click', async () => {
      const saveBtn = document.getElementById('saveEditBtn');
      const editId  = saveBtn.dataset.id;
      const t       = upcoming.find(x => x.id === editId);
      if (!t) return;

      const name        = document.getElementById('editTName').value.trim();
      const type        = document.querySelector('input[name="editType"]:checked')?.value || 'elimination';
      const dateStr     = document.getElementById('editTDate').value;
      const startHour   = parseInt(document.getElementById('editTStart').value);
      const endHour     = parseInt(document.getElementById('editTEnd').value);
      const courts      = Array.from(document.querySelectorAll('.edit-court-cb:checked')).map(cb => parseInt(cb.value));
      const format      = document.querySelector('input[name="editFormat"]:checked')?.value || 'singles';
      const extraRounds = parseInt(document.getElementById('editExtraRounds')?.value) || 0;
      const selected    = Array.from(document.querySelectorAll('.edit-player-cb:checked')).map(cb => ({ uid: cb.value, name: cb.dataset.name }));

      if (!name)               return showToast('Please provide a tournament name.', 'error');
      if (!dateStr)            return showToast('Please select a date.', 'error');
      if (courts.length === 0) return showToast('Please select at least one court.', 'error');
      if (startHour >= endHour) return showToast('End time must be after start time.', 'error');
      if (selected.length === 0) return showToast('Please select at least one player.', 'error');
      if (format === 'doubles' && selected.length < 4)       return showToast('Doubles needs at least 4 players (2 teams).', 'error');
      if (format === 'doubles' && selected.length % 2 !== 0) return showToast('Doubles needs an even number of players.', 'error');

      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      try {
        const [y, m, d]   = dateStr.split('-').map(Number);
        const sel          = new Date(y, m - 1, d);
        const dow          = sel.getDay();
        const targetDayIdx = dow === 0 ? 6 : dow - 1;
        const mon          = new Date(sel);
        mon.setDate(sel.getDate() - targetDayIdx);
        const targetWeekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;

        const rosterPlayers = selected.map(s => {
          const full = players.find(p => p.uid === s.uid);
          return { uid: s.uid, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1] || '', rating: full?.rating ?? 3.0 };
        });

        await updateTournamentRecord(t, {
          name, type, courts, format, extraRounds, date: dateStr, dayIdx: targetDayIdx,
          weekKey: targetWeekKey, startHour, endHour, players: rosterPlayers,
        });

        showToast(`"${name}" updated.`);
        _editingTournamentId = null;
        refreshTournamentSidebar();
        _renderTournamentsForm();
      } catch (err) {
        console.error('Failed to save edit:', err);
        showToast(`Failed to save: ${err?.message || 'Check connection.'}`, 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    });

    // ── Cancel tournament ──
    content.querySelectorAll('[data-action="cancel-tourney"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const t = upcoming.find(x => x.id === btn.dataset.id);
        if (!t || !confirm(`Cancel "${t.name}"? This will unblock the reserved slots.`)) return;
        try {
          const tCourts = Array.isArray(t.courts) ? t.courts : (t.court != null ? [t.court] : []);
          const updates = {};
          for (const c of tCourts) {
            for (let h = t.startHour; h < t.endHour; h++) updates[`${c}_${t.dayIdx}_${h}`] = deleteField();
          }
          if (Object.keys(updates).length) await updateDoc(doc(db, 'reservations', t.weekKey), updates);
          await deleteDoc(doc(db, 'tournaments', t.id));
          showToast(`"${t.name}" cancelled.`);
          if (_editingTournamentId === t.id) _editingTournamentId = null;
          refreshTournamentSidebar();
          _renderTournamentsForm();
        } catch (err) {
          console.error(err);
          showToast('Could not cancel tournament.', 'error');
        }
      });
    });

    // ── Create tournament ──
    document.getElementById('doTournamentBtn').addEventListener('click', async () => {
      const name        = document.getElementById('tName').value.trim();
      const type        = document.querySelector('input[name="tType"]:checked')?.value || 'elimination';
      const dateStr     = document.getElementById('tDate').value;
      const startHour   = parseInt(document.getElementById('tStart').value);
      const endHour     = parseInt(document.getElementById('tEnd').value);
      const courts      = Array.from(document.querySelectorAll('.t-court-cb:checked')).map(cb => parseInt(cb.value));
      const format      = document.querySelector('input[name="tFormat"]:checked')?.value || 'singles';
      const extraRounds = parseInt(document.getElementById('tExtraRounds')?.value) || 0;
      const selected    = Array.from(document.querySelectorAll('.t-player-cb:checked')).map(cb => ({ uid: cb.value, name: cb.dataset.name }));

      if (!name)               return showToast('Please provide a tournament name.', 'error');
      if (!dateStr)            return showToast('Please select a date.', 'error');
      if (courts.length === 0) return showToast('Please select at least one court.', 'error');
      if (startHour >= endHour) return showToast('End time must be after start time.', 'error');
      if (selected.length === 0) return showToast('Please select at least one player.', 'error');
      if (format === 'doubles' && selected.length < 4)       return showToast('Doubles needs at least 4 players (2 teams).', 'error');
      if (format === 'doubles' && selected.length % 2 !== 0) return showToast('Doubles needs an even number of players.', 'error');

      const createBtn = document.getElementById('doTournamentBtn');
      createBtn.disabled = true;
      createBtn.textContent = 'Locking Schedule…';
      try {
        const [y, m, d]   = dateStr.split('-').map(Number);
        const sel          = new Date(y, m - 1, d);
        const dow          = sel.getDay();
        const targetDayIdx = dow === 0 ? 6 : dow - 1;
        const mon          = new Date(sel);
        mon.setDate(sel.getDate() - targetDayIdx);
        const targetWeekKey = `${mon.getFullYear()}-${String(mon.getMonth() + 1).padStart(2, '0')}-${String(mon.getDate()).padStart(2, '0')}`;

        const rosterPlayers = selected.map(s => {
          const full = players.find(p => p.uid === s.uid);
          return { uid: s.uid, firstName: s.name.split(' ')[0], lastName: s.name.split(' ')[1] || '', rating: full?.rating ?? 3.0 };
        });

        await createTournamentRecord({
          name, type, courts, format, extraRounds, date: dateStr, dayIdx: targetDayIdx,
          weekKey: targetWeekKey, startHour, endHour, players: rosterPlayers,
        });

        showToast(`Schedule locked for "${name}" on ${dateStr}.`);
        refreshTournamentSidebar();
        _renderTournamentsForm();
      } catch (err) {
        console.error('Failed to lock schedule:', err);
        const detail = err?.code === 'permission-denied'
          ? 'Permission denied — check Firestore rules.'
          : (err?.message || 'Check connection.');
        showToast(`Failed to lock schedule: ${detail}`, 'error');
        createBtn.disabled = false;
        createBtn.textContent = 'Lock Schedule';
      }
    });

  } catch (err) {
    console.error(err);
    content.innerHTML = '<p style="text-align:center;color:var(--red);padding:20px 0">Could not load tournament data.</p>';
  }
}