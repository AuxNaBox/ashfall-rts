// L5 §18 pass 4: baseline Spitters (after Acid Glands) and Leapers (after the Bone Forge).
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;
const BASE = { easy: 0, normal: 1, hard: 2 };

function boot(diff) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = 1e9; }
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  for (const t of ['power', 'refinery', 'barracks', 'factory', 'forge']) {
    if (!G.blds.some(b => b.side === 1 && b.type === t && !b.dead)) {
      const b = RTS.makeBld(t, 1, hive.tx + 5, hive.ty + 3);
      if (b) b.bornT = -1e9;
    }
  }
  G.techCredits = 20000;
  G.credits[1] = 20000;
  G.research[1].acid = true;
  G.time = 900;
  return { RTS, G, hive };
}

test('SPITTER_BASELINE and LEAPER_BASELINE are 0 / 1 / 2', () => {
  const { RTS } = load();
  for (const [d, n] of Object.entries(BASE)) {
    assert.strictEqual(RTS.Loop5.D.SPITTER_BASELINE[d], n, 'spitter ' + d);
    assert.strictEqual(RTS.Loop5.D.LEAPER_BASELINE[d], n, 'leaper ' + d);
    assert.strictEqual(RTS.Loop5.spitterBaseline(d), n);
    assert.strictEqual(RTS.Loop5.leaperBaseline(d), n);
  }
});

test('Normal keeps 1 Spitter and 1 Leaper without the old triggers; Hard keeps 2; Easy keeps 0', () => {
  for (const [diff, n] of Object.entries(BASE)) {
    const { RTS, G } = boot(diff);
    // no player heavies, walls, or Artillery
    assert.strictEqual(RTS.spitterWant(), n, diff + ' spitter baseline');
    assert.strictEqual(RTS.leaperWant(), n, diff + ' leaper baseline');
    let spit = 0, leap = 0;
    for (let i = 0; i < 6; i++) {
      if (RTS.spitterWant() > (G.units.filter(u => u.type === 'spitter' && !u.dead).length + G.queues[1].infantry.list.filter(t => t === 'spitter').length)
          && RTS.queueItem(1, 'spitter')) spit++;
      if (RTS.leaperWant() > (G.units.filter(u => u.type === 'leaper' && !u.dead).length + G.queues[1].infantry.list.filter(t => t === 'leaper').length)
          && RTS.queueItem(1, 'leaper')) leap++;
    }
    assert.strictEqual(spit, n, diff + ' spitters queued');
    assert.strictEqual(leap, n, diff + ' leapers queued');
  }
});

function remember(G, units) {
  G.ai.mem = G.ai.mem || {};
  for (const u of units) G.ai.mem[u.id] = { type: u.type, t: G.time, heavy: true, inf: false, x: u.x, y: u.y };
}

test('the heavy / wall triggers still raise Spitters and Leapers to their caps', () => {
  const { RTS, G } = boot('hard');
  const phq = G.blds.find(b => b.side === 0 && b.type === 'hq');
  const tanks = [];
  for (let i = 0; i < 3; i++) tanks.push(RTS.makeUnit('ark', 0, phq.x + i * TILE, phq.y));
  remember(G, tanks);
  // 3 Tanks * 1 per heavy, cap 6 → 3, above the baseline of 2
  assert.strictEqual(RTS.spitterWant(), 3, 'Hard heavy trigger raises Spitters to 3');
  RTS.makeBld('wall', 0, phq.tx + 3, phq.ty);
  // Hard leaper trigger cap is 5 per wave once walls exist
  assert.strictEqual(RTS.leaperWant(), 5, 'Hard walls raise Leapers to the §14 per-wave cap of 5');
});

test('Easy Spitters stay trigger-only: no baseline, but the heavy trigger still works', () => {
  const { RTS, G } = boot('easy');
  G.time = 900; // past Easy spitterFrom 840
  assert.strictEqual(RTS.spitterWant(), 0, 'no heavies, no baseline');
  const phq = G.blds.find(b => b.side === 0 && b.type === 'hq');
  const tanks = [RTS.makeUnit('ark', 0, phq.x, phq.y), RTS.makeUnit('ark', 0, phq.x + TILE, phq.y)];
  remember(G, tanks);
  // 2 Tanks * 0.5 = 1, cap 2
  assert.strictEqual(RTS.spitterWant(), 1, 'Easy trigger want is 1');
});
