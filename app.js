/* ============================================================
   Imposter Who? — pass-and-play social deduction word game
   Everyone sees the secret word except the imposter(s).
   Clues → discussion → secret vote → last-chance word guess.
   ============================================================ */
'use strict';

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
const rand = (n) => Math.floor(Math.random() * n);
const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const AVATARS = ['😎', '🦊', '🐸', '🐼', '🦄', '🐯', '👽', '🤖', '🐙', '🦁', '🐨', '🐹'];
const STORAGE_KEY = 'imposterwho.v1';

/* ---------- state ---------- */
const S = {
  players: [],            // [{name, score}]
  settings: {
    categories: WORD_PACKS.map((_, i) => i), // selected pack indices
    imposters: 1,
    mode: 'classic',      // classic | hint | decoy
    timer: 90,            // seconds, 0 = off
  },
  round: 0,
  usedWords: {},          // packIdx -> [lowercased words already played]
  lastImposter: -1,
  game: null,             // per-round state
};

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      names: S.players.map((p) => p.name),
      settings: S.settings,
      usedWords: S.usedWords,
    }));
  } catch (e) { /* private mode etc. */ }
}

function loadState() {
  try {
    const d = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!d) return;
    if (Array.isArray(d.names)) S.players = d.names.slice(0, 12).map((n) => ({ name: String(n).slice(0, 14), score: 0 }));
    if (d.settings) {
      const st = d.settings;
      if (Array.isArray(st.categories)) {
        const cats = st.categories.filter((i) => Number.isInteger(i) && i >= 0 && i < WORD_PACKS.length);
        if (cats.length) S.settings.categories = cats;
      }
      if ([1, 2, 3].includes(st.imposters)) S.settings.imposters = st.imposters;
      if (['classic', 'hint', 'decoy'].includes(st.mode)) S.settings.mode = st.mode;
      if ([0, 60, 90, 120].includes(st.timer)) S.settings.timer = st.timer;
    }
    if (d.usedWords && typeof d.usedWords === 'object') {
      for (const [k, v] of Object.entries(d.usedWords)) {
        if (Array.isArray(v)) S.usedWords[k] = v.filter((w) => typeof w === 'string');
      }
    }
  } catch (e) { /* corrupted storage — start fresh */ }
}

/* ---------- navigation ---------- */
let currentScreen = 'home';
function go(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $('screen-' + name).classList.add('active');
  currentScreen = name;
}

/* ---------- wake lock (best effort) ---------- */
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
  } catch (e) { /* not critical */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && S.game) keepAwake();
});

/* ---------- tiny beep ---------- */
function beep(times = 1) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    for (let i = 0; i < times; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      const t = ctx.currentTime + i * 0.25;
      g.gain.setValueAtTime(0.001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      o.start(t); o.stop(t + 0.22);
    }
  } catch (e) { /* no audio — fine */ }
}

/* ---------- players screen ---------- */
function renderPlayers() {
  const list = $('player-list');
  list.innerHTML = S.players.map((p, i) => `
    <li class="player-row">
      <span class="player-emoji">${AVATARS[i % AVATARS.length]}</span>
      <span class="pname">${esc(p.name)}</span>
      <button class="btn-remove" data-i="${i}" aria-label="Remove ${esc(p.name)}">✕</button>
    </li>`).join('');
  list.querySelectorAll('.btn-remove').forEach((b) => {
    b.addEventListener('click', () => {
      S.players.splice(Number(b.dataset.i), 1);
      saveState(); renderPlayers();
    });
  });
  $('player-count').textContent = S.players.length ? `${S.players.length}/12` : '';
  $('btn-to-settings').disabled = S.players.length < 3;
  $('players-hint').textContent = S.players.length < 3
    ? 'Add at least 3 players to start.'
    : 'Sitting order = passing order. Add up to 12.';
  $('add-player-form').style.display = S.players.length >= 12 ? 'none' : '';
}

$('add-player-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('player-name-input');
  const name = input.value.trim().slice(0, 14);
  const dup = S.players.some((p) => p.name.toLowerCase() === name.toLowerCase());
  if (!name || dup || S.players.length >= 12) {
    input.classList.remove('shake'); void input.offsetWidth; input.classList.add('shake');
    return;
  }
  S.players.push({ name, score: 0 });
  input.value = '';
  saveState(); renderPlayers();
  input.focus();
});

