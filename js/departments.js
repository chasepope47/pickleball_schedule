import {
  db, collection, addDoc, doc, updateDoc, deleteDoc, getDocs, serverTimestamp, deleteField,
} from './firebase.js';
import { state } from './state.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import { getInitials, esc } from './utils.js';

// ── Cache ────────────────────────────────────────────────────────────────────

let _deptMap = new Map(); // deptId → { id, name, ... }
let _players = [];         // all player objects

export function getDeptById(deptId) {
  return _deptMap.get(deptId) || null;
}

async function _fetchAll() {
  const [deptsSnap, playersSnap] = await Promise.all([
    getDocs(collection(db, 'departments')),
    getDocs(collection(db, 'players')),
  ]);
  _deptMap = new Map(deptsSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }]));
  _players = playersSnap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

function _computeStandings() {
  const standings = new Map();
  _deptMap.forEach((dept, id) => {
    standings.set(id, { ...dept, wins: 0, losses: 0, members: [] });
  });
  _players.forEach(p => {
    if (p.department && standings.has(p.department)) {
      const s = standings.get(p.department);
      s.wins   += p.wins   || 0;
      s.losses += p.losses || 0;
      s.members.push(p);
    }
  });
  return [...standings.values()].sort((a, b) =>
    b.wins !== a.wins ? b.wins - a.wins : b.losses - a.losses
  );
}

// ── Main-page section ────────────────────────────────────────────────────────

export async function refreshDeptSection() {
  try {
    await _fetchAll();
    _renderSection();
  } catch (err) {
    console.warn('Dept section error:', err);
  }
}

function _renderSection() {
  const section = document.getElementById('deptSection');
  const list    = document.getElementById('deptStandings');
  if (!section || !list) return;

  const standings = _computeStandings();
  const myDept    = state.currentProfile?.department;
  const role      = state.currentProfile?.role;

  if (standings.length === 0) {
    if (role === 'system_admin' || role === 'admin' || role === 'manager') {
      section.style.display = '';
      list.innerHTML = `<p class="dept-empty">No departments yet — create them in the Admin Panel.</p>`;
    } else {
      section.style.display = 'none';
    }
    return;
  }

  section.style.display = '';
  const medals = ['🥇', '🥈', '🥉'];

  list.innerHTML = standings.map((dept, i) => {
    const isMe  = dept.id === myDept;
    const total = dept.wins + dept.losses;
    const pct   = total > 0 ? Math.round(dept.wins / total * 100) : null;
    const medal = i < 3 ? medals[i] : `#${i + 1}`;
    return `
      <div class="dept-row ${isMe ? 'dept-mine' : ''}" data-dept="${dept.id}" role="button" tabindex="0">
        <div class="dept-rank">${medal}</div>
        <div class="dept-info">
          <div class="dept-name">${dept.icon ? `${dept.icon} ` : ''}${esc(dept.name)}</div>
          <div class="dept-meta">${dept.members.length} member${dept.members.length !== 1 ? 's' : ''}</div>
        </div>
        <div class="dept-record">
          <span class="dept-wins">${dept.wins}W</span>
          <span class="dept-sep">·</span>
          <span class="dept-losses">${dept.losses}L</span>
          ${pct !== null ? `<span class="dept-pct">${pct}%</span>` : ''}
        </div>
      </div>`;
  }).join('');

  list.querySelectorAll('.dept-row').forEach(row => {
    const open = () => openDeptModal(row.dataset.dept);
    row.addEventListener('click', open);
    row.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') open(); });
  });
}

// ── Department detail modal ───────────────────────────────────────────────────

