/* Five test suites for Imposter Who?
   T1 marathon bookkeeping · T2 player-count edges & multi-imposter
   T3 hostile input & chaos taps · T4 interruptions & recovery
   T5 small screens & landscape */
const { chromium } = require('playwright-core');
// Portable paths: game root is the repo root; Chromium comes from
// CHROMIUM_PATH or the Playwright browsers dir.
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';


let failures = [];
const fail = (suite, msg) => { failures.push(`[${suite}] ${msg}`); console.error(`  ✗ ${msg}`); };
const ok = (msg) => console.log(`  ✓ ${msg}`);

async function newPage(browser, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 390, height: 844 } });
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.dialogAction = 'accept';
  page.on('dialog', (d) => (page.dialogAction === 'accept' ? d.accept() : d.dismiss()));
  await page.goto(GAME_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);
  return page;
}
const active = (page) => page.evaluate(() => document.querySelector('.screen.active').id);
const S = (page, expr) => page.evaluate(new Function('return ' + expr));

async function addPlayers(page, names) {
  await page.click('#btn-new-game');
  await page.evaluate(() => { S.players = []; renderPlayers(); });
  for (const n of names) {
    await page.fill('#player-name-input', n);
    await page.click('.btn-add');
  }
  await page.click('#btn-to-settings');
}

async function holdReveal(page) {
  await page.dispatchEvent('#reveal-card', 'pointerdown');
  await page.waitForSelector('#btn-reveal-done:not([disabled])', { timeout: 4000 });
  await page.dispatchEvent('#reveal-card', 'pointerup');
}

async function revealAll(page) {
  const n = await S(page, 'S.players.length');
  for (let i = 0; i < n; i++) {
    await page.click('#btn-im-ready');
    await holdReveal(page);
    await page.click('#btn-reveal-done');
  }
}

async function voteAll(page, targetFn) {
  while (!(await S(page, 'S.game.voteIdx >= S.game.voters.length'))) {
    const voter = await S(page, 'S.game.voters[S.game.voteIdx]');
    await page.click('#btn-vote-ready');
    let t = targetFn(voter);
    if (t === voter) t = (await S(page, 'S.players.length') + t - 1) % (await S(page, 'S.players.length'));
    const btn = await page.$(`#ballot-grid .ballot-btn[data-i="${t}"]`);
    if (!btn) { const any = await page.$('#ballot-grid .ballot-btn'); await any.click(); }
    else await btn.click();
  }
}

/* ============ T1: 6-round marathon — bookkeeping invariants ============ */
async function T1(browser) {
  console.log('T1: marathon bookkeeping');
  const page = await newPage(browser);
  await addPlayers(page, ['Ana', 'Ben', 'Cleo', 'Dan']);
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; S.settings.mode = 'classic'; S.settings.imposters = 1; saveState(); renderSettings(); });
  const seenWords = [];
  let expectedScores = [0, 0, 0, 0];

  await page.click('#btn-start-game');
  for (let round = 1; round <= 6; round++) {
    const g = await S(page, '({imposters: S.game.imposters, word: S.game.word, round: S.round})');
    if (g.round !== round) fail('T1', `round counter ${g.round}, expected ${round}`);
    seenWords.push(g.word);
    await revealAll(page);
    await page.click('#btn-to-discussion');
    await page.click('#btn-to-vote');
    const imp = g.imposters[0];
    const catchIt = round % 2 === 1; // alternate outcomes
    await voteAll(page, (v) => (catchIt ? imp : (imp + 1) % 4 === v ? (imp + 2) % 4 : (imp + 1) % 4));
    await page.waitForTimeout(400);
    if (catchIt) {
      await page.click('#accused-card');
      await page.waitForTimeout(700);
      await page.click('#btn-results-next');
      await page.click('#btn-guess-ready');
      const wrong = await page.$$('#guess-grid .ballot-btn');
      // pick a deliberately wrong option
      const word = g.word;
      let clicked = false;
      for (const b of wrong) {
        const w = await b.getAttribute('data-w');
        if (w !== word) { await b.click(); clicked = true; break; }
      }
      if (!clicked) fail('T1', 'no wrong guess option found');
      for (let i = 0; i < 4; i++) if (i !== imp) expectedScores[i] += 2;
    } else {
      await page.click('#accused-card');
      await page.waitForTimeout(700);
      await page.click('#btn-results-next');
      expectedScores[imp] += 4;
    }
    const scores = await S(page, 'S.players.map(p=>p.score)');
    if (JSON.stringify(scores) !== JSON.stringify(expectedScores)) fail('T1', `round ${round} scores ${scores} != ${expectedScores}`);
    if (round < 6) await page.click('#btn-next-round');
  }
  const uniq = new Set(seenWords);
  if (uniq.size !== seenWords.length) fail('T1', `word repeated within session: ${seenWords}`);
  // repeat-imposter avoidance can't be asserted (random), but lastImposter must be valid
  const li = await S(page, 'S.lastImposter');
  if (li < 0 || li > 3) fail('T1', 'lastImposter out of range: ' + li);
  if (page.errors.length) fail('T1', 'page errors: ' + page.errors.join(' | '));
  ok('6 rounds, alternating outcomes, scores exact, no word repeats');
  await page.close();
}

