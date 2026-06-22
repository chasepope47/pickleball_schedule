import { db, getDocs, collection } from './firebase.js';
import { state } from './state.js';
import { BADGES } from './constants.js';
import { getInitials } from './utils.js';
import { setModal, closeModal, makeBtn } from './ui.js';

function _activeStreakFor(p) {
  if (!(p.streak > 0) || !p.lastPlayedDate) return 0;
  const [y, m, d] = p.lastPlayedDate.split('-').map(Number);
  const last  = new Date(y, m - 1, d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const gap   = Math.floor((today - last) / 864e5);
  return gap <= 3 ? p.streak : 0;
}

export async function openLeaderboard() {
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
      const isMe      = p.uid === state.currentUser?.uid;
      const medal     = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`;
      const avatar    = p.photoUrl
        ? `<img src="${p.photoUrl}" alt="" />`
        : getInitials(p.firstName, p.lastName);
      const badgePips = (p.badges || []).slice(0, 3).map(id => BADGES[id]?.icon || '').join('');
      const streak    = _activeStreakFor(p);
      return `
        <div class="leaderboard-row ${isMe ? 'me' : ''}">
          <span class="lb-rank">${medal}</span>
          <div class="lb-avatar ${p.photoUrl ? 'has-photo' : ''}">${avatar}</div>
          <div class="lb-info">
            <span class="lb-name">${p.firstName} ${p.lastName}${isMe ? ' (you)' : ''}${badgePips ? ` <span class="lb-badges">${badgePips}</span>` : ''}${streak > 0 ? ` <span title="${streak}-session streak" style="font-size:.85rem">🔥${streak}</span>` : ''}</span>
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

document.getElementById('leaderboardBtn').addEventListener('click', openLeaderboard);