export function openDeptModal(deptId) {
  const dept = _deptMap.get(deptId);
  if (!dept) return;

  const members     = _players.filter(p => p.department === deptId)
                               .sort((a, b) => (b.wins || 0) - (a.wins || 0));
  const totalWins   = members.reduce((s, p) => s + (p.wins   || 0), 0);
  const totalLosses = members.reduce((s, p) => s + (p.losses || 0), 0);

  const memberHtml = members.length > 0
    ? members.map(p => {
        const avatar = p.photoUrl
          ? `<img src="${p.photoUrl}" alt="" />`
          : getInitials(p.firstName, p.lastName);
        const isMe = p.uid === state.currentUser?.uid;
        return `
          <div class="dept-member-row ${isMe ? 'dept-member-me' : ''}">
            <div class="dept-member-avatar ${p.photoUrl ? 'has-photo' : ''}">${avatar}</div>
            <div class="dept-member-info">
              <div class="dept-member-name">${esc(p.firstName)} ${esc(p.lastName)}${isMe ? ' <span class="dept-you-tag">you</span>' : ''}</div>
              <div class="dept-member-stats">★${p.rating || '—'} · ${p.wins || 0}W ${p.losses || 0}L</div>
            </div>
          </div>`;
      }).join('')
    : `<p style="color:var(--text-muted);font-size:.85rem;padding:8px 0">No members yet.</p>`;

  setModal({
    title:   `${dept.icon ? dept.icon + ' ' : ''}${dept.name}`,
    sub:     `${totalWins}W · ${totalLosses}L · ${members.length} member${members.length !== 1 ? 's' : ''}`,
    body:    `<div class="dept-modal-members">${memberHtml}</div>`,
    actions: [makeBtn('Close', 'btn-secondary', closeModal)],
  });
}

// ── Admin department tab ─────────────────────────────────────────────────────

export async function renderAdminDeptContent(container) {
  container.innerHTML =
    '<p style="text-align:center;color:var(--text-muted);padding:20px 0">Loading…</p>';
  try {
    await _fetchAll();
    _showDeptList(container);
  } catch (err) {
    console.error(err);
    container.innerHTML =
      '<p style="text-align:center;color:var(--red);padding:20px 0">Could not load departments.</p>';
  }
}

function _showDeptList(container) {
  const standings = _computeStandings();

  const rows = standings.map(dept => `
    <div class="dept-admin-row">
      <div class="dept-admin-info">
        <div class="dept-admin-name">${dept.icon ? `${dept.icon} ` : ''}${esc(dept.name)}</div>
        <div class="dept-admin-meta">
          ${dept.members.length} member${dept.members.length !== 1 ? 's' : ''} · ${dept.wins}W ${dept.losses}L
        </div>
      </div>
      <div class="dept-admin-actions">
        <button class="admin-btn" data-action="manage" data-dept-id="${dept.id}">Manage</button>
        <button class="admin-btn delete" data-action="delete" data-dept-id="${dept.id}">Delete</button>
      </div>
    </div>`).join('');

  container.innerHTML = `
    <div style="margin-bottom:12px">
      <div class="form-row" style="align-items:flex-end;gap:8px">
        <div class="form-group" style="width:60px;margin-bottom:0">
          <label for="newDeptIcon">Icon</label>
          <input type="text" id="newDeptIcon" placeholder="🏢" maxlength="2" style="text-align:center" />
        </div>
        <div class="form-group" style="flex:1;margin-bottom:0">
          <label for="newDeptName">New Department Name</label>
          <input type="text" id="newDeptName" placeholder="e.g. Engineering" maxlength="50" />
        </div>
        <button class="btn btn-primary" id="createDeptBtn" style="padding:10px 16px;white-space:nowrap">+ Create</button>
      </div>
    </div>
    <div class="dept-admin-list">
      ${standings.length === 0
        ? '<p style="text-align:center;color:var(--text-muted);padding:16px 0;font-size:.85rem">No departments yet. Create one above.</p>'
        : rows}
    </div>`;

  document.getElementById('createDeptBtn').addEventListener('click', async () => {
    const name = document.getElementById('newDeptName').value.trim();
    const icon = document.getElementById('newDeptIcon').value.trim() || '🏢';
    if (!name) return;
    try {
      await addDoc(collection(db, 'departments'), { name, icon, createdAt: serverTimestamp() });
      showToast(`Department "${name}" created.`);
      await renderAdminDeptContent(container);
    } catch (err) {
      console.error(err);
      showToast('Could not create department.', 'error');
    }
  });

  container.querySelectorAll('[data-action="manage"]').forEach(btn => {
    btn.addEventListener('click', () => _manageDept(btn.dataset.deptId, container));
  });

  container.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const dept    = _deptMap.get(btn.dataset.deptId);
      if (!dept) return;
      const members = _players.filter(p => p.department === dept.id);
      if (members.length > 0) {
        showToast(`Remove all members from "${dept.name}" before deleting.`, 'error');
        return;
      }
      if (!confirm(`Delete department "${dept.name}"?`)) return;
      try {
        await deleteDoc(doc(db, 'departments', dept.id));
        showToast(`"${dept.name}" deleted.`);
        await renderAdminDeptContent(container);
      } catch (err) {
        console.error(err);
        showToast('Could not delete department.', 'error');
      }
    });
  });
}