/* ============ T2: player-count edges, multi-imposter, all-tied ============ */
async function T2(browser) {
  console.log('T2: edges & multi-imposter');
  const page = await newPage(browser);

  // --- 3 players: 1-1-1 all-tied -> straight to escape ---
  await addPlayers(page, ['A', 'B', 'C']);
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; S.settings.mode = 'classic'; saveState(); renderSettings(); });
  const segs = await page.$$eval('#imposter-picker .seg', (b) => b.map((x) => x.disabled));
  if (JSON.stringify(segs) !== JSON.stringify([false, true, true])) fail('T2', '3p imposter clamp wrong: ' + segs);
  await page.click('#btn-start-game');
  await revealAll(page);
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');
  // ring vote: 0->1, 1->2, 2->0 = 1-1-1
  await voteAll(page, (v) => (v + 1) % 3);
  await page.waitForTimeout(300);
  // first tie -> revote offered; all three tied -> revote has no voters -> escape
  const tieShown = await page.evaluate(() => !document.getElementById('results-msg').classList.contains('hidden'));
  if (!tieShown) fail('T2', 'tie message not shown for 1-1-1');
  await page.click('#btn-results-next'); // Revote -> no voters -> endRound
  if (await active(page) !== 'screen-scoreboard') fail('T2', 'all-tied revote should land on scoreboard, got ' + await active(page));
  const imp3 = (await S(page, 'S.game.imposters'))[0];
  const s3 = await S(page, 'S.players.map(p=>p.score)');
  const exp3 = [0, 0, 0]; exp3[imp3] = 4;
  if (JSON.stringify(s3) !== JSON.stringify(exp3)) fail('T2', `all-tied escape scores ${s3} != ${exp3}`);
  ok('3 players: 1-1-1 deadlock resolves to escape (+4)');

  // --- 7 players, 2 imposters: catch one, other slips ---
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(300);
  await addPlayers(page, ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7']);
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; S.settings.mode = 'classic'; saveState(); renderSettings(); });
  const seg7 = await page.$$eval('#imposter-picker .seg', (b) => b.map((x) => x.disabled));
  if (JSON.stringify(seg7) !== JSON.stringify([false, false, true])) fail('T2', '7p imposter clamp wrong: ' + seg7);
  await page.click('#imposter-picker .seg[data-n="2"]');
  await page.click('#btn-start-game');
  const imps = await S(page, 'S.game.imposters');
  if (imps.length !== 2) fail('T2', 'expected 2 imposters, got ' + imps.length);
  await revealAll(page);
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');
  const caught = imps[0];
  await voteAll(page, () => caught);
  await page.waitForTimeout(300);
  await page.click('#accused-card');
  await page.waitForTimeout(700);
  await page.click('#btn-results-next');
  await page.click('#btn-guess-ready');
  const word7 = await S(page, 'S.game.word');
  await page.click(`#guess-grid .ballot-btn[data-w="${word7.replace(/"/g, '\\"')}"]`);
  const s7 = await S(page, 'S.players.map(p=>p.score)');
  const exp7 = [0, 0, 0, 0, 0, 0, 0].map((_, i) =>
    i === caught ? 2 : imps.includes(i) ? 2 : 2);
  if (JSON.stringify(s7) !== JSON.stringify(exp7)) fail('T2', `2-imposter catch scores ${s7} != ${exp7}`);
  const summary = await page.textContent('#round-summary');
  if (!summary.includes('caught') || !summary.includes('escaped')) fail('T2', 'summary missing caught/escaped tags: ' + summary.trim().slice(0, 120));
  ok('7 players / 2 imposters: catch+steal, co-imposter escapes, labels correct');

  // --- 20 players: cap, ballot scroll, 3 imposters allowed ---
  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(300);
  const twenty = Array.from({ length: 20 }, (_, i) => 'Player' + (i + 1));
  await addPlayers(page, twenty);
  const n20 = await S(page, 'S.players.length');
  if (n20 !== 20) fail('T2', 'expected 20 players, got ' + n20);
  const formHidden = await page.evaluate(() => document.getElementById('add-player-form').style.display === 'none');
  if (!formHidden) fail('T2', 'add form still visible at 20 players');
  // the submit guard is the second line of defense
  await page.evaluate(() => { document.getElementById('player-name-input').value = 'Extra21'; document.getElementById('add-player-form').dispatchEvent(new Event('submit')); });
  if ((await S(page, 'S.players.length')) !== 20) fail('T2', 'submit guard let a 21st player in');
  const seg20 = await page.$$eval('#imposter-picker .seg', (b) => b.map((x) => x.disabled));
  if (JSON.stringify(seg20) !== JSON.stringify([false, false, false])) fail('T2', '20p imposter clamp wrong: ' + seg20);
  await page.click('#imposter-picker .seg[data-n="3"]');
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; saveState(); renderSettings(); });
  await page.click('#btn-start-game');
  if ((await S(page, 'S.game.imposters.length')) !== 3) fail('T2', 'expected 3 imposters at 20 players');
  // check first reveal works, then bail via abort (20 x 0.8s holds is pointless here)
  await page.click('#btn-im-ready');
  await holdReveal(page);
  await page.click('#btn-reveal-done');
  await page.click('#btn-abort-round');
  if (await active(page) !== 'screen-settings') fail('T2', 'abort should land on settings');
  if (page.errors.length) fail('T2', 'page errors: ' + page.errors.join(' | '));
  ok('20-player cap, 3 imposters, abort clean');
  await page.close();
}