/* ---------- settings screen ---------- */
function maxImposters() {
  const n = S.players.length;
  return n >= 9 ? 3 : n >= 6 ? 2 : 1;
}

function renderSettings() {
  // categories
  const grid = $('category-grid');
  const sel = new Set(S.settings.categories);
  const allOn = sel.size === WORD_PACKS.length;
  grid.innerHTML = `
    <button class="cat-chip all ${allOn ? 'on' : ''}" data-all="1"><span class="cat-emoji">🎲</span>All categories</button>
    ${WORD_PACKS.map((p, i) => `
      <button class="cat-chip ${sel.has(i) ? 'on' : ''}" data-i="${i}">
        <span class="cat-emoji">${p.emoji}</span>${esc(p.category)}
      </button>`).join('')}`;
  grid.querySelectorAll('.cat-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      if (chip.dataset.all) {
        S.settings.categories = allOn ? [0] : WORD_PACKS.map((_, i) => i);
      } else {
        const i = Number(chip.dataset.i);
        const cur = new Set(S.settings.categories);
        if (cur.has(i)) {
          if (cur.size > 1) cur.delete(i); // keep at least one
        } else {
          cur.add(i);
        }
        S.settings.categories = [...cur].sort((a, b) => a - b);
      }
      saveState(); renderSettings();
    });
  });

  // imposter count
  const maxI = maxImposters();
  if (S.settings.imposters > maxI) S.settings.imposters = maxI;
  $('imposter-picker').innerHTML = [1, 2, 3].map((n) =>
    `<button class="seg ${S.settings.imposters === n ? 'on' : ''}" data-n="${n}" ${n > maxI ? 'disabled' : ''}>${n}</button>`).join('');
  $('imposter-picker').querySelectorAll('.seg').forEach((b) => {
    b.addEventListener('click', () => { S.settings.imposters = Number(b.dataset.n); saveState(); renderSettings(); });
  });
  $('imposter-hint').textContent =
    maxI === 1 ? 'More imposters unlock with 6+ players.' :
    maxI === 2 ? 'A third imposter unlocks with 9+ players.' :
    'Chaos mode available. 😈';

  // mode
  document.querySelectorAll('#mode-cards .mode-card').forEach((c) => {
    c.classList.toggle('on', c.dataset.mode === S.settings.mode);
  });

  // timer
  const opts = [[0, 'Off'], [60, '1:00'], [90, '1:30'], [120, '2:00']];
  $('timer-picker').innerHTML = opts.map(([v, label]) =>
    `<button class="seg ${S.settings.timer === v ? 'on' : ''}" data-v="${v}">${label}</button>`).join('');
  $('timer-picker').querySelectorAll('.seg').forEach((b) => {
    b.addEventListener('click', () => { S.settings.timer = Number(b.dataset.v); saveState(); renderSettings(); });
  });

  $('btn-start-game').textContent = S.round === 0 ? 'Start round 1' : `Start round ${S.round + 1}`;
}

document.querySelectorAll('#mode-cards .mode-card').forEach((c) => {
  c.addEventListener('click', () => { S.settings.mode = c.dataset.mode; saveState(); renderSettings(); });
});

/* ---------- round setup ---------- */
function pickWord() {
  const packIdx = S.settings.categories[rand(S.settings.categories.length)];
  const pack = WORD_PACKS[packIdx];
  const used = new Set(S.usedWords[packIdx] || []);
  let pool = pack.words.filter((e) => !used.has(e.w.toLowerCase()));
  if (!pool.length) { // pack exhausted — recycle
    S.usedWords[packIdx] = [];
    pool = pack.words;
  }
  const entry = pool[rand(pool.length)];
  S.usedWords[packIdx] = [...(S.usedWords[packIdx] || []), entry.w.toLowerCase()];
  saveState();
  return { packIdx, pack, entry };
}

function pickImposters() {
  const n = S.players.length;
  const count = Math.min(S.settings.imposters, maxImposters());
  let ids = shuffle(S.players.map((_, i) => i)).slice(0, count);
  // avoid the exact same single imposter twice in a row when we can
  if (count === 1 && ids[0] === S.lastImposter && n > 3) {
    const others = S.players.map((_, i) => i).filter((i) => i !== S.lastImposter);
    ids = [others[rand(others.length)]];
  }
  if (count === 1) S.lastImposter = ids[0];
  return ids;
}

