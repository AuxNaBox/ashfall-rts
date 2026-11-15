// Hard-only CATAPULT_HQ_FLOOR_S = 720: Corpse Catapults skip the player HQ until 12:00
// and take the next target in their priority list. Easy and Normal are unchanged.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32, FLOOR = 720;

function scene(diff, time) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  G.time = time;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = 1e9; }
  // Park starting units far away so they are not a nearer auto-target.
  for (const u of G.units) { u.x = 16; u.y = 16; u.path = null; u.target = null; u.order = 'idle'; }
  const hq = G.blds.find(b => b.side === 0 && b.type === 'hq');
  // Place the turret on the south-east of the HQ so it stays in siege range but farther than the HQ
  // (the catapult stands due north). Prefer the south row so centre-distance and edge-distance both favour the HQ.
  let turret = null;
  for (let r = 1; r < 6 && !turret; r++) {
    const tx = hq.tx + hq.w - 1 + r, ty = hq.ty + hq.h - 1;
    if (RTS.canPlace(0, 'turret', tx, ty, 0)) turret = RTS.makeBld('turret', 0, tx, ty);
  }
  // 8 tiles north of the HQ (player HQ sits in the south). Min range 5, range 11.
  const cat = RTS.makeUnit('catapult', 1, hq.x, hq.y - 8 * TILE);
  // Spotter so allySees covers the HQ and turret (catapult sight is only 6 tiles).
  const spot = RTS.makeUnit('zombie', 1, hq.x, hq.y - 2 * TILE);
  return { RTS, G, hq, turret, cat, spot };
}

function dTiles(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) / TILE; }

test('constant CATAPULT_HQ_FLOOR_S is 720', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.CATAPULT_HQ_FLOOR_S, FLOOR);
});

test('Hard: before 12:00 the catapult skips the HQ and takes the next target', () => {
  const { RTS, G, hq, turret, cat } = scene('hard', FLOOR - 0.5);
  assert.ok(turret, 'need a turret as the next priority target');
  assert.ok(dTiles(cat, hq) >= 5 && dTiles(cat, hq) <= 11, 'HQ in siege range');
  assert.ok(dTiles(cat, turret) >= 5 && dTiles(cat, turret) <= 11, 'turret in siege range');
  assert.ok(dTiles(cat, hq) < dTiles(cat, turret), 'HQ is closer, so it would win without the floor');
  assert.strictEqual(RTS.catapultSkipsHq(cat, hq), true);
  assert.strictEqual(RTS.catapultSkipsHq(cat, turret), false);
  const t = RTS.findEnemy(cat, RTS.rangeOf(cat) * TILE, 1);
  assert.ok(t, 'should acquire a target');
  assert.notStrictEqual(t, hq, 'must skip the HQ before the floor');
  assert.strictEqual(t, turret, 'next priority is the turret');
  cat.target = hq; cat.tmode = 'forced';
  RTS.updAI(0.5);
  assert.notStrictEqual(cat.target, hq, 'forced HQ target is cleared before the floor');
  assert.strictEqual(cat.target, turret, 'AI retargets the turret');
});

test('Hard: at and after 12:00 the catapult uses normal priority, including the HQ', () => {
  for (const time of [FLOOR, FLOOR + 30]) {
    const { RTS, hq, turret, cat } = scene('hard', time);
    assert.strictEqual(RTS.catapultSkipsHq(cat, hq), false, 'no skip at t=' + time);
    const t = RTS.findEnemy(cat, RTS.rangeOf(cat) * TILE, 1);
    assert.strictEqual(t, hq, 'closer HQ is legal at t=' + time);
    cat.target = null;
    RTS.updAI(0.5);
    assert.strictEqual(cat.target, hq, 'AI prefers the HQ (towers list) at t=' + time);
    assert.ok(turret);
  }
});

test('Easy and Normal can target the player HQ before 12:00', () => {
  for (const diff of ['easy', 'normal']) {
    const { RTS, hq, turret, cat } = scene(diff, 600);
    assert.strictEqual(RTS.catapultSkipsHq(cat, hq), false, diff + ' has no floor');
    const t = RTS.findEnemy(cat, RTS.rangeOf(cat) * TILE, 1);
    assert.strictEqual(t, hq, diff + ' finds the closer HQ at 10:00');
    cat.target = null;
    RTS.updAI(0.5);
    assert.strictEqual(cat.target, hq, diff + ' AI may pick the HQ at 10:00');
    assert.ok(turret);
  }
});
