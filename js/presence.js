import { db, doc, updateDoc, serverTimestamp } from './firebase.js';
import { state } from './state.js';

const HEARTBEAT_MS = 60_000;
const ONLINE_MS    = 2 * 60_000;

export function isOnline(player) {
  if (!player?.lastSeen) return false;
  const ts = player.lastSeen.toDate ? player.lastSeen.toDate() : new Date(player.lastSeen);
  return Date.now() - ts.getTime() < ONLINE_MS;
}

let _timer = null;

export function startPresence() {
  _beat();
  _timer = setInterval(_beat, HEARTBEAT_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) _beat(); });
}

export function stopPresence() {
  clearInterval(_timer);
  _timer = null;
}

async function _beat() {
  if (!state.currentUser) return;
  try {
    await updateDoc(doc(db, 'players', state.currentUser.uid), { lastSeen: serverTimestamp() });
  } catch { /* ignore */ }
}