/* ============ T3: hostile input & chaos taps ============ */
async function T3(browser) {
  console.log('T3: hostile input & chaos');
  const page = await newPage(browser);

  // XSS attempts as player names (14-char budget each)
  await page.click('#btn-new-game');
  await page.evaluate(() => { S.players = []; renderPlayers(); });
  const evil = ['<img src=x>', '<b>bold</b>', '"onclick="x', "&'<>éø", 'Zoë 💃'];
  for (const n of evil) {
    await page.fill('#player-name-input', n);
    await page.click('.btn-add');
  }
  const count = await S(page, 'S.players.length');
  if (count !== 5) fail('T3', `evil names: expected 5 players, got ${count}`);
  const injected = await page.evaluate(() => document.querySelector('#player-list img, #player-list b') !== null);
  if (injected) fail('T3', 'HTML injected via player name');
  const shown = await page.textContent('#player-list');
  if (!shown.includes('<img src=x>')) fail('T3', 'raw name not displayed as text');
  ok('XSS names render inert as literal text');

  // whitespace-only and 40-char names
  await page.fill('#player-name-input', '   ');
  await page.click('.btn-add');
  if ((await S(page, 'S.players.length')) !== 5) fail('T3', 'whitespace name accepted');
  await page.fill('#player-name-input', 'A'.repeat(40));
  await page.click('.btn-add');
  const longest = await S(page, 'Math.max(...S.players.map(p=>p.name.length))');
  if (longest > 14) fail('T3', 'name longer than 14 stored');
  ok('whitespace rejected, long names clamped');

  // start a round and chaos-tap through it with coordinate double-taps
  await page.click('#btn-to-settings');
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; S.settings.mode = 'classic'; saveState(); renderSettings(); });
  const dbl = async (sel) => {
    await page.waitForTimeout(400); // let any prior navigation shield lift
    const box = await (await page.$(sel)).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2); // shield should eat this
  };
  await dbl('#btn-start-game');
  await page.waitForTimeout(400);
  if (await active(page) !== 'screen-reveal') fail('T3', 'double-tap start broke nav: ' + await active(page));
  const roundAfterDbl = await S(page, 'S.round');
  if (roundAfterDbl !== 1) fail('T3', `double-tap started ${roundAfterDbl} rounds`);
  await revealAll(page);
  await dbl('#btn-to-discussion');
  await page.waitForTimeout(400);
  if (await active(page) !== 'screen-discuss') fail('T3', 'double-tap skipped discussion: ' + await active(page));
  await page.click('#btn-to-vote');
  const imp = (await S(page, 'S.game.imposters'))[0];
  await voteAll(page, () => imp);
  await page.waitForTimeout(400);
  // hammer the accused card
  await page.click('#accused-card');
  await page.click('#accused-card');
  await page.click('#accused-card');
  await page.waitForTimeout(800);
  await dbl('#btn-results-next');
  await page.waitForTimeout(400);
  if (await active(page) !== 'screen-guess') fail('T3', 'results double-tap broke nav: ' + await active(page));
  await page.click('#btn-guess-ready');
  // rapid-fire two different guess options — only first must count
  const opts = await page.$$('#guess-grid .ballot-btn');
  const b1 = await opts[0].boundingBox();
  const b2 = await opts[1].boundingBox();
  await page.mouse.click(b1.x + 5, b1.y + 5);
  await page.mouse.click(b2.x + 5, b2.y + 5);
  await page.waitForTimeout(500);
  if (await active(page) !== 'screen-scoreboard') fail('T3', 'guess did not land on scoreboard: ' + await active(page));
  const total = await S(page, 'S.players.reduce((a,p)=>a+p.score,0)');
  const nPl = await S(page, 'S.players.length');
  if (total > 2 * (nPl - 1) + 2) fail('T3', `double-guess double-scored: total=${total} with ${nPl} players`);
  if (page.errors.length) fail('T3', 'page errors: ' + page.errors.join(' | '));
  ok('chaos taps: nav intact, no double-scoring, zero page errors');
  await page.close();
}

