// Bug fix regression: on Easy (income x0.75) and Hard (x1.35) the AI's Credits stalled at 1,999.x under the 2,000 HQ cap
// (truck unloads rounded the cargo taken down), so it never afforded the 2,000 Grinder Pit and sent no waves.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { load } = require('./harness.js');

for (const diff of ['easy', 'normal', 'hard']) {
  test(`AI on ${diff}: Credits reach 2,000, builds the Grinder Pit, sends wave 1 on schedule`, () => {
    const { RTS, seed } = load(); seed(1);
    RTS.newGame(diff);
    const G = RTS.G, end = G.diff.firstWave + 15;
    let maxCr = 0, pitAt = null;
    while (G.time < end && !G.over) {
      RTS.step(1 / 30);
      maxCr = Math.max(maxCr, G.credits[1]);
      if (pitAt === null && G.blds.some(b => b.side === 1 && b.type === 'refinery' && !b.dead)) pitAt = G.time;
    }
    assert.ok(maxCr >= 2000 - 1e-9, `${diff}: AI Credits peaked at ${maxCr}`);
    assert.ok(pitAt !== null, `${diff}: Grinder Pit built`);
    assert.ok(G.ai.waveN >= 1, `${diff}: wave 1 sent`);
    assert.ok(Math.abs(G.ai.wave1At - G.diff.firstWave) <= 5, `${diff}: wave 1 at ${G.ai.wave1At}, scheduled ${G.diff.firstWave}`);
  });
}
