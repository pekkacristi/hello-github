/* Persona simulation: "Mia", a party host with a phone, chaotic friends and
   no patience. Seeded RNG drives realistic-but-messy behavior:
   too-short card holds, double-taps, emoji names, changed minds on confirm
   dialogs, app-switch reloads mid-round, rage-quit aborts.
   Invariants are checked after every single action. */
const { chromium } = require('playwright-core');
// Portable paths: game root is the repo root; Chromium comes from
// CHROMIUM_PATH or the Playwright browsers dir.
const path = require('path');
const GAME_URL = 'file://' + path.resolve(__dirname, '..', 'index.html');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';


const SEED = Number(process.argv[2] || 42);
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(SEED);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
const chance = (p) => rnd() < p;

const NAMES = ['Mia', 'Théo', 'Zoë 💃', 'Kai', 'Sofía', 'Jack', 'Nadia', 'Ravi', '李雷', 'Olá!', 'Gran 👵', 'Bo'];
const log = [];
const say = (m) => { log.push(m); if (log.length <= 400) console.log('  ' + m); };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  let dialogAction = 'accept';
  page.on('dialog', (d) => (dialogAction === 'accept' ? d.accept() : d.dismiss()));

  await page.goto(GAME_URL);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(300);

  const active = () => page.evaluate(() => document.querySelector('.screen.active')?.id);
  const vis = (sel) => page.evaluate((s) => {
    const el = document.querySelector(s);
    return el && el.offsetParent !== null && !el.disabled;
  }, sel);
  const st = (expr) => page.evaluate(new Function('return ' + expr));

  const doubleTapMaybe = async (sel) => {
    const el = await page.$(sel);
    if (!el) return false;
    if (chance(0.15)) {
      const b = await el.boundingBox();
      if (b) {
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
        return true;
      }
    }
    await page.click(sel, { timeout: 8000 });
    return true;
  };

  let gamesFinished = 0;
  let roundsPlayed = 0;
  let steps = 0;
  let lastScreen = '';
  let sameScreen = 0;
  const fails = [];

  const invariant = async () => {
    if (errors.length) { fails.push('page errors: ' + errors.join(' | ')); errors.length = 0; }
    const okState = await page.evaluate(() => {
      if (!document.querySelector('.screen.active')) return 'no active screen';
      if (S.players.some((p) => !Number.isFinite(p.score) || p.score < 0)) return 'bad score: ' + JSON.stringify(S.players);
      if (S.game) {
        const n = S.players.length;
        if (S.game.revealIdx < 0 || S.game.revealIdx > n) return 'revealIdx out of range';
        if (S.game.imposters.some((i) => i < 0 || i >= n)) return 'imposter idx out of range';
      }
      return null;
    });
    if (okState) fails.push(okState + ' @step ' + steps);
  };

  while (gamesFinished < 3 && roundsPlayed < 14 && steps < 900 && !fails.length) {
    steps++;
    // a confirm sheet interrupts whatever Mia was doing
    if (await page.evaluate(() => !document.getElementById('confirm-modal').classList.contains('hidden'))) {
      if (chance(0.75)) { await page.click('#confirm-yes'); say('  …confirms'); }
      else { await page.click('#confirm-no'); say('  …changes her mind'); }
      await invariant();
      continue;
    }
    const screen = await active();
    if (screen === lastScreen) { if (++sameScreen > 80) { fails.push(`stuck on ${screen} for 80 steps`); break; } }
    else { sameScreen = 0; lastScreen = screen; }

    switch (screen) {
      case 'screen-home': {
        if (chance(0.1)) { await page.click('#btn-howto'); await page.waitForTimeout(250); await page.click('#btn-close-howto'); say('Mia skims the rules again'); }
        if (await vis('#btn-continue') && chance(0.5)) { say('Mia continues the interrupted game'); await page.click('#btn-continue'); }
        else { say('Mia starts a new game'); await page.click('#btn-new-game'); }
        break;
      }
      case 'screen-players': {
        const n = await st('S.players.length');
        if (n < 3 || (n < 7 && chance(0.6))) {
          const name = pick(NAMES) + (chance(0.3) ? String(Math.floor(rnd() * 9)) : '');
          await page.fill('#player-name-input', name);
          if (chance(0.5)) await page.press('#player-name-input', 'Enter');
          else await page.click('.btn-add');
          say(`adds "${name}" (${await st('S.players.length')} players)`);
        } else if (n > 3 && chance(0.12)) {
          await page.click('.btn-remove');
          say('removes a player who left the room');
        } else if (await vis('#btn-to-settings')) {
          await page.click('#btn-to-settings');
          say('done with the roster → setup');
        }
        break;
      }
      case 'screen-settings': {
        if (chance(0.4)) { const chips = await page.$$('#category-grid .cat-chip'); await pick(chips).click(); say('fiddles with categories'); }
        if (chance(0.3)) { const segs = await page.$$('#imposter-picker .seg:not([disabled])'); await pick(segs).click(); say('changes imposter count'); }
        if (chance(0.4)) { const modes = await page.$$('#mode-cards .mode-card'); await pick(modes).click(); say('switches imposter mode'); }
        if (chance(0.5)) { const styles = await page.$$('#style-cards .mode-card'); await pick(styles).click(); say(`picks ${await st("S.settings.gameStyle")} style`); }
        if (chance(0.3)) { const ts = await page.$$('#timer-picker .seg'); await pick(ts).click(); say('changes the timer'); }
        // mostly keep the timer off so the sim doesn't idle
        if (chance(0.8)) await page.evaluate(() => { S.settings.timer = 0; renderSettings(); });
        await page.waitForTimeout(150);
        await doubleTapMaybe('#btn-start-game');
        say(`starts round ${await st('S.round')} (${await st('S.settings.mode')}, ${await st('S.game ? S.game.imposters.length : "?"')} imposter(s))`);
        break;
      }
      case 'screen-reveal': {
        if (!(await st('S.game'))) break; // aborted between checks
        if (chance(0.02)) { say('📵 phone rings — Mia quits the round'); await page.click('#btn-abort-round'); break; }
        if (chance(0.02)) { say('📲 app-switch! page reloads mid-reveal'); await page.reload(); await page.waitForTimeout(350); break; }
        if (await vis('#btn-im-ready')) {
          await page.click('#btn-im-ready');
          say(`passes the phone (peek ${await st('S.game ? S.game.revealIdx + 1 : "?"')}/${await st('S.players.length')})`);
        } else {
          // hold like a human: sometimes too short, then again
          let held = 0;
          while (!(await vis('#btn-reveal-done'))) {
            const ms = 200 + Math.floor(rnd() * 1100);
            await page.dispatchEvent('#reveal-card', 'pointerdown');
            await page.waitForTimeout(ms);
            await page.dispatchEvent('#reveal-card', 'pointerup');
            held += ms;
            if (held > 200 && held < 800) say(`  (held ${ms}ms — too quick, peeks again)`);
            if (held > 5000) { fails.push('hold gate never unlocked'); break; }
          }
          await doubleTapMaybe('#btn-reveal-done');
        }
        break;
      }
      case 'screen-clues': {
        say('🗣️ table gives their one-word clues');
        await doubleTapMaybe('#btn-to-discussion');
        break;
      }
      case 'screen-discuss': {
        await page.waitForTimeout(200 + rnd() * 500);
        say('🔥 accusations fly — time to vote');
        await doubleTapMaybe('#btn-to-vote');
        break;
      }
      case 'screen-vote': {
        if (await vis('#btn-vote-ready')) {
          await page.click('#btn-vote-ready');
        } else {
          const btns = await page.$$('#ballot-grid .ballot-btn');
          if (btns.length) { await pick(btns).click(); say('  someone votes in secret'); }
        }
        break;
      }
      case 'screen-results': {
        if (await vis('#accused-card') && !(await page.evaluate(() => document.getElementById('accused-card').classList.contains('flipped')))) {
          await page.waitForTimeout(600);
          await page.click('#accused-card');
          say('😱 the card flips…');
          await page.waitForTimeout(700);
        } else if (await vis('#btn-results-next')) {
          await doubleTapMaybe('#btn-results-next');
        } else { await page.waitForTimeout(250); }
        break;
      }
      case 'screen-guess': {
        if (await vis('#btn-guess-ready')) { say('🚨 caught! one last guess'); await page.click('#btn-guess-ready'); }
        else {
          const opts = await page.$$('#guess-grid .ballot-btn');
          if (opts.length) { await pick(opts).click(); say('  imposter takes a wild guess'); }
        }
        break;
      }
      case 'screen-scoreboard': {
        roundsPlayed++;
        say(`📊 round done — scores: ${await st("S.players.map(p=>p.name.slice(0,6)+':'+p.score).join(' ')")}`);
        if (chance(0.05)) { say('📲 phone dies at the scoreboard, reload'); await page.reload(); await page.waitForTimeout(350); break; }
        if (chance(0.12)) {
          say('…Mia almost ends the game, then changes her mind');
          await page.click('#btn-end-game'); await page.waitForTimeout(150);
          await page.click('#confirm-no'); await page.click('#btn-next-round');
        } else if (roundsPlayed % 4 === 3 || chance(0.25)) {
          await page.click('#btn-end-game'); say('🏁 game over, crowning the winner');
        } else {
          await doubleTapMaybe('#btn-next-round');
        }
        break;
      }
      case 'screen-bigreveal': {
        roundsPlayed++;
        say(`🥁 original-style reveal (round ${await st('S.round')})`);
        if (chance(0.3)) { await page.click('#btn-bigreveal-setup'); say('back to setup'); }
        else { await doubleTapMaybe('#btn-bigreveal-next'); say('next round!'); }
        break;
      }
      case 'screen-final': {
        gamesFinished++;
        say(`🏆 game ${gamesFinished} finished after ${roundsPlayed} total rounds`);
        if (chance(0.5)) { await page.click('#btn-play-again'); say('rematch!'); }
        else { await page.click('#btn-final-home'); say('back to the couch'); }
        break;
      }
      default:
        fails.push('unknown screen: ' + screen);
    }
    await invariant();
  }

  if (steps >= 900) fails.push('exceeded 900 steps without finishing 3 games');
  if (gamesFinished < 3 && roundsPlayed < 6) fails.push('too little play: ' + roundsPlayed + ' rounds');
  console.log(`\nseed=${SEED} steps=${steps} games=${gamesFinished} rounds=${roundsPlayed}`);
  if (fails.length) { console.log('PERSONA FAILURES:\n' + fails.join('\n')); process.exit(1); }
  console.log('PERSONA SIMULATION CLEAN');
  await browser.close();
})().catch((e) => { console.error('crash:', e.message); process.exit(1); });