function startRound() {
  const { packIdx, pack, entry } = pickWord();
  S.round++;
  S.game = {
    packIdx,
    category: pack.category,
    emoji: pack.emoji,
    word: entry.w,
    decoy: entry.d,
    imposters: pickImposters(),
    clueOrder: shuffle(S.players.map((_, i) => i)),
    revealIdx: 0,
    votes: new Array(S.players.length).fill(-1),
    voteIdx: 0,
    voteCandidates: null,   // null = everyone; array = tie-break revote
    tieBreak: false,
    accused: null,
    caught: false,
    guessedRight: null,
    deltas: new Array(S.players.length).fill(0),
  };
  keepAwake();
  renderRevealGate();
  go('reveal');
}

/* ---------- reveal phase ---------- */
function renderDots(el, total, cur) {
  el.innerHTML = Array.from({ length: total }, (_, i) =>
    `<span class="${i < cur ? 'done' : i === cur ? 'cur' : ''}"></span>`).join('');
}

function renderRevealGate() {
  const g = S.game;
  const p = S.players[g.revealIdx];
  $('reveal-round-label').textContent = `Round ${S.round}`;
  renderDots($('reveal-dots'), S.players.length, g.revealIdx);
  $('reveal-player-name').textContent = p.name;
  $('reveal-player-name2').textContent = p.name;
  $('reveal-gate').classList.remove('hidden');
  $('reveal-card-wrap').classList.add('hidden');
  $('reveal-card').classList.remove('flipped');
  $('btn-reveal-done').disabled = true;
}

$('btn-im-ready').addEventListener('click', () => {
  const g = S.game;
  const isImposter = g.imposters.includes(g.revealIdx);
  const back = $('reveal-card-back');
  back.classList.remove('imposter-card');

  if (!isImposter || S.settings.mode === 'decoy') {
    // crew card — or the decoy imposter who believes they're crew
    const word = isImposter ? g.decoy : g.word;
    $('secret-category').textContent = `${g.emoji} ${g.category}`;
    $('secret-word').textContent = word;
    $('secret-sub').textContent = 'Blend in. Don’t say it out loud!';
  } else {
    back.classList.add('imposter-card');
    $('secret-category').textContent = '🚨 You are the';
    $('secret-word').textContent = 'Imposter';
    $('secret-sub').textContent = S.settings.mode === 'hint'
      ? `Hint — the category is: ${g.emoji} ${g.category}`
      : 'You don’t know the word. Fake it!';
  }
  $('reveal-gate').classList.add('hidden');
  $('reveal-card-wrap').classList.remove('hidden');
});

// hold-to-reveal
(() => {
  const card = $('reveal-card');
  const show = (e) => { e.preventDefault(); card.classList.add('flipped'); $('btn-reveal-done').disabled = false; };
  const hide = () => card.classList.remove('flipped');
  card.addEventListener('pointerdown', show);
  card.addEventListener('pointerup', hide);
  card.addEventListener('pointercancel', hide);
  card.addEventListener('pointerleave', hide);
  card.addEventListener('contextmenu', (e) => e.preventDefault());
})();

$('btn-reveal-done').addEventListener('click', () => {
  const g = S.game;
  g.revealIdx++;
  if (g.revealIdx < S.players.length) {
    renderRevealGate();
  } else {
    renderClues();
    go('clues');
  }
});

/* ---------- clues ---------- */
function renderClues() {
  $('clues-round-label').textContent = `Round ${S.round} — clues`;
  $('clue-order').innerHTML = S.game.clueOrder.map((idx, pos) => `
    <li class="${pos === 0 ? 'first' : ''}">
      <span>${AVATARS[idx % AVATARS.length]} ${esc(S.players[idx].name)}</span>
      ${pos === 0 ? '<span class="starts">starts</span>' : ''}
    </li>`).join('');
}

$('btn-to-discussion').addEventListener('click', () => {
  go('discuss');
  startTimer();
});

/* ---------- discussion timer ---------- */
let timerHandle = null;
const RING_LEN = 2 * Math.PI * 52;

function stopTimer() {
  if (timerHandle) { clearInterval(timerHandle); timerHandle = null; }
}

