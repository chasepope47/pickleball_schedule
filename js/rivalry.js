import {
  db, doc, getDoc, setDoc, deleteDoc, getDocs, addDoc,
  updateDoc, collection, query, where, serverTimestamp,
} from './firebase.js';
import { state } from './state.js';
import { esc } from './utils.js';
import { showToast, makeBtn } from './ui.js';

// ── Firestore helpers ─────────────────────────────────────────────────────────

export async function loadActiveRivalry() {
  try {
    const snap = await getDoc(doc(db, 'rivalries', 'active'));
    return snap.exists() ? snap.data() : null;
  } catch { return null; }
}

export async function computeRivalryScore(rivalry, players) {
  if (!rivalry) return { dept1Wins: 0, dept2Wins: 0 };

  const dept1Uids = new Set(players.filter(p => p.department === rivalry.dept1Id).map(p => p.uid));
  const dept2Uids = new Set(players.filter(p => p.department === rivalry.dept2Id).map(p => p.uid));

  try {
    const snap = await getDocs(query(collection(db, 'matches'), where('won', '==', true)));
    const start = rivalry.startDate?.toDate?.() ?? new Date(rivalry.startDate);
    const end   = rivalry.endDate?.toDate?.()   ?? new Date(rivalry.endDate);

    let dept1Wins = 0, dept2Wins = 0;
    snap.docs.forEach(d => {
      const m = d.data();
      if (m.type !== 'competitive') return;
      const ts = m.recordedAt?.toDate?.();
      if (!ts || ts < start || ts > end) return;
      if (dept1Uids.has(m.uid)) dept1Wins++;
      else if (dept2Uids.has(m.uid)) dept2Wins++;
    });
    return { dept1Wins, dept2Wins };
  } catch { return { dept1Wins: 0, dept2Wins: 0 }; }
}

export async function createRivalry(data) {
  await setDoc(doc(db, 'rivalries', 'active'), {
    ...data,
    createdBy: state.currentUser.uid,
    createdAt: serverTimestamp(),
  });
}

export async function endRivalry(rivalry, score, deptMap) {
  const { dept1Wins, dept2Wins } = score;
  const winnerId = dept1Wins > dept2Wins ? rivalry.dept1Id
    : dept2Wins > dept1Wins ? rivalry.dept2Id : null;

  // Save to history
  await addDoc(collection(db, 'rivalries'), {
    ...rivalry,
    dept1Wins, dept2Wins, winnerId,
    completedAt: serverTimestamp(),
  });

  // Award permanent banner to winning department
  if (winnerId) {
    const loserId   = winnerId === rivalry.dept1Id ? rivalry.dept2Id : rivalry.dept1Id;
    const loserDept = deptMap.get(loserId);
    const winnerDept = deptMap.get(winnerId);
    const prev = winnerDept?.rivalryBanners || [];
    await updateDoc(doc(db, 'departments', winnerId), {
      rivalryBanners: [...prev, {
        title:   rivalry.title || 'Rivalry Week',
        against: loserDept?.name || 'Rival',
        date:    new Date().toISOString(),
      }],
    });
  }

  await deleteDoc(doc(db, 'rivalries', 'active'));
}

// ── Admin UI ──────────────────────────────────────────────────────────────────

export async function renderRivalryAdminContent(container) {
  container.innerHTML =
    '<p style="text-align:center;color:var(--text-muted);padding:20px 0">Loading…</p>';

  try {
    const [deptSnap, rivalry] = await Promise.all([
      getDocs(collection(db, 'departments')),
      loadActiveRivalry(),
    ]);
    const depts   = deptSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const deptMap = new Map(depts.map(d => [d.id, d]));

    if (rivalry) {
      await _renderActive(container, rivalry, deptMap);
    } else {
      _renderCreate(container, depts, deptMap);
    }
  } catch (err) {
    console.error(err);
    container.innerHTML =
      '<p style="text-align:center;color:var(--red);padding:20px 0">Could not load rivalry data.</p>';
  }
}

