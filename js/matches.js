import {
  db, doc, addDoc, updateDoc, collection, serverTimestamp, increment, deleteField,
} from './firebase.js';
import { state } from './state.js';
import { DAY_NAMES, WEEK_KEY } from './constants.js';
import { dayDate, fmtHour, getInitials, adjustRating } from './utils.js';
import { setModal, closeModal, makeBtn, showToast } from './ui.js';
import {
  setCachedProfile, loadFirestoreProfile, applyProfileToHeader,
} from './profile.js';
import { checkAndAwardBadges } from './badges.js';
import { render, getRes, normalizeRes } from './schedule.js';

// ── Match Log Modal ──────────────────────────────────────────────────────────

export function openMatchLogModal(court, dayIdx, hour) {
  const dateStr      = dayDate(dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let matchType      = 'friendly';
  let matchResult    = null;
  let numGames       = 3;
  const slotPlayers  = normalizeRes(getRes(court, dayIdx, hour));
  const otherPlayers = slotPlayers.filter(p => p.uid !== state.currentUser?.uid);

  setModal({
    title: 'Log Match Result',
    sub:   `Court ${court} · ${DAY_NAMES[dayIdx]}, ${dateStr} · ${fmtHour(hour)}`,
    body: `
      <p style="font-size:.85rem;color:var(--text-dim);margin-bottom:14px">
        Record this session. Competitive results update your W/L record and rating.
      </p>
      <div class="match-type-row">
        <button class="match-type-btn active" id="mtFriendly">🤝 Friendly</button>
        <button class="match-type-btn"        id="mtCompetitive">🏆 Competitive</button>
      </div>
      <div id="competitiveFields" style="display:none">
        <div class="form-group">
          <label for="gamesPlayed">Games Played</label>
          <select id="gamesPlayed">
            <option value="1">1 game</option>
            <option value="2">2 games</option>
            <option value="3" selected>3 games</option>
            <option value="4">4 games</option>
            <option value="5">5 games</option>
          </select>
        </div>
        <div id="scoreFields"></div>
        <div class="form-group" style="margin-top:6px">
          <label>Your Result</label>
          <div class="result-row">
            <button class="result-btn win"  id="resultWin">✓ Win</button>
            <button class="result-btn loss" id="resultLoss">✗ Loss</button>
          </div>
        </div>
      </div>
      ${otherPlayers.length > 0 ? `
      <div class="form-group" style="margin-top:14px">
        <label>Rate your opponents / teammates</label>
        <div class="player-rate-list" id="playerRateList">
          ${otherPlayers.map(p => `
            <div class="player-rate-row">
              <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
              <span class="p-rate-name">${p.firstName} ${p.lastName[0]}.</span>
              <div class="thumb-btns">
                <button class="thumb-btn up" data-uid="${p.uid}" data-thumb="up" type="button">👍</button>
                <button class="thumb-btn dn" data-uid="${p.uid}" data-thumb="down" type="button">👎</button>
              </div>
            </div>
          `).join('')}
        </div>
      </div>` : ''}
      <div class="form-group" style="margin-top:10px">
        <label for="matchComment">Match Notes <span class="label-hint">(optional)</span></label>
        <textarea id="matchComment" class="match-comment" placeholder="How did the game go?..." rows="2"></textarea>
      </div>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Record Match', 'btn-primary', async () => {
        if (matchType === 'competitive' && !matchResult) {
          showToast('Please select Win or Loss.', 'error');
          return;
        }

        const scores = [];
        if (matchType === 'competitive') {
          for (let i = 1; i <= numGames; i++) {
            const a = parseInt(document.getElementById(`sg${i}a`)?.value || '0');
            const b = parseInt(document.getElementById(`sg${i}b`)?.value || '0');
            scores.push({ mine: a, theirs: b });
          }
        }

        const playerRatings = {};
        document.querySelectorAll('#playerRateList .thumb-btn.active').forEach(btn => {
          playerRatings[btn.dataset.uid] = btn.dataset.thumb;
        });
        const comment = document.getElementById('matchComment')?.value.trim() || '';

        try {
          const slotKey   = `${court}_${dayIdx}_${hour}`;
          const matchData = {
            uid: state.currentUser.uid,
            slotKey,
            weekKey: WEEK_KEY,
            court, dayIdx, hour,
            type: matchType,
            players: slotPlayers,
            ...(Object.keys(playerRatings).length ? { playerRatings } : {}),
            ...(comment ? { comment } : {}),
            ...(matchType === 'competitive' ? {
              gamesPlayed: numGames, scores, won: matchResult === 'win',
            } : {}),
            recordedAt: serverTimestamp(),
          };
          const matchRef = await addDoc(collection(db, 'matches'), matchData);
          state.matchCache.set(slotKey, { id: matchRef.id, ...matchData });
          checkAndAwardBadges(matchData); // fire-and-forget

          if (matchType === 'competitive') {
            const won       = matchResult === 'win';
            const field     = won ? 'wins' : 'losses';
            const newRating = adjustRating(state.currentProfile.rating, won);
            await updateDoc(doc(db, 'players', state.currentUser.uid), {
              [field]: increment(1),
              rating: newRating,
            });
            state.currentProfile = {
              ...state.currentProfile,
              [field]: (state.currentProfile[field] || 0) + 1,
              rating: newRating,
            };
            setCachedProfile(state.currentProfile);
            closeModal();
            showToast(`${won ? 'Win' : 'Loss'} recorded! Rating → ${newRating}`);
          } else {
            closeModal();
            showToast('Friendly match recorded!');
          }
          render();
        } catch (err) {
          console.error('Match log failed:', err);
          showToast('Could not save match — please try again.', 'error');
        }
      }),
    ],
  });

  document.querySelectorAll('#playerRateList .thumb-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const uid = btn.dataset.uid;
      document.querySelectorAll(`#playerRateList .thumb-btn[data-uid="${uid}"]`)
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  function setType(type) {
    matchType = type;
    document.getElementById('mtFriendly').classList.toggle('active', type === 'friendly');
    document.getElementById('mtCompetitive').classList.toggle('active', type === 'competitive');
    document.getElementById('competitiveFields').style.display = type === 'competitive' ? 'block' : 'none';
    if (type === 'competitive') buildScoreFields();
  }

  function buildScoreFields() {
    numGames = parseInt(document.getElementById('gamesPlayed').value);
    const el = document.getElementById('scoreFields');
    el.innerHTML = '';
    for (let i = 1; i <= numGames; i++) {
      el.innerHTML += `
        <div class="score-row">
          <span class="score-label">Game ${i}</span>
          <input type="number" class="score-input" id="sg${i}a" min="0" max="99" placeholder="Yours" />
          <span class="score-dash">–</span>
          <input type="number" class="score-input" id="sg${i}b" min="0" max="99" placeholder="Theirs" />
        </div>
      `;
    }
  }

  document.getElementById('mtFriendly').addEventListener('click', () => setType('friendly'));
  document.getElementById('mtCompetitive').addEventListener('click', () => setType('competitive'));
  document.getElementById('gamesPlayed').addEventListener('change', buildScoreFields);

  document.getElementById('resultWin').addEventListener('click', () => {
    matchResult = 'win';
    document.getElementById('resultWin').classList.add('active');
    document.getElementById('resultLoss').classList.remove('active');
  });

  document.getElementById('resultLoss').addEventListener('click', () => {
    matchResult = 'loss';
    document.getElementById('resultLoss').classList.add('active');
    document.getElementById('resultWin').classList.remove('active');
  });
}

// ── Match Detail / Edit Modal ────────────────────────────────────────────────

export function openMatchDetailModal(match) {
  const dateStr   = dayDate(match.dayIdx).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  let matchType   = match.type;
  let matchResult = match.type === 'competitive' ? (match.won ? 'win' : 'loss') : null;
  let numGames    = match.gamesPlayed || (match.scores || []).length || 3;

  const initScores = Array.from({ length: numGames }, (_, i) => {
    const s = (match.scores || [])[i] || {};
    return `
      <div class="score-row">
        <span class="score-label">Game ${i + 1}</span>
        <input type="number" class="score-input" id="esg${i + 1}a" min="0" max="99" value="${s.mine ?? ''}" placeholder="Yours" />
        <span class="score-dash">–</span>
        <input type="number" class="score-input" id="esg${i + 1}b" min="0" max="99" value="${s.theirs ?? ''}" placeholder="Theirs" />
      </div>`;
  }).join('');

  const ratedPlayers = (match.players || []).filter(p =>
    p.uid !== state.currentUser?.uid && match.playerRatings?.[p.uid]
  );
  const ratingsHtml = ratedPlayers.length
    ? `<div class="match-player-ratings" style="margin-top:12px">
        ${ratedPlayers.map(p => `
          <div class="match-rate-row">
            <div class="p-avatar">${getInitials(p.firstName, p.lastName)}</div>
            <span class="match-rate-name">${p.firstName} ${p.lastName[0]}.</span>
            <span class="rate-thumb">${match.playerRatings[p.uid] === 'up' ? '👍' : '👎'}</span>
          </div>`).join('')}
      </div>`
    : '';

  setModal({
    title: 'Edit Match',
    sub:   `Court ${match.court} · ${DAY_NAMES[match.dayIdx]}, ${dateStr} · ${fmtHour(match.hour)}`,
    body: `
      <div class="match-type-row">
        <button class="match-type-btn ${matchType === 'friendly'    ? 'active' : ''}" id="editMtFriendly">🤝 Friendly</button>
        <button class="match-type-btn ${matchType === 'competitive' ? 'active' : ''}" id="editMtCompetitive">🏆 Competitive</button>
      </div>
      <div id="editCompetitiveFields" style="display:${matchType === 'competitive' ? 'block' : 'none'}">
        <div class="form-group">
          <label for="editGamesPlayed">Games Played</label>
          <select id="editGamesPlayed">
            ${[1,2,3,4,5].map(n => `<option value="${n}" ${n === numGames ? 'selected' : ''}>${n} game${n !== 1 ? 's' : ''}</option>`).join('')}
          </select>
        </div>
        <div id="editScoreFields">${initScores}</div>
        <div class="form-group" style="margin-top:6px">
          <label>Your Result</label>
          <div class="result-row">
            <button class="result-btn win  ${matchResult === 'win'  ? 'active' : ''}" id="editResultWin">✓ Win</button>
            <button class="result-btn loss ${matchResult === 'loss' ? 'active' : ''}" id="editResultLoss">✗ Loss</button>
          </div>
        </div>
      </div>
      ${ratingsHtml}
      <div class="form-group" style="margin-top:12px">
        <label for="editMatchComment">Match Notes <span class="label-hint">(optional)</span></label>
        <textarea id="editMatchComment" class="match-comment" rows="2" placeholder="Add a note...">${typeof match.comment === 'string' ? match.comment : ''}</textarea>
      </div>
    `,
    actions: [
      makeBtn('Cancel', 'btn-secondary', closeModal),
      makeBtn('Save Changes', 'btn-primary', async () => {
        if (matchType === 'competitive' && !matchResult) {
          showToast('Please select Win or Loss.', 'error');
          return;
        }

        const scores = [];
        if (matchType === 'competitive') {
          for (let i = 1; i <= numGames; i++) {
            const a = parseInt(document.getElementById(`esg${i}a`)?.value || '0');
            const b = parseInt(document.getElementById(`esg${i}b`)?.value || '0');
            scores.push({ mine: a, theirs: b });
          }
        }
        const comment = document.getElementById('editMatchComment').value.trim();
        const newWon  = matchResult === 'win';

        const profileUpdates = {};
        const oldComp = match.type === 'competitive';
        const newComp = matchType === 'competitive';

        if (oldComp && !newComp) {
          profileUpdates[match.won ? 'wins' : 'losses'] = increment(-1);
          profileUpdates.rating = adjustRating(state.currentProfile.rating, !match.won);
        } else if (!oldComp && newComp) {
          profileUpdates[newWon ? 'wins' : 'losses'] = increment(1);
          profileUpdates.rating = adjustRating(state.currentProfile.rating, newWon);
        } else if (oldComp && newComp && match.won !== newWon) {
          profileUpdates[match.won ? 'wins' : 'losses'] = increment(-1);
          profileUpdates[newWon   ? 'wins' : 'losses']  = increment(1);
          profileUpdates.rating = adjustRating(adjustRating(state.currentProfile.rating, !match.won), newWon);
        }

        try {
          const updatedFields = {
            type: matchType,
            ...(comment ? { comment } : { comment: deleteField() }),
            ...(newComp
              ? { gamesPlayed: numGames, scores, won: newWon }
              : { gamesPlayed: deleteField(), scores: deleteField(), won: deleteField() }),
          };
          await updateDoc(doc(db, 'matches', match.id), updatedFields);

          if (Object.keys(profileUpdates).length > 0) {
            await updateDoc(doc(db, 'players', state.currentUser.uid), profileUpdates);
            const fresh = await loadFirestoreProfile(state.currentUser.uid);
            if (fresh) { state.currentProfile = fresh; applyProfileToHeader(fresh); }
          }

          const cachedMatch = { ...match, type: matchType };
          if (comment) cachedMatch.comment = comment;
          else delete cachedMatch.comment;
          if (newComp) Object.assign(cachedMatch, { gamesPlayed: numGames, scores, won: newWon });
          else { delete cachedMatch.gamesPlayed; delete cachedMatch.scores; delete cachedMatch.won; }
          state.matchCache.set(match.slotKey, cachedMatch);

          checkAndAwardBadges({ ...cachedMatch });

          closeModal();
          showToast('Match updated!');
          render();
        } catch (err) {
          console.error('Match update failed:', err);
          showToast('Could not update — please try again.', 'error');
        }
      }),
    ],
  });

  function setEditType(type) {
    matchType = type;
    document.getElementById('editMtFriendly').classList.toggle('active', type === 'friendly');
    document.getElementById('editMtCompetitive').classList.toggle('active', type === 'competitive');
    document.getElementById('editCompetitiveFields').style.display = type === 'competitive' ? 'block' : 'none';
    if (type === 'competitive') buildEditScoreFields();
  }

  function buildEditScoreFields() {
    numGames = parseInt(document.getElementById('editGamesPlayed').value);
    const el = document.getElementById('editScoreFields');
    el.innerHTML = '';
    for (let i = 1; i <= numGames; i++) {
      const s = (match.scores || [])[i - 1] || {};
      el.innerHTML += `
        <div class="score-row">
          <span class="score-label">Game ${i}</span>
          <input type="number" class="score-input" id="esg${i}a" min="0" max="99" value="${s.mine ?? ''}" placeholder="Yours" />
          <span class="score-dash">–</span>
          <input type="number" class="score-input" id="esg${i}b" min="0" max="99" value="${s.theirs ?? ''}" placeholder="Theirs" />
        </div>`;
    }
  }

  document.getElementById('editMtFriendly').addEventListener('click', () => setEditType('friendly'));
  document.getElementById('editMtCompetitive').addEventListener('click', () => setEditType('competitive'));
  document.getElementById('editGamesPlayed')?.addEventListener('change', buildEditScoreFields);

  document.getElementById('editResultWin').addEventListener('click', () => {
    matchResult = 'win';
    document.getElementById('editResultWin').classList.add('active');
    document.getElementById('editResultLoss').classList.remove('active');
  });

  document.getElementById('editResultLoss').addEventListener('click', () => {
    matchResult = 'loss';
    document.getElementById('editResultLoss').classList.add('active');
    document.getElementById('editResultWin').classList.remove('active');
  });
}
