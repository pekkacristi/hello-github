/* Headless end-to-end smoke test of the Imposter Who? game. */
const { chromium } = require('playwright-core');
// Portable paths: game root is the repo root; Chromium comes from
// CHROMIUM_PATH or the Playwright browsers dir.
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';


const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
const ok = (msg) => console.log('ok –', msg);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', (d) => d.accept());

  await page.goto(GAME_URL);
  await page.waitForTimeout(300);

  const active = () => page.evaluate(() => document.querySelector('.screen.active').id);

  // ---- home → players ----
  if (await active() !== 'screen-home') fail('expected home screen');
  await page.click('#btn-howto');
  await page.click('#btn-close-howto');
  await page.click('#btn-new-game');
  if (await active() !== 'screen-players') fail('expected players screen');

  // remove any restored players so the run is deterministic
  await page.evaluate(() => { S.players = []; renderPlayers(); });

  for (const name of ['Ana', 'Ben', 'Cleo', 'Dan']) {
    await page.fill('#player-name-input', name);
    await page.click('.btn-add');
  }
  // duplicate name must be rejected
  await page.fill('#player-name-input', 'ana');
  await page.click('.btn-add');
  const count = await page.evaluate(() => S.players.length);
  if (count !== 4) fail('expected 4 players, got ' + count);
  ok('players added, duplicate rejected');

  await page.click('#btn-to-settings');
  if (await active() !== 'screen-settings') fail('expected settings screen');

  // 2/3-imposter segments must be locked with 4 players
  const locked = await page.evaluate(() =>
    [...document.querySelectorAll('#imposter-picker .seg')].map((b) => b.disabled));
  if (JSON.stringify(locked) !== JSON.stringify([false, true, true])) fail('imposter clamp wrong: ' + locked);
  // timer off for a fast test, full Evolution flow
  await page.click('#timer-picker .seg[data-v="0"]');
  await page.click('#style-cards .mode-card[data-style="evolution"]');

  const playRevealPhase = async () => {
    for (let i = 0; i < 4; i++) {
      await page.click('#btn-im-ready');
      await page.dispatchEvent('#reveal-card', 'pointerdown');
      await page.waitForSelector('#btn-reveal-done:not([disabled])', { timeout: 3000 });
      const wordShown = await page.textContent('#secret-word');
      await page.dispatchEvent('#reveal-card', 'pointerup');
      if (!wordShown.trim()) fail('empty secret word for player ' + i);
      await page.click('#btn-reveal-done');
    }
  };

  const voteAllFor = async (targetIdx) => {
    for (let i = 0; i < 4; i++) {
      await page.click('#btn-vote-ready');
      let t = targetIdx(i);
      if (t === i) t = (t + 1) % 4; // can't vote self — ballot won't offer it
      const btn = await page.$(`#ballot-grid .ballot-btn[data-i="${t}"]`);
      if (!btn) fail(`ballot missing option ${t} for voter ${i}`);
      // self must never be a ballot option
      if (await page.$(`#ballot-grid .ballot-btn[data-i="${i}"]`)) fail('ballot offers self-vote');
      await btn.click();
    }
  };

  // ================= ROUND 1: catch the imposter, guess right =================
  await page.click('#btn-start-game');
  if (await active() !== 'screen-reveal') fail('expected reveal screen');
  const g1 = await page.evaluate(() => ({ imposters: S.game.imposters, word: S.game.word, decoy: S.game.decoy }));
  if (g1.imposters.length !== 1) fail('expected 1 imposter');
  await playRevealPhase();
  if (await active() !== 'screen-clues') fail('expected clues screen');
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');

  const imp = g1.imposters[0];
  await voteAllFor(() => imp);
  if (await active() !== 'screen-results') fail('expected results screen');
  await page.click('#accused-card');
  await page.waitForTimeout(700);
  await page.click('#btn-results-next');
  if (await active() !== 'screen-guess') fail('expected guess screen');
  await page.click('#btn-guess-ready');
  const nOpts = await page.evaluate(() => document.querySelectorAll('#guess-grid .ballot-btn').length);
  if (nOpts !== 8) fail('expected 8 guess options, got ' + nOpts);
  const hasDecoy = await page.evaluate((d) =>
    [...document.querySelectorAll('#guess-grid .ballot-btn')].some((b) => b.dataset.w === d), g1.decoy);
  if (hasDecoy) fail('guess options include the decoy');
  await page.click(`#guess-grid .ballot-btn[data-w="${g1.word.replace(/"/g, '\\"')}"]`);
  if (await active() !== 'screen-scoreboard') fail('expected scoreboard');
  let scores = await page.evaluate(() => S.players.map((p) => p.score));
  const expected1 = [0, 0, 0, 0].map((v, i) => 2); // crew +2 each, caught imposter +2 for the guess
  if (JSON.stringify(scores) !== JSON.stringify(expected1)) fail(`round1 scores ${scores}, expected ${expected1}`);
  ok('round 1: imposter caught, correct guess, scores ' + scores);

  // ================= ROUND 2: accuse an innocent → imposter escapes =================
  await page.click('#btn-next-round');
  const g2 = await page.evaluate(() => ({ imposters: S.game.imposters }));
  const imp2 = g2.imposters[0];
  const innocent = [0, 1, 2, 3].find((i) => i !== imp2);
  await playRevealPhase();
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');
  await voteAllFor(() => innocent);
  await page.click('#accused-card');
  await page.waitForTimeout(700);
  await page.click('#btn-results-next');
  if (await active() !== 'screen-scoreboard') fail('expected scoreboard after escape');
  const scores2 = await page.evaluate(() => S.players.map((p) => p.score));
  const expDelta2 = expected1.map((v, i) => v + (i === imp2 ? 4 : 0));
  if (JSON.stringify(scores2) !== JSON.stringify(expDelta2)) fail(`round2 scores ${scores2}, expected ${expDelta2}`);
  ok('round 2: innocent accused, imposter +3, scores ' + scores2);

  // ================= ROUND 3: forced tie → revote → tie again → escape =================
  await page.click('#btn-next-round');
  const imp3 = (await page.evaluate(() => S.game.imposters))[0];
  await playRevealPhase();
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');
  // 2-2 tie: voters 0,1 vote A; voters 2,3 vote B (A,B fixed non-self targets)
  await voteAllFor((i) => (i < 2 ? 2 : 0));
  const tieMsgShown = await page.evaluate(() => !document.getElementById('results-msg').classList.contains('hidden'));
  if (!tieMsgShown) fail('tie message not shown');
  await page.click('#btn-results-next'); // Revote
  if (await active() !== 'screen-vote') fail('expected revote screen');
  // tied players 0 and 2 sit out; voters are 1 and 3, candidates [0, 2]
  const gateName = await page.textContent('#vote-player-name');
  if (gateName !== 'Ben') fail('expected Ben (voter 1) first in revote, got ' + gateName);
  await page.click('#btn-vote-ready');
  const cands = await page.evaluate(() =>
    [...document.querySelectorAll('#ballot-grid .ballot-btn')].map((b) => Number(b.dataset.i)).sort());
  if (JSON.stringify(cands) !== JSON.stringify([0, 2])) fail('revote candidates wrong: ' + cands);
  await page.click('#ballot-grid .ballot-btn[data-i="0"]'); // Ben votes 0
  await page.click('#btn-vote-ready');
  await page.click('#ballot-grid .ballot-btn[data-i="2"]'); // Dan votes 2 -> 1-1 tie again
  const finalTie = await page.evaluate(() => S.game.accused);
  if (finalTie !== null) fail('expected null accused after double tie, got ' + finalTie);
  await page.click('#btn-results-next'); // See the damage
  const scores3 = await page.evaluate(() => S.players.map((p) => p.score));
  const expDelta3 = expDelta2.map((v, i) => v + (i === imp3 ? 4 : 0));
  if (JSON.stringify(scores3) !== JSON.stringify(expDelta3)) fail(`round3 scores ${scores3}, expected ${expDelta3}`);
  ok('round 3: double tie → imposter escapes, scores ' + scores3);

  // ================= end game =================
  await page.click('#btn-end-game');
  await page.click('#confirm-yes');
  if (await active() !== 'screen-final') fail('expected final screen');
  const podium = await page.evaluate(() => document.querySelectorAll('.pod').length);
  if (podium !== 3) fail('expected 3 podium slots, got ' + podium);
  await page.click('#btn-play-again');
  if (await active() !== 'screen-settings') fail('expected settings after play again');
  const reset = await page.evaluate(() => S.players.every((p) => p.score === 0) && S.round === 0);
  if (!reset) fail('scores/round not reset on play again');
  ok('end game, podium, play-again reset');

  // ================= decoy mode: imposter sees decoy styled as crew =================
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.mode = 'decoy'; renderSettings(); });
  await page.click('#btn-start-game');
  const g4 = await page.evaluate(() => ({ imp: S.game.imposters[0], word: S.game.word, decoy: S.game.decoy }));
  for (let i = 0; i < 4; i++) {
    await page.click('#btn-im-ready');
    const shown = await page.textContent('#secret-word');
    const isRed = await page.evaluate(() => document.getElementById('reveal-card-back').classList.contains('imposter-card'));
    if (i === g4.imp) {
      if (shown !== g4.decoy) fail(`decoy imposter saw "${shown}", expected decoy "${g4.decoy}"`);
      if (isRed) fail('decoy imposter card is styled as imposter (gives it away)');
    } else if (shown !== g4.word) fail(`crew saw "${shown}", expected "${g4.word}"`);
    await page.dispatchEvent('#reveal-card', 'pointerdown');
    await page.waitForSelector('#btn-reveal-done:not([disabled])', { timeout: 3000 });
    await page.dispatchEvent('#reveal-card', 'pointerup');
    await page.click('#btn-reveal-done');
  }
  ok('decoy mode: imposter unknowingly sees decoy, crew sees word');

  // ================= HINT mode: imposter gets a similar-word hint =================
  await page.click('#btn-abort-round2'); // leave the decoy round
  await page.click('#confirm-yes');
  if (await active() !== 'screen-settings') fail('expected settings after decoy abort, got ' + await active());
  await page.evaluate(() => { S.settings.mode = 'hint'; renderSettings(); });
  await page.click('#btn-start-game');
  const gH = await page.evaluate(() => ({ imp: S.game.imposters[0], hint: S.game.hint, decoy: S.game.decoy, word: S.game.word }));
  for (let i = 0; i < 4; i++) {
    await page.click('#btn-im-ready');
    const sub = await page.textContent('#secret-sub');
    const shown = await page.textContent('#secret-word');
    if (i === gH.imp) {
      if (shown !== 'Imposter') fail('hint imposter card wrong: ' + shown);
      if (!sub.includes(gH.hint)) fail('hint card missing the hint word: ' + sub);
      if (sub.includes(gH.word)) fail('hint card leaks the secret word: ' + sub);
      if (gH.hint.toLowerCase() === gH.word.toLowerCase()) fail('hint equals the secret word');
    } else if (shown !== gH.word) fail('hint crew saw wrong word: ' + shown);
    await page.dispatchEvent('#reveal-card', 'pointerdown');
    await page.waitForSelector('#btn-reveal-done:not([disabled])', { timeout: 3000 });
    await page.dispatchEvent('#reveal-card', 'pointerup');
    await page.click('#btn-reveal-done');
  }
  await page.click('#btn-abort-round2');
  await page.click('#confirm-yes');
  if (await active() !== 'screen-settings') fail('expected settings after hint abort, got ' + await active());
  ok('hint mode: imposter gets a helpful clue word, secret never leaks');

  // ================= ORIGINAL style: talk & one-tap reveal, no scores =================
  await page.evaluate(() => { S.settings.gameStyle = 'original'; S.settings.mode = 'classic'; S.settings.timer = 0; renderSettings(); });
  const scoresBefore = await page.evaluate(() => S.players.map((p) => p.score));
  await page.click('#btn-start-game');
  const gO = await page.evaluate(() => ({ imp: S.game.imposters[0], word: S.game.word, starter: S.players[S.game.clueOrder[0]].name }));
  for (let i = 0; i < 4; i++) {
    await page.click('#btn-im-ready');
    await page.dispatchEvent('#reveal-card', 'pointerdown');
    await page.waitForSelector('#btn-reveal-done:not([disabled])', { timeout: 3000 });
    await page.dispatchEvent('#reveal-card', 'pointerup');
    await page.click('#btn-reveal-done');
  }
  if (await active() !== 'screen-discuss') fail('original: expected talk screen, got ' + await active());
  const talkTitle = await page.textContent('#discuss-title');
  if (talkTitle !== 'Game started!') fail('original: talk title wrong: ' + talkTitle);
  const talkIntro = await page.textContent('#discuss-intro');
  if (!talkIntro.includes(gO.starter) || !talkIntro.includes('starts the conversation')) fail('original: starter line wrong: ' + talkIntro);
  const revealLabel = await page.textContent('#btn-to-vote');
  if (!revealLabel.includes('Reveal imposter')) fail('original: reveal button label wrong: ' + revealLabel);
  await page.click('#btn-to-vote');
  if (await active() !== 'screen-bigreveal') fail('original: expected big reveal, got ' + await active());
  const shownWord = await page.textContent('#bigreveal-word');
  if (shownWord !== gO.word) fail(`original: reveal shows "${shownWord}", expected "${gO.word}"`);
  const impLine = await page.textContent('#bigreveal-imposters');
  const impName = await page.evaluate((i) => S.players[i].name, gO.imp);
  if (!impLine.includes(impName)) fail('original: imposter name missing from reveal: ' + impLine);
  const scoresAfter = await page.evaluate(() => S.players.map((p) => p.score));
  if (JSON.stringify(scoresAfter) !== JSON.stringify(scoresBefore)) fail('original: scores changed in no-score style');
  await page.click('#btn-bigreveal-next');
  if (await active() !== 'screen-reveal') fail('original: next round should start reveals, got ' + await active());
  await page.click('#btn-abort-round');
  await page.click('#confirm-yes');
  ok('original style: talk screen, starter line, one-tap reveal, no scoring, next round');

  if (errors.length) fail('page errors:\n' + errors.join('\n'));
  console.log('\nALL SMOKE TESTS PASSED');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