function startTimer() {
  stopTimer();
  const total = S.settings.timer;
  const ring = $('timer-ring');
  if (!total) { ring.style.display = 'none'; return; }
  ring.style.display = '';
  ring.classList.remove('urgent');
  let left = total;
  const fg = $('ring-fg');
  const num = $('timer-num');
  fg.style.strokeDashoffset = 0;
  num.textContent = left;
  timerHandle = setInterval(() => {
    left--;
    num.textContent = Math.max(0, left);
    fg.style.strokeDashoffset = RING_LEN * (1 - left / total);
    if (left <= 10) ring.classList.add('urgent');
    if (left <= 0) {
      stopTimer();
      beep(3);
      num.textContent = '0';
    }
  }, 1000);
}

$('btn-to-vote').addEventListener('click', () => {
  stopTimer();
  startVoting(null);
});

/* ---------- voting ---------- */
function startVoting(candidates) {
  const g = S.game;
  g.voteCandidates = candidates; // null → everyone votable
  g.votes = new Array(S.players.length).fill(-1);
  g.voteIdx = 0;
  renderVoteGate();
  go('vote');
}

function renderVoteGate() {
  const g = S.game;
  const p = S.players[g.voteIdx];
  renderDots($('vote-dots'), S.players.length, g.voteIdx);
  $('vote-player-name').textContent = p.name;
  $('vote-player-name2').textContent = p.name;
  $('vote-gate').classList.remove('hidden');
  $('vote-ballot').classList.add('hidden');
}

$('btn-vote-ready').addEventListener('click', () => {
  const g = S.game;
  const voter = g.voteIdx;
  const candidates = (g.voteCandidates || S.players.map((_, i) => i)).filter((i) => i !== voter);
  $('ballot-question').innerHTML = `<b>${esc(S.players[voter].name)}</b>, who is the imposter?`;
  $('ballot-grid').innerHTML = candidates.map((i) => `
    <button class="ballot-btn" data-i="${i}">
      <span class="b-emoji">${AVATARS[i % AVATARS.length]}</span>${esc(S.players[i].name)}
    </button>`).join('');
  $('ballot-grid').querySelectorAll('.ballot-btn').forEach((b) => {
    b.addEventListener('click', () => castVote(Number(b.dataset.i)));
  });
  $('vote-gate').classList.add('hidden');
  $('vote-ballot').classList.remove('hidden');
});

function castVote(target) {
  const g = S.game;
  g.votes[g.voteIdx] = target;
  g.voteIdx++;
  if (g.voteIdx < S.players.length) {
    renderVoteGate();
  } else {
    tallyVotes();
  }
}

function tallyVotes() {
  const g = S.game;
  const counts = new Array(S.players.length).fill(0);
  g.votes.forEach((v) => { if (v >= 0) counts[v]++; });
  const max = Math.max(...counts);
  const top = counts.map((c, i) => [c, i]).filter(([c]) => c === max).map(([, i]) => i);
  renderResults(counts, top);
  go('results');
}

/* ---------- results ---------- */
function renderTally(counts, top) {
  const max = Math.max(1, ...counts);
  const rows = counts
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c > 0)
    .sort((a, b) => b.c - a.c);
  $('vote-tally').innerHTML = rows.map(({ c, i }) => `
    <div class="tally-row ${top.includes(i) ? 'top' : ''}">
      <span class="t-name">${esc(S.players[i].name)}</span>
      <div class="tally-bar-wrap"><div class="tally-bar" data-w="${(c / max) * 100}"></div></div>
      <span class="t-count">${c}</span>
    </div>`).join('');
  requestAnimationFrame(() => {
    $('vote-tally').querySelectorAll('.tally-bar').forEach((b) => { b.style.width = b.dataset.w + '%'; });
  });
}