async function _renderActive(container, rivalry, deptMap) {
  const players  = (await getDocs(collection(db, 'players'))).docs.map(d => ({ uid: d.id, ...d.data() }));
  const score    = await computeRivalryScore(rivalry, players);
  const d1       = deptMap.get(rivalry.dept1Id);
  const d2       = deptMap.get(rivalry.dept2Id);
  const end      = rivalry.endDate?.toDate?.() ?? new Date(rivalry.endDate);
  const daysLeft = Math.max(0, Math.ceil((end - Date.now()) / 864e5));
  const isOver   = daysLeft === 0;

  container.innerHTML = `
    <div class="rivalry-admin-active">
      <div class="rivalry-admin-badge">⚔️ ACTIVE RIVALRY</div>
      <div class="rivalry-admin-title">${esc(rivalry.title || 'Rivalry Week')}</div>
      <div class="rivalry-admin-dates">
        ${_fmtDate(rivalry.startDate)} → ${_fmtDate(rivalry.endDate)}
        <span class="rivalry-admin-days ${isOver ? 'over' : ''}">${isOver ? 'Ended' : `${daysLeft}d remaining`}</span>
      </div>
      <div class="rivalry-admin-scoreboard">
        <div class="ras-team ${score.dept1Wins > score.dept2Wins ? 'leading' : ''}">
          <span class="ras-icon">${d1?.icon || '🏢'}</span>
          <span class="ras-name">${esc(d1?.name || rivalry.dept1Name)}</span>
          <span class="ras-score">${score.dept1Wins}</span>
        </div>
        <span class="ras-vs">vs</span>
        <div class="ras-team ${score.dept2Wins > score.dept1Wins ? 'leading' : ''}">
          <span class="ras-score">${score.dept2Wins}</span>
          <span class="ras-name">${esc(d2?.name || rivalry.dept2Name)}</span>
          <span class="ras-icon">${d2?.icon || '🏢'}</span>
        </div>
      </div>
      ${isOver ? `<p class="rivalry-admin-hint">Rivalry has ended — declare a winner to award the banner.</p>` : ''}
    </div>
    <div class="rivalry-admin-actions" id="rivalryAdminActions"></div>
  `;

  const actions = container.querySelector('#rivalryAdminActions');

  if (isOver) {
    const resolveBtn = makeBtn('Declare Winner & Award Banner', 'btn-primary', async () => {
      resolveBtn.disabled = true;
      resolveBtn.textContent = 'Resolving…';
      try {
        await endRivalry(rivalry, score, deptMap);
        showToast('Rivalry resolved! Winner banner awarded 🏆');
        await renderRivalryAdminContent(container);
      } catch (err) {
        console.error(err);
        showToast('Could not resolve rivalry.', 'error');
        resolveBtn.disabled = false;
        resolveBtn.textContent = 'Declare Winner & Award Banner';
      }
    });
    actions.appendChild(resolveBtn);
  }

  const cancelBtn = makeBtn('Cancel Rivalry', 'btn-secondary', async () => {
    if (!confirm('Cancel this rivalry? No banner will be awarded.')) return;
    try {
      await deleteDoc(doc(db, 'rivalries', 'active'));
      showToast('Rivalry cancelled.');
      await renderRivalryAdminContent(container);
    } catch { showToast('Could not cancel rivalry.', 'error'); }
  });
  actions.appendChild(cancelBtn);
}

function _renderCreate(container, depts, deptMap) {
  const opts = depts.map(d => `<option value="${d.id}">${d.icon ? d.icon + ' ' : ''}${esc(d.name)}</option>`).join('');

  const today  = new Date();
  const nextWk = new Date(today.getTime() + 7 * 864e5);
  const fmt    = d => d.toISOString().split('T')[0];

  container.innerHTML = `
    <div class="rivalry-create-form">
      <p class="rivalry-create-intro">Set up a Rivalry Week between two departments. The department that earns the most competitive wins during the period gets a permanent banner 🏆</p>
      <div class="form-group">
        <label for="rivalryTitle">Event Title</label>
        <input type="text" id="rivalryTitle" value="Rivalry Week" maxlength="40" />
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label for="rivalryDept1">Department 1</label>
          <select id="rivalryDept1">${opts}</select>
        </div>
        <div class="form-group" style="flex:1">
          <label for="rivalryDept2">Department 2</label>
          <select id="rivalryDept2">${opts}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group" style="flex:1">
          <label for="rivalryStart">Start Date</label>
          <input type="date" id="rivalryStart" value="${fmt(today)}" />
        </div>
        <div class="form-group" style="flex:1">
          <label for="rivalryEnd">End Date</label>
          <input type="date" id="rivalryEnd" value="${fmt(nextWk)}" />
        </div>
      </div>
      <div id="rivalryCreateError" class="auth-error hidden"></div>
    </div>
    <div style="margin-top:14px">
      <button class="btn btn-primary" id="rivalryCreateBtn" style="width:100%">⚔️ Launch Rivalry</button>
    </div>
  `;

  document.getElementById('rivalryCreateBtn').addEventListener('click', async () => {
    const title  = document.getElementById('rivalryTitle').value.trim() || 'Rivalry Week';
    const d1Id   = document.getElementById('rivalryDept1').value;
    const d2Id   = document.getElementById('rivalryDept2').value;
    const start  = document.getElementById('rivalryStart').value;
    const end    = document.getElementById('rivalryEnd').value;
    const errEl  = document.getElementById('rivalryCreateError');

    errEl.classList.add('hidden');
    if (d1Id === d2Id) {
      errEl.textContent = 'Please select two different departments.';
      errEl.classList.remove('hidden');
      return;
    }
    if (!start || !end || start >= end) {
      errEl.textContent = 'End date must be after start date.';
      errEl.classList.remove('hidden');
      return;
    }

    const d1 = deptMap.get(d1Id);
    const d2 = deptMap.get(d2Id);

    try {
      document.getElementById('rivalryCreateBtn').disabled = true;
      await createRivalry({
        title,
        dept1Id:   d1Id, dept1Name: d1?.name || d1Id, dept1Icon: d1?.icon || '🏢',
        dept2Id:   d2Id, dept2Name: d2?.name || d2Id, dept2Icon: d2?.icon || '🏢',
        startDate: new Date(start),
        endDate:   new Date(end + 'T23:59:59'),
      });
      showToast(`⚔️ "${title}" rivalry launched!`);
      await renderRivalryAdminContent(container);
    } catch (err) {
      console.error(err);
      showToast('Could not create rivalry.', 'error');
      document.getElementById('rivalryCreateBtn').disabled = false;
    }
  });
}

function _fmtDate(val) {
  if (!val) return '—';
  const d = val?.toDate?.() ?? new Date(val);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