async function _manageDept(deptId, container) {
  const dept       = _deptMap.get(deptId);
  if (!dept) return;
  const members    = _players.filter(p => p.department === deptId);
  const nonMembers = _players.filter(p => p.department !== deptId);

  const memberRows = members.map(p => {
    const avatar = p.photoUrl
      ? `<img src="${p.photoUrl}" alt="" />`
      : getInitials(p.firstName, p.lastName);
    return `
      <div style="display:flex;align-items:center;gap:10px;padding:8px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;margin-bottom:4px">
        <div class="dept-member-avatar ${p.photoUrl ? 'has-photo' : ''}">${avatar}</div>
        <div style="flex:1;min-width:0">
          <div class="dept-member-name">${esc(p.firstName)} ${esc(p.lastName)}</div>
          <div class="dept-member-stats">★${p.rating || '—'} · ${p.wins || 0}W ${p.losses || 0}L</div>
        </div>
        <button class="admin-btn delete" data-action="remove-member" data-uid="${p.uid}">Remove</button>
      </div>`;
  }).join('');

  const addOptions = nonMembers
    .sort((a, b) => `${a.firstName}${a.lastName}`.localeCompare(`${b.firstName}${b.lastName}`))
    .map(p => `<option value="${p.uid}">${esc(p.firstName)} ${esc(p.lastName)}${p.department ? ' (⚠ reassigning)' : ''}</option>`)
    .join('');

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:14px">
      <button class="admin-btn" id="backToDepts">← Back</button>
      <span style="font-size:.9rem;font-weight:700;color:var(--text)">${esc(dept.name)}</span>
    </div>
    <div style="max-height:260px;overflow-y:auto">
      ${members.length === 0
        ? '<p style="text-align:center;color:var(--text-muted);font-size:.85rem;padding:12px 0">No members yet.</p>'
        : memberRows}
    </div>
    ${nonMembers.length > 0 ? `
    <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)">
      <label style="font-size:.8rem;font-weight:600;color:var(--text-dim);display:block;margin-bottom:6px">
        Add member to ${esc(dept.name)}
      </label>
      <div class="form-row" style="align-items:flex-end;gap:8px">
        <select id="addMemberSelect" style="flex:1">
          <option value="">— select player —</option>
          ${addOptions}
        </select>
        <button class="btn btn-primary" id="addMemberBtn" style="padding:10px 14px">Add</button>
      </div>
    </div>` : ''}`;

  document.getElementById('backToDepts').addEventListener('click', () =>
    renderAdminDeptContent(container));

  container.querySelectorAll('[data-action="remove-member"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await updateDoc(doc(db, 'players', btn.dataset.uid), { department: deleteField() });
        showToast('Member removed from department.');
        await _fetchAll();
        _manageDept(deptId, container);
      } catch (err) {
        console.error(err);
        showToast('Could not remove member.', 'error');
      }
    });
  });

  document.getElementById('addMemberBtn')?.addEventListener('click', async () => {
    const uid = document.getElementById('addMemberSelect').value;
    if (!uid) return;
    try {
      await updateDoc(doc(db, 'players', uid), { department: deptId });
      showToast('Member added!');
      await _fetchAll();
      _manageDept(deptId, container);
    } catch (err) {
      console.error(err);
      showToast('Could not add member.', 'error');
    }
  });
}