function renderResults(counts, top) {
  const g = S.game;
  const nextBtn = $('btn-results-next');
  const msg = $('results-msg');
  $('results-title').textContent = 'The votes are in…';
  renderTally(counts, top);
  $('accused-wrap').classList.add('hidden');
  msg.classList.add('hidden');
  nextBtn.classList.add('hidden');
  nextBtn.onclick = null;

  if (top.length > 1 && !g.tieBreak) {
    // first tie → one revote among the tied
    g.tieBreak = true;
    msg.innerHTML = `It’s a tie between <b>${top.map((i) => esc(S.players[i].name)).join('</b> and <b>')}</b>! One revote — choose carefully.`;
    msg.classList.remove('hidden');
    nextBtn.textContent = 'Revote';
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => startVoting(top);
    return;
  }

  if (top.length > 1) {
    // tied again → imposters escape
    g.accused = null;
    g.caught = false;
    msg.innerHTML = 'Still tied! Nobody is accused… <b>the imposter slips away!</b> 🎭';
    msg.classList.remove('hidden');
    nextBtn.textContent = 'See the damage';
    nextBtn.classList.remove('hidden');
    nextBtn.onclick = () => endRound();
    return;
  }

  // single accused — dramatic flip reveal
  const accused = top[0];
  g.accused = accused;
  g.caught = g.imposters.includes(accused);
  $('accused-name').textContent = S.players[accused].name;
  const card = $('accused-card');
  const back = $('accused-back');
  card.classList.remove('flipped');
  back.classList.toggle('imposter-card', g.caught);
  back.innerHTML = g.caught
    ? '<span class="reveal-verdict">Imposter! 🚨</span>'
    : '<span class="reveal-verdict">Innocent 😇</span>';
  $('accused-wrap').classList.remove('hidden');

  card.onclick = () => {
    if (card.classList.contains('flipped')) return;
    card.classList.add('flipped');
    setTimeout(() => {
      if (g.caught) {
        msg.innerHTML = `<b>${esc(S.players[accused].name)}</b> was the imposter! But they get one last chance…`;
        nextBtn.textContent = 'Last chance';
        nextBtn.onclick = () => { renderGuess(); go('guess'); };
      } else {
        msg.innerHTML = `<b>${esc(S.players[accused].name)}</b> was innocent! <b>The imposter escapes!</b> 🎭`;
        nextBtn.textContent = 'See the damage';
        nextBtn.onclick = () => endRound();
      }
      msg.classList.remove('hidden');
      nextBtn.classList.remove('hidden');
    }, 500);
  };
}

/* ---------- imposter's last-chance guess ---------- */
function renderGuess() {
  const g = S.game;
  $('guess-imposter-name').textContent = S.players[g.accused].name;
  $('guess-gate').classList.remove('hidden');
  $('guess-options').classList.add('hidden');
}

$('btn-guess-ready').addEventListener('click', () => {
  const g = S.game;
  const pack = WORD_PACKS[g.packIdx];
  const wordL = g.word.toLowerCase();
  const decoyL = g.decoy.toLowerCase();
  // 5 distractors from the same category (excluding the word and, in decoy
  // mode, the decoy the imposter already saw and now knows is wrong)
  const pool = pack.words
    .map((e) => e.w)
    .filter((w) => w.toLowerCase() !== wordL && w.toLowerCase() !== decoyL);
  const options = shuffle([g.word, ...shuffle(pool).slice(0, 5)]);
  $('guess-grid').innerHTML = options.map((w) => `
    <button class="ballot-btn" data-w="${esc(w)}">${esc(w)}</button>`).join('');
  $('guess-grid').querySelectorAll('.ballot-btn').forEach((b) => {
    b.addEventListener('click', () => {
      S.game.guessedRight = b.dataset.w.toLowerCase() === wordL;
      endRound();
    });
  });
  $('guess-gate').classList.add('hidden');
  $('guess-options').classList.remove('hidden');
});

/* ---------- scoring & scoreboard ---------- */
function endRound() {
  const g = S.game;
  const deltas = g.deltas;

  if (g.caught) {
    // crew catches an imposter: crew +1 each; other imposters slipped by: +1
    S.players.forEach((_, i) => {
      if (!g.imposters.includes(i)) deltas[i] += 1;
      else if (i !== g.accused) deltas[i] += 1;
    });
    if (g.guessedRight) deltas[g.accused] += 2; // steal!
  } else {
    // imposters fooled everyone
    g.imposters.forEach((i) => { deltas[i] += 3; });
  }
  S.players.forEach((p, i) => { p.score += deltas[i]; });
  renderScoreboard();
  go('scoreboard');
}

