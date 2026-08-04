# Tests

Headless-browser tests for the Imposter Who? game (Playwright + Chromium).

```bash
npm i playwright-core        # once
node tests/smoke.js          # quick end-to-end playthrough of every path
node tests/fulltest.js       # 5 suites: marathon scoring, player-count edges,
                             # hostile input/chaos taps, interruption recovery,
                             # small screens & landscape
node tests/persona.js 42     # seeded "chaotic human" simulation (3 full games
                             # with double-taps, reloads, aborts); any seed works
```

Set `CHROMIUM_PATH` if Chromium isn't in the default Playwright location.