/* ============ T4: interruptions & recovery ============ */
async function T4(browser) {
  console.log('T4: interruptions & recovery');
  const page = await newPage(browser);

  // corrupted localStorage variants must not brick boot
  for (const garbage of ['not json{{{', '{"names":123}', '{"usedWords":{"0":5,"1":"x"}}', '{"names":["a","b","c"],"scores":"x","round":-2,"settings":{"timer":"soon","imposters":9,"categories":"all"}}']) {
    await page.evaluate((v) => localStorage.setItem('imposterwho.v1', v), garbage);
    await page.reload();
    await page.waitForTimeout(250);
    if (await active(page) !== 'screen-home') fail('T4', `corrupt storage broke boot: ${garbage.slice(0, 30)}`);
  }
  if (page.errors.length) { fail('T4', 'corrupt-storage errors: ' + page.errors.join(' | ')); page.errors.length = 0; }
  ok('4 corrupted-storage variants boot clean');

  await page.evaluate(() => localStorage.clear());
  await page.reload(); await page.waitForTimeout(250);

  // play one round, reload at scoreboard, Continue game must resume scores+round
  await addPlayers(page, ['Ana', 'Ben', 'Cleo', 'Dan']);
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 0; S.settings.mode = 'classic'; saveState(); renderSettings(); });
  await page.click('#btn-start-game');
  const imp = (await S(page, 'S.game.imposters'))[0];
  await revealAll(page);
  await page.click('#btn-to-discussion');
  await page.click('#btn-to-vote');
  await voteAll(page, () => imp);
  await page.waitForTimeout(300);
  await page.click('#accused-card'); await page.waitForTimeout(700);
  await page.click('#btn-results-next');
  await page.click('#btn-guess-ready');
  const word = await S(page, 'S.game.word');
  await page.click(`#guess-grid .ballot-btn[data-w="${word.replace(/"/g, '\\"')}"]`);
  const scoresBefore = await S(page, 'S.players.map(p=>p.score)');
  await page.reload(); await page.waitForTimeout(300);
  if (await active(page) !== 'screen-home') fail('T4', 'reload should land home');
  const contVisible = await page.evaluate(() => !document.getElementById('btn-continue').classList.contains('hidden'));
  if (!contVisible) fail('T4', 'Continue game not offered after reload');
  await page.click('#btn-continue');
  const restored = await S(page, 'S.players.map(p=>p.score)');
  if (JSON.stringify(restored) !== JSON.stringify(scoresBefore)) fail('T4', `scores lost on reload: ${restored} != ${scoresBefore}`);
  const label = await page.textContent('#btn-start-game');
  if (!label.includes('round 2')) fail('T4', 'settings should offer round 2, says: ' + label);
  ok('reload at scoreboard -> Continue game restores scores & round');

  // back-gesture mid-reveal: dismiss keeps the round, accept aborts it
  await page.click('#btn-start-game');
  await page.click('#btn-im-ready');
  page.dialogAction = 'dismiss';
  await page.goBack();
  await page.waitForTimeout(300);
  if (!(await S(page, 'S.game !== null'))) fail('T4', 'dismissed back-abort still killed the round');
  if (await active(page) !== 'screen-reveal') fail('T4', 'declined abort left reveal screen: ' + await active(page));
  page.dialogAction = 'accept';
  await page.goBack();
  await page.waitForTimeout(300);
  if (await S(page, 'S.game !== null')) fail('T4', 'accepted back-abort did not end round');
  if (await active(page) !== 'screen-settings') fail('T4', 'accepted abort should land settings: ' + await active(page));
  if ((await S(page, 'S.round')) !== 1) fail('T4', 'aborted round not rolled back');
  ok('back-gesture: dismiss keeps round, accept aborts cleanly');

  // end-game confirm declined keeps scoreboard; timer expiry harmless
  await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 2; renderSettings(); });
  await page.click('#btn-start-game');
  await revealAll(page);
  await page.click('#btn-to-discussion');
  await page.waitForTimeout(2600); // let the 2s timer expire + beep path run
  const num = await page.textContent('#timer-num');
  if (num.trim() !== '0') fail('T4', 'timer did not hit 0: ' + num);
  await page.click('#btn-to-vote');
  const imp2 = (await S(page, 'S.game.imposters'))[0];
  await voteAll(page, () => imp2);
  await page.waitForTimeout(300);
  await page.click('#accused-card'); await page.waitForTimeout(700);
  await page.click('#btn-results-next');
  await page.click('#btn-guess-ready');
  await page.click('#guess-grid .ballot-btn');
  page.dialogAction = 'dismiss';
  await page.click('#btn-end-game');
  await page.waitForTimeout(200);
  if (await active(page) !== 'screen-scoreboard') fail('T4', 'declined end-game left scoreboard');
  page.dialogAction = 'accept';
  await page.click('#btn-end-game');
  await page.waitForTimeout(300);
  if (await active(page) !== 'screen-final') fail('T4', 'accepted end-game should land final');
  if (page.errors.length) fail('T4', 'page errors: ' + page.errors.join(' | '));
  ok('timer expiry, declined/accepted end-game all clean');
  await page.close();
}