function renderScoreboard() {
  const g = S.game;
  $('score-round-label').textContent = `Round ${S.round} results`;

  const impNames = g.imposters.map((i) =>
    `<b>${esc(S.players[i].name)}</b>${g.imposters.length > 1 ? (i === g.accused ? ' (caught)' : ' (escaped)') : ''}`);
  const headline = g.caught
    ? (g.guessedRight
      ? '🎭 Caught — but they guessed the word and stole points!'
      : '🎉 The crew wins the round!')
    : '🎭 The imposter wins the round!';
  $('round-summary').innerHTML = `
    <div style="font-size:17px;margin-bottom:6px"><b>${headline}</b></div>
    The secret word was <span class="rs-word">${esc(g.word)}</span> <span style="white-space:nowrap">(${g.emoji} ${esc(g.category)})</span><br>
    ${g.imposters.length > 1 ? 'Imposters' : 'The imposter'}: ${impNames.join(', ')}
    ${S.settings.mode === 'decoy' ? `<br>Their decoy word was <b>${esc(g.decoy)}</b>` : ''}`;

  const ranked = S.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
  const best = ranked[0]?.score ?? 0;
  $('score-list').innerHTML = ranked.map((p, r) => `
    <li class="score-row ${p.score === best && best > 0 ? 'leader' : ''}">
      <span class="s-rank">${r + 1}</span>
      <span>${AVATARS[p.i % AVATARS.length]}</span>
      <span class="s-name">${esc(p.name)}</span>
      ${g.deltas[p.i] ? `<span class="s-delta">+${g.deltas[p.i]}</span>` : ''}
      <span class="s-score">${p.score}</span>
    </li>`).join('');
}

$('btn-next-round').addEventListener('click', () => startRound());

$('btn-end-game').addEventListener('click', () => {
  renderFinal();
  go('final');
  launchConfetti();
});

/* ---------- final ---------- */
function renderFinal() {
  const ranked = S.players.map((p, i) => ({ ...p, i })).sort((a, b) => b.score - a.score);
  const podium = $('podium');
  const slots = [ranked[1], ranked[0], ranked[2]];
  const cls = ['p2', 'p1', 'p3'];
  const medal = ['🥈', '🥇', '🥉'];
  podium.innerHTML = slots.map((p, k) => p ? `
    <div class="pod ${cls[k]}">
      <span class="pod-emoji">${medal[k]}</span>
      <span class="pod-name">${esc(p.name)}</span>
      <span class="pod-score">${p.score}</span>
    </div>` : '').join('');
  $('final-score-list').innerHTML = ranked.map((p, r) => `
    <li class="score-row ${r === 0 ? 'leader' : ''}">
      <span class="s-rank">${r + 1}</span>
      <span>${AVATARS[p.i % AVATARS.length]}</span>
      <span class="s-name">${esc(p.name)}</span>
      <span class="s-score">${p.score}</span>
    </li>`).join('');
}

function resetScores() {
  S.players.forEach((p) => { p.score = 0; });
  S.round = 0;
  S.game = null;
}

$('btn-play-again').addEventListener('click', () => {
  resetScores();
  renderSettings();
  go('settings');
});

$('btn-final-home').addEventListener('click', () => {
  resetScores();
  go('home');
});

/* ---------- confetti ---------- */
function launchConfetti() {
  const canvas = $('confetti');
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const colors = ['#ccf537', '#ff5252', '#4dd2ff', '#ffd24d', '#ff8ae2', '#ffffff'];
  const parts = Array.from({ length: 140 }, () => ({
    x: Math.random() * W,
    y: -20 - Math.random() * H * 0.5,
    w: 6 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    vy: 2 + Math.random() * 3,
    vx: -1.5 + Math.random() * 3,
    rot: Math.random() * Math.PI,
    vr: -0.15 + Math.random() * 0.3,
    color: colors[rand(colors.length)],
  }));
  let frames = 0;
  (function tick() {
    ctx.clearRect(0, 0, W, H);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (++frames < 260) requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  })();
}

/* ---------- abort round ---------- */
function abortRound() {
  if (!confirm('Quit this round? The word will be discarded.')) return;
  stopTimer();
  S.round--; // round never happened
  S.game = null;
  renderSettings();
  go('settings');
}
$('btn-abort-round').addEventListener('click', abortRound);
$('btn-abort-round2').addEventListener('click', abortRound);

/* ---------- global nav wiring ---------- */
$('btn-new-game').addEventListener('click', () => { renderPlayers(); go('players'); });
$('btn-to-settings').addEventListener('click', () => { renderSettings(); go('settings'); });
$('btn-start-game').addEventListener('click', () => startRound());
document.querySelectorAll('.btn-back[data-back]').forEach((b) => {
  b.addEventListener('click', () => go(b.dataset.back));
});
$('btn-howto').addEventListener('click', () => $('howto-modal').classList.remove('hidden'));
$('btn-close-howto').addEventListener('click', () => $('howto-modal').classList.add('hidden'));
$('howto-modal').addEventListener('click', (e) => {
  if (e.target === $('howto-modal')) $('howto-modal').classList.add('hidden');
});

/* ---------- boot ---------- */
loadState();
go('home');
