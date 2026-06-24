import { db, getDocs, collection, query, where } from './firebase.js';

export async function fetchCourtConquest(players, deptMap) {
  const now        = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  try {
    const snap = await getDocs(query(collection(db, 'matches'), where('won', '==', true)));
    const wins = snap.docs
      .map(d => d.data())
      .filter(m => {
        const ts = m.recordedAt?.toDate?.();
        return ts && ts >= startMonth;
      });

    // uid → deptId lookup
    const uidDept = {};
    players.forEach(p => { if (p.department) uidDept[p.uid] = p.department; });

    // court → deptId → count
    const counts = { 1: {}, 2: {} };
    wins.forEach(m => {
      const deptId = uidDept[m.uid];
      if (!deptId || (m.court !== 1 && m.court !== 2)) return;
      counts[m.court][deptId] = (counts[m.court][deptId] || 0) + 1;
    });

    const result = {};
    [1, 2].forEach(n => {
      const entries = Object.entries(counts[n]).sort((a, b) => b[1] - a[1]);
      if (!entries.length) { result[n] = null; return; }
      const tied = entries.length > 1 && entries[0][1] === entries[1][1];
      if (tied) {
        result[n] = { tied: true, captures: entries[0][1] };
      } else {
        const [id, captures] = entries[0];
        const dept = deptMap.get(id);
        result[n] = { deptId: id, name: dept?.name || id, icon: dept?.icon || '🏢', captures };
      }
    });
    return result;
  } catch (err) {
    console.warn('Court conquest failed:', err);
    return { 1: null, 2: null };
  }
}