/* ============ T5: small screens & landscape ============ */
async function T5(browser) {
  console.log('T5: small screens & landscape');
  for (const [w, h, tag] of [[320, 568, 'SE portrait'], [844, 390, 'landscape'], [360, 640, 'small android']]) {
    const page = await newPage(browser, { width: w, height: h });
    await addPlayers(page, Array.from({ length: 10 }, (_, i) => 'Player' + (i + 1)));
    await page.evaluate(() => { S.settings.gameStyle = 'evolution'; S.settings.timer = 60; S.settings.mode = 'classic'; saveState(); renderSettings(); });
    await page.click('#btn-start-game');

    const noHscroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    if (!noHscroll) fail('T5', `${tag}: horizontal overflow on reveal`);

    // primary button must be clickable (auto-scrolls into view if needed)
    await page.click('#btn-im-ready', { timeout: 5000 }).catch(() => fail('T5', `${tag}: I'm-ready unreachable`));
    await holdReveal(page).catch(() => fail('T5', `${tag}: hold-to-reveal broken`));
    await page.click('#btn-reveal-done', { timeout: 5000 }).catch(() => fail('T5', `${tag}: Got-it unreachable`));
    // remaining 9 players
    for (let i = 1; i < 10; i++) {
      await page.click('#btn-im-ready');
      await holdReveal(page);
      await page.click('#btn-reveal-done');
    }
    await page.click('#btn-to-discussion', { timeout: 5000 }).catch(() => fail('T5', `${tag}: discuss btn unreachable`));
    await page.click('#btn-to-vote', { timeout: 5000 }).catch(() => fail('T5', `${tag}: vote btn unreachable`));
    // 9-candidate ballot must be fully votable — click the LAST candidate
    await page.click('#btn-vote-ready');
    const btns = await page.$$('#ballot-grid .ballot-btn');
    if (btns.length !== 9) fail('T5', `${tag}: expected 9 ballot options, got ${btns.length}`);
    await btns[btns.length - 1].click({ timeout: 5000 }).catch(() => fail('T5', `${tag}: last ballot option unreachable`));
    const v0 = await S(page, 'S.game.votes.filter(v=>v>=0).length');
    if (v0 !== 1) fail('T5', `${tag}: vote not recorded`);
    if (page.errors.length) fail('T5', `${tag}: page errors: ` + page.errors.join(' | '));
    ok(`${tag} (${w}x${h}): reachable, votable, no overflow`);
    await page.close();
  }
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  for (const t of [T1, T2, T3, T4, T5]) {
    try { await t(browser); }
    catch (e) { fail(t.name, 'crashed: ' + e.message.split('\n')[0]); }
  }
  await browser.close();
  console.log(failures.length ? `\n${failures.length} FAILURE(S):\n` + failures.join('\n') : '\nALL 5 SUITES PASSED');
  process.exit(failures.length ? 1 : 0);
})();
