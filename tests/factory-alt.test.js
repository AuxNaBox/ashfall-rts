// L5 §18 pass 5: after the AI Factory finishes a Loop 5 unit, its next slot
// goes to a Hellbrute if the main wallet can afford one under the reserve rule.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;

function boot(diff) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  G.time = 600;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = 1e9; G.ai.waveN = 3; G.ai.factoryNextBrute = false; }
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  RTS.makeBld('power', 1, hive.tx + 4, hive.ty);
  RTS.makeBld('power', 1, hive.tx + 4, hive.ty + 3);
  RTS.makeBld('refinery', 1, hive.tx + 8, hive.ty);
  RTS.makeBld('factory', 1, hive.tx + 8, hive.ty + 3);
  RTS.makeBld('depot', 1, hive.tx + 12, hive.ty);
  // Satisfy harv >= want (1 pit wants 2 eaters) so the ordinary brute line is not the only path.
  const eaters = G.units.filter(u => u.side === 1 && u.d && u.d.harv && !u.dead).length;
  for (let i = eaters; i < 2; i++) {
    RTS.makeUnit('reaper', 1, hive.x - (i + 1) * TILE, hive.y);
  }
  G.queues[1].vehicle.list = [];
  G.queues[1].vehicle.prog = 0;
  G.queues[1].structure.list = [];
  G.queues[1].structure.ready = null;
  return { RTS, G, hive };
}

function finishL5(RTS, G, type) {
  G.techCredits = Math.max(G.techCredits, (RTS.UDEF[type].cost || 0) + 100);
  assert.ok(RTS.queueItem(1, type), 'queued ' + type);
  const need = RTS.UDEF[type].time / (G.diff.prod || 1) + 0.05;
  RTS.updProduction(need);
  assert.strictEqual(G.queues[1].vehicle.list.length, 0, type + ' finished');
  assert.ok(G.units.some(u => u.side === 1 && u.type === type && !u.dead), type + ' spawned');
}

test('AI_FACTORY_ALT_BRUTE is on', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.AI_FACTORY_ALT_BRUTE, true);
});

test('after a Factory L5 unit finishes, the next slot is a Hellbrute if main can afford one', () => {
  for (const diff of ['easy', 'normal', 'hard']) {
    for (const type of ['crawler', 'catapult', 'sprayer']) {
      const { RTS, G } = boot(diff);
      G.credits[1] = 20000;
      G.techCredits = 20000;
      finishL5(RTS, G, type);
      assert.strictEqual(G.ai.factoryNextBrute, true, diff + ' ' + type + ' sets the flag');
      G.ai.t = 0;
      RTS.updAI(0.5);
      assert.strictEqual(G.queues[1].vehicle.list[0], 'brute', diff + ' ' + type + ' next slot is a Hellbrute');
      assert.strictEqual(G.ai.factoryNextBrute, false, diff + ' ' + type + ' flag clears');
    }
  }
});

test('if main cannot afford a Hellbrute under the reserve rule, the Factory carries on as normal', () => {
  const { RTS, G } = boot('hard');
  G.credits[1] = 0;
  G.techCredits = 20000;
  finishL5(RTS, G, 'crawler');
  assert.strictEqual(G.ai.factoryNextBrute, true);
  G.ai.t = 0;
  RTS.updAI(0.5);
  assert.notStrictEqual(G.queues[1].vehicle.list[0], 'brute', 'no Hellbrute when main cannot pay');
  assert.strictEqual(G.ai.factoryNextBrute, false, 'flag still clears so the Factory is not stuck');
});

test('alternation beats a waiting L5 vehicle and a short harvester count when main can pay', () => {
  const { RTS, G, hive } = boot('hard');
  // Leave only one eater so the ordinary reaper line would want the free slot.
  for (const u of G.units) if (u.side === 1 && u.d && u.d.harv) u.dead = true;
  RTS.makeUnit('reaper', 1, hive.x, hive.y);
  G.credits[1] = 20000;
  G.techCredits = 20000;
  finishL5(RTS, G, 'catapult');
  G.ai.t = 0;
  RTS.updAI(0.5);
  assert.strictEqual(G.queues[1].vehicle.list[0], 'brute', 'Hellbrute takes the next slot ahead of a Reaper');
});
