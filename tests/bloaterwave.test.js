// L5 §18: at most 2 Bloaters per wave, with the existing alive cap of 6.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;

test('constant BLOATER_PER_WAVE is 2 and the alive cap stays 6', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.BLOATER_PER_WAVE, 2);
  assert.strictEqual(RTS.UDEF.bloater.limit, 6);
  assert.strictEqual(RTS.Loop5.D.DEMO_LIMIT, 6);
});

test('capWaveBloaters keeps at most 2 Bloaters', () => {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame('hard');
  const hive = RTS.G.blds.find(b => b.side === 1 && b.type === 'hq');
  const list = [];
  for (let i = 0; i < 10; i++) list.push(RTS.makeUnit(i < 5 ? 'bloater' : 'zombie', 1, hive.x, hive.y));
  const capped = RTS.capWaveBloaters(list);
  assert.strictEqual(capped.filter(u => u.type === 'bloater').length, 2);
  assert.strictEqual(capped.filter(u => u.type === 'zombie').length, 5);
});

test('a wave that has 5 idle Bloaters takes only 2 of them', () => {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame('hard');
  const G = RTS.G;
  G.time = 700;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = G.time; G.ai.waveN = 3; }
  for (const u of G.units) { u.x = 16; u.y = 16; u.path = null; u.target = null; u.order = 'idle'; }
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  const z = [], bl = [];
  for (let i = 0; i < 14; i++) {
    const u = RTS.makeUnit('zombie', 1, hive.x + (i % 5) * TILE, hive.y + Math.floor(i / 5) * TILE);
    u.target = null; u.order = 'idle'; u.path = null; z.push(u);
  }
  for (let i = 0; i < 5; i++) {
    const u = RTS.makeUnit('bloater', 1, hive.x - (i + 1) * TILE, hive.y);
    u.target = null; u.order = 'idle'; u.path = null; bl.push(u);
  }
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 launches');
  const sent = G.ai.lastWave || [];
  assert.strictEqual(sent.filter(u => u.type === 'bloater').length, 2, 'only 2 Bloaters leave');
  const left = bl.filter(u => !sent.includes(u));
  assert.strictEqual(left.length, 3, 'the other 3 stay home');
});

test('the 7th Bloater is rejected by the alive cap of 6', () => {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame('hard');
  const G = RTS.G;
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  // Factory is required to train Bloaters
  const fac = RTS.makeBld('factory', 1, hive.tx + 5, hive.ty);
  if (fac) fac.bornT = -1e9;
  G.techCredits = 10000;
  G.credits[1] = 10000;
  for (let i = 0; i < 6; i++) RTS.makeUnit('bloater', 1, hive.x, hive.y);
  assert.strictEqual(RTS.atLimit(1, 'bloater'), true);
  assert.strictEqual(RTS.queueItem(1, 'bloater'), false);
});

function readyBloaterAi(RTS, G) {
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  for (const t of ['power', 'refinery', 'barracks', 'factory']) {
    if (!G.blds.some(b => b.side === 1 && b.type === t && !b.dead)) {
      const b = RTS.makeBld(t, 1, hive.tx + 6, hive.ty + 4);
      if (b) b.bornT = -1e9;
    }
  }
  G.techCredits = 20000;
  G.credits[1] = 20000;
  G.time = 700;
  if (G.ai) { G.ai.t = 0; G.ai.bloaterTrainN = 0; }
  return hive;
}

test('Bloaters train at most 2 per wave and do not refill to the alive cap', () => {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame('hard');
  const G = RTS.G;
  const hive = readyBloaterAi(RTS, G);
  // force the trigger (whenWallsOrTowers: 2 on Hard) with two player turrets
  const phq = G.blds.find(b => b.side === 0 && b.type === 'hq');
  RTS.makeBld('turret', 0, phq.tx + 4, phq.ty);
  RTS.makeBld('turret', 0, phq.tx + 7, phq.ty);

  let trained = 0;
  for (let i = 0; i < 8; i++) {
    if (RTS.canTrainBloater() && RTS.queueItem(1, 'bloater')) { RTS.noteBloaterTrained(); trained++; }
  }
  assert.strictEqual(trained, 2, 'only 2 trained this wave');
  assert.strictEqual(G.ai.bloaterTrainN, 2);
  assert.strictEqual(RTS.canTrainBloater(), false);

  // finish the two in queue so they are alive, then kill them; still no refill
  const q = G.queues[1].infantry;
  q.list = []; q.prog = 0;
  const made = [];
  for (let i = 0; i < 2; i++) made.push(RTS.makeUnit('bloater', 1, hive.x, hive.y));
  for (const u of made) RTS.kill(u, null, 'rifle');
  assert.strictEqual(G.units.filter(u => u.side === 1 && u.type === 'bloater' && !u.dead).length, 0);
  assert.strictEqual(RTS.canTrainBloater(), false, 'deaths do not open a refill slot');

  // a new wave resets the per-wave counter (queued ones still count against the next quota)
  G.ai.waveN = 4;
  RTS.resetBloaterTrain();
  assert.strictEqual(G.ai.bloaterTrainN, 0);
  assert.strictEqual(RTS.canTrainBloater(), true);
  let trained2 = 0;
  for (let i = 0; i < 5; i++) {
    if (RTS.canTrainBloater() && RTS.queueItem(1, 'bloater')) { RTS.noteBloaterTrained(); trained2++; }
  }
  assert.strictEqual(trained2, 2, 'the next wave can train 2 more');
});
