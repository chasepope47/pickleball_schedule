import { db, doc, updateDoc, getDocs, collection } from './firebase.js';
import { state } from './state.js';
import { BADGES } from './constants.js';
import { getHoliday } from './utils.js';
import { setCachedProfile, openEditProfileModal } from './profile.js';

export function showBadgeToast(badge) {
  const existing = document.getElementById('badgeToast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'badgeToast';
  t.innerHTML = `
    <span class="badge-toast-icon">${badge.icon}</span>
    <div class="badge-toast-text">
      <span class="badge-toast-label">Badge Unlocked!</span>
      <span class="badge-toast-name">${badge.name}</span>
    </div>
    <span class="badge-toast-hint">Tap to view your badges →</span>
  `;
  t.addEventListener('click', () => { t.remove(); openEditProfileModal(); });
  document.body.appendChild(t);
  setTimeout(() => { if (document.getElementById('badgeToast') === t) t.remove(); }, 7000);
}

export async function checkAndAwardBadges(matchData) {
  try {
    const earned = new Set(state.currentProfile.badges || []);
    const toAdd  = [];

    const holiday = getHoliday();
    if (holiday && !earned.has(holiday.id)) toAdd.push(holiday.id);

    if (!earned.has('earlyBird') && matchData.hour < 8)   toAdd.push('earlyBird');
    if (!earned.has('nightOwl')  && matchData.hour >= 20) toAdd.push('nightOwl');

    if (!earned.has('skunk') && matchData.type === 'competitive' && matchData.won) {
      if ((matchData.scores || []).some(s => s.mine === 11 && s.theirs === 0))
        toAdd.push('skunk');
    }

    // Save synchronous badges immediately — no async gap before this write
    if (toAdd.length > 0) {
      const allBadges = [...earned, ...toAdd];
      await updateDoc(doc(db, 'players', state.currentUser.uid), { badges: allBadges });
      state.currentProfile = { ...state.currentProfile, badges: allBadges };
      setCachedProfile(state.currentProfile);
      toAdd.forEach((id, i) => {
        const b = BADGES[id];
        if (b) setTimeout(() => showBadgeToast(b), 900 + i * 2200);
      });
    }

    // TopDog check runs after sync badges are already saved
    if (!new Set(state.currentProfile.badges || []).has('topDog') &&
        matchData.type === 'competitive' && matchData.won) {
      const snap     = await getDocs(collection(db, 'players'));
      const myWins   = (state.currentProfile.wins || 0) + 1;
      const topOther = snap.docs
        .filter(d => d.id !== state.currentUser.uid)
        .reduce((max, d) => Math.max(max, d.data().wins || 0), 0);
      if (myWins > topOther) {
        const latestEarned = new Set(state.currentProfile.badges || []);
        if (!latestEarned.has('topDog')) {
          const updated = [...latestEarned, 'topDog'];
          await updateDoc(doc(db, 'players', state.currentUser.uid), { badges: updated });
          state.currentProfile = { ...state.currentProfile, badges: updated };
          setCachedProfile(state.currentProfile);
          setTimeout(() => showBadgeToast(BADGES.topDog), 900);
        }
      }
    }
  } catch (err) {
    console.warn('Badge check failed:', err);
  }
}
