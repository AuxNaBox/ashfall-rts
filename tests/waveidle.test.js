// L5 §18 wave trigger: idle Catapults, Sprayers, Bloaters, Spitters and Leapers
// count AI_L5_IDLE_WEIGHT (0.5) each toward the 14-idle trigger and leave with
// the wave. Crawlers and their passengers still count 0.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;

function boot() {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame('hard');
  const G = RTS.G;
  G.time = 600;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = G.time; G.ai.waveN = 3; }
  for (const u of G.units) { u.x = 16; u.y = 16; u.path = null; u.target = null; u.order = 'idle'; }
  return { RTS, G, hive: G.blds.find(b => b.side === 1 && b.type === 'hq') };
}

function idleAt(hive, RTS, type, n, ox, oy) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = RTS.makeUnit(type, 1, hive.x + (ox + (i % 4) * 0.6) * TILE, hive.y + (oy + Math.floor(i / 4) * 0.6) * TILE);
    u.target = null; u.order = 'idle'; u.path = null;
    out.push(u);
  }
  return out;
}

test('Crawlers and carried passengers are not wave-idle; L5 attack units are', () => {
  const { RTS, hive } = boot();
  const z = idleAt(hive, RTS, 'zombie', 1, 0, 1)[0];
  const crw = idleAt(hive, RTS, 'crawler', 1, 1, 1)[0];
  const cat = idleAt(hive, RTS, 'catapult', 1, 2, 1)[0];
  const sp = idleAt(hive, RTS, 'sprayer', 1, 3, 1)[0];
  const bl = idleAt(hive, RTS, 'bloater', 1, 4, 1)[0];
  const st = idleAt(hive, RTS, 'spitter', 1, 5, 1)[0];
  const lp = idleAt(hive, RTS, 'leaper', 1, 6, 1)[0];
  const cargo = RTS.makeUnit('zombie', 1, crw.x, crw.y);
  assert.ok(RTS.loadUnit(crw, cargo));
  assert.strictEqual(RTS.waveIdleEligible(z), true);
  assert.strictEqual(RTS.waveIdleEligible(crw), false);
  assert.strictEqual(RTS.waveIdleEligible(cargo), false);
  assert.strictEqual(RTS.waveIdleEligible(cat), true);
  assert.strictEqual(RTS.waveIdleEligible(sp), true);
  assert.strictEqual(RTS.waveIdleEligible(bl), true);
  assert.strictEqual(RTS.waveIdleEligible(st), true);
  assert.strictEqual(RTS.waveIdleEligible(lp), true);
});

test('idle L5 attack units count AI_L5_IDLE_WEIGHT each toward the trigger and leave with the wave; Crawlers stay', () => {
  const { RTS, G, hive } = boot();
  // 12 zombies + 5 L5 attack units: weight 12 + 5*0.5 = 14.5 (>= 14). 10+5 would be 12.5 and would not launch.
  const z = idleAt(hive, RTS, 'zombie', 12, 0, 1);
  const cats = idleAt(hive, RTS, 'catapult', 2, 3, 1);
  const sprays = idleAt(hive, RTS, 'sprayer', 1, 5, 1);
  const spit = idleAt(hive, RTS, 'spitter', 1, 6, 1);
  const leaps = idleAt(hive, RTS, 'leaper', 1, 7, 1);
  const crws = idleAt(hive, RTS, 'crawler', 2, -2, 1);
  const cargo = [];
  for (const c of crws) {
    for (let i = 0; i < 3; i++) {
      const u = RTS.makeUnit('zombie', 1, c.x, c.y);
      u.target = null; u.order = 'idle';
      assert.ok(RTS.loadUnit(c, u));
      cargo.push(u);
    }
  }
  // Eligible idle weight: 12z + 2 cat + 1 sprayer + 1 spitter + 1 leaper = 14.5 (>= 14). Cargo and crawlers excluded.
  assert.strictEqual(RTS.waveIdleTotal([...z, ...cats, ...sprays, ...spit, ...leaps, ...crws, ...cargo]), 14.5);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 launches');
  const sent = G.ai.lastWave || [];
  const types = sent.map(u => u.type);
  assert.ok(cats.every(u => sent.includes(u)), 'catapults leave with the wave');
  assert.ok(sprays.every(u => sent.includes(u)), 'sprayer leaves with the wave');
  assert.ok(spit.every(u => sent.includes(u)), 'spitter leaves with the wave');
  assert.ok(leaps.every(u => sent.includes(u)), 'leaper leaves with the wave');
  assert.ok(crws.every(u => !sent.includes(u)), 'crawlers do not leave with the wave');
  assert.ok(cargo.every(u => !sent.includes(u)), 'passengers do not leave with the wave');
  assert.ok(types.filter(t => t === 'zombie').length >= 5, 'classic idle still make up the wave');
});

