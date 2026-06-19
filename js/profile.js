import { db, doc, getDoc, setDoc, auth, signOut } from './firebase.js';
import { state } from './state.js';
import { BADGES, WAIVER_BODY_HTML } from './constants.js';
import { getInitials, resizeImage } from './utils.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { getDeptById, openDeptModal } from './departments.js';

const PROFILE_KEY = 'ss_profile_v2';

export function getCachedProfile() {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)); } catch { return null; }
}

export function setCachedProfile(p) {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch {}
}

export function getInitialsForProfile(p) {
  return getInitials(p.firstName, p.lastName);
}

export function applyProfileToHeader(profile) {
  const avatar = document.getElementById('userAvatar');
  if (profile.photoUrl) {
    avatar.innerHTML = `<img src="${profile.photoUrl}" alt="" />`;
  } else {
    avatar.innerHTML = getInitials(profile.firstName, profile.lastName);
  }
  document.getElementById('userNameLabel').textContent = `${profile.firstName} ${profile.lastName}`;
}

export async function loadFirestoreProfile(uid) {
  const snap = await getDoc(doc(db, 'players', uid));
  if (!snap.exists()) return null;
  const p = snap.data();
  setCachedProfile(p);
  return p;
}

export async function saveFirestoreProfile(uid, profile) {
  await setDoc(doc(db, 'players', uid), profile, { merge: true });
  setCachedProfile(profile);
  state.currentProfile = profile;
}

export function requireWaiver(onSigned) {
  if (state.currentProfile?.waiverSigned) return true;
  openWaiverModal(onSigned);
  return false;
}

export function openWaiverModal(onSigned) {
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
        const updated = { ...state.currentProfile, waiverSigned: true };
        await saveFirestoreProfile(state.currentUser.uid, updated);
        closeModal();
        showToast('Waiver signed — you can now reserve courts.');
        if (typeof onSigned === 'function') setTimeout(onSigned, 300);
      }),
    ],
  });
}

export function openEditProfileModal() {
  const p = state.currentProfile;
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

      ${p.department ? `
      <div class="dept-profile-row">
        <span class="dept-profile-label">🏢 Department</span>
        <button class="dept-profile-link" id="openMyDept">
          ${getDeptById(p.department)?.name ?? p.department} →
        </button>
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
        await saveFirestoreProfile(state.currentUser.uid, updated);
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

  document.getElementById('openMyDept')?.addEventListener('click', () => {
    closeModal();
    openDeptModal(p.department);
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

export function wireProfilePill() {
  document.getElementById('userPill').addEventListener('click', () => openEditProfileModal());
}
