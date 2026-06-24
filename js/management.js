import { db, collection, getDocs, query, where } from './firebase.js';
import { state } from './state.js';
import { getInitials } from './utils.js';

const ROLE_LABEL = { admin: 'Admin', manager: 'Manager' };
const ROLE_COLOR = { admin: 'var(--cyan)', manager: 'var(--orange, #ff9800)' };

export async function initManagementSection() {
  const section = document.getElementById('managementSection');
  if (!section) return;

  try {
    const snap = await getDocs(
      query(collection(db, 'players'), where('role', 'in', ['admin', 'manager']))
    );
    const staff = snap.docs
      .map(d => ({ uid: d.id, ...d.data() }))
      .filter(p => p.status !== 'blocked')
      .sort((a, b) => {
        if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
        return (a.firstName || '').localeCompare(b.firstName || '');
      });

    if (staff.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    section.innerHTML = `
      <div class="mgmt-header">
        <h3 class="mgmt-title">👔 Management</h3>
      </div>
      <div class="mgmt-list">
        ${staff.map(p => {
          const initials = getInitials(p.firstName, p.lastName);
          const isMe = p.uid === state.currentUser?.uid;
          return `
            <div class="mgmt-row${isMe ? ' mgmt-me' : ''}">
              <div class="mgmt-avatar" style="background:${ROLE_COLOR[p.role] || 'var(--cyan)'}22;color:${ROLE_COLOR[p.role] || 'var(--cyan)'}">
                ${p.photoUrl
                  ? `<img src="${p.photoUrl}" alt="" />`
                  : initials}
              </div>
              <div class="mgmt-info">
                <div class="mgmt-name">${p.firstName} ${p.lastName}${isMe ? ' <span class="mgmt-you">(you)</span>' : ''}</div>
                <div class="mgmt-role" style="color:${ROLE_COLOR[p.role] || 'var(--cyan)'}">
                  ${ROLE_LABEL[p.role] || p.role}
                </div>
              </div>
            </div>`;
        }).join('')}
      </div>
    `;
  } catch (err) {
    console.warn('Management section error:', err);
    section.style.display = 'none';
  }
}