test('AI_L5_IDLE_WEIGHT is 0.5; L5 attack units weigh 0.5, classics 1, Crawlers and cargo 0', () => {
  const { RTS, hive } = boot();
  assert.strictEqual(RTS.Loop5.D.AI_L5_IDLE_WEIGHT, 0.5);
  const z = idleAt(hive, RTS, 'zombie', 1, 0, 1)[0];
  const cat = idleAt(hive, RTS, 'catapult', 1, 1, 1)[0];
  const sp = idleAt(hive, RTS, 'sprayer', 1, 2, 1)[0];
  const bl = idleAt(hive, RTS, 'bloater', 1, 3, 1)[0];
  const st = idleAt(hive, RTS, 'spitter', 1, 4, 1)[0];
  const lp = idleAt(hive, RTS, 'leaper', 1, 5, 1)[0];
  const crw = idleAt(hive, RTS, 'crawler', 1, 6, 1)[0];
  const cargo = RTS.makeUnit('zombie', 1, crw.x, crw.y);
  assert.ok(RTS.loadUnit(crw, cargo));
  assert.strictEqual(RTS.waveIdleWeight(z), 1);
  for (const u of [cat, sp, bl, st, lp]) assert.strictEqual(RTS.waveIdleWeight(u), 0.5, u.type);
  assert.strictEqual(RTS.waveIdleWeight(crw), 0);
  assert.strictEqual(RTS.waveIdleWeight(cargo), 0);
});

test('14 idle L5 attack units (weight 7) do not meet the 14-idle trigger; 13 classic + 2 L5 (weight 14) do', () => {
  const { RTS, G, hive } = boot();
  idleAt(hive, RTS, 'catapult', 14, 0, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 3, 'weight 7 does not launch wave 4');

  const { RTS: R2, G: G2, hive: h2 } = boot();
  const z = idleAt(h2, R2, 'zombie', 13, 0, 1);
  const one = idleAt(h2, R2, 'catapult', 1, 5, 1);
  assert.strictEqual(R2.waveIdleTotal([...z, ...one]), 13.5);
  R2.updAI(0.5);
  assert.strictEqual(G2.ai.waveN, 3, 'weight 13.5 does not launch');

  const { RTS: R3, G: G3, hive: h3 } = boot();
  const z3 = idleAt(h3, R3, 'zombie', 13, 0, 1);
  const cats = idleAt(h3, R3, 'catapult', 2, 5, 1);
  assert.strictEqual(R3.waveIdleTotal([...z3, ...cats]), 14);
  R3.updAI(0.5);
  assert.strictEqual(G3.ai.waveN, 4, 'weight 14 launches wave 4');
  assert.ok(cats.every(u => (G3.ai.lastWave || []).includes(u)), 'the L5 units still leave with the wave');
});

test('Crawlers still add 0, so they cannot make up a short trigger', () => {
  const { RTS, G, hive } = boot();
  idleAt(hive, RTS, 'zombie', 13, 0, 1);
  idleAt(hive, RTS, 'crawler', 20, -4, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 3, '20 Crawlers do not fill the missing 1 idle');
});

