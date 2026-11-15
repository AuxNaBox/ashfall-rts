// Loop 5 visual layer: decal emitters, damage-state 50% / 25% thresholds, spawn points.
// Visuals only — seeded sim results must match a run that never ticks the FX layer.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');
const Loop5 = require('../loop5.js');
const FX = require('../loop5-fx.js');

test('L5 damage-state thresholds: idle at 50%, damaged below 50%, critical at 25%', () => {
  assert.equal(Loop5.D.DMG_STATE_DAMAGED, 0.5);
  assert.equal(Loop5.D.DMG_STATE_CRITICAL, 0.25);
  assert.equal(FX.dmgStateOf(100, 100), 0);
  assert.equal(FX.dmgStateOf(50, 100), 0);
  assert.equal(FX.dmgStateOf(49.9, 100), 1);
  assert.equal(FX.dmgStateOf(25.1, 100), 1);
  assert.equal(FX.dmgStateOf(25, 100), 2);
  assert.equal(FX.dmgStateOf(0, 100), 2);
  assert.equal(Loop5.dmgStateOf(25, 100), 2);
});

test('setDmgState writes 0 / 1 / 2 at those thresholds', () => {
  const { RTS } = load();
  RTS.newArena(1);
  const b = RTS.makeBld('hq', 0, 4, 4);
  assert.equal(b.dmgState, 0);
  b.hp = b.maxhp * 0.5; RTS.setDmgState(b); assert.equal(b.dmgState, 0);
  b.hp = b.maxhp * 0.499; RTS.setDmgState(b); assert.equal(b.dmgState, 1);
  b.hp = b.maxhp * 0.25; RTS.setDmgState(b); assert.equal(b.dmgState, 2);
  b.hp = b.maxhp; RTS.setDmgState(b); assert.equal(b.dmgState, 0);
});

test('spawn points: procedural fallback is stable; per-building metadata wins', () => {
  const a = { type: 'factory', w: 3, h: 3, tx: 10, ty: 12, x: 10 * 32 + 48, y: 12 * 32 + 48, d: {} };
  const p1 = FX.spawnPoints(a), p2 = FX.spawnPoints(a);
  assert.ok(p1.length >= 2 && p1.length <= 4);
  assert.deepEqual(p1, p2);
  for (const p of p1) {
    assert.ok(p.x >= 10 * 32 && p.x <= 13 * 32);
    assert.ok(p.y >= 12 * 32 && p.y <= 15 * 32);
    assert.ok(p.k === 'fire' || p.k === 'smoke');
  }
  const meta = { type: 'hq', w: 3, h: 3, tx: 0, ty: 0, x: 48, y: 48, d: { fxPoints: [{ x: 10, y: 12, k: 'fire' }, { x: 20, y: 8, k: 'smoke' }] } };
  const m = FX.spawnPoints(meta);
  assert.equal(m.length, 2);
  assert.equal(m[0].x, 10); assert.equal(m[0].k, 'fire');
  assert.equal(m[1].k, 'smoke');
});

test('tread emitter: spacing follows the step and heading, marks fade and cap', () => {
  FX.reset();
  const step = Loop5.D.TREAD_STEP_PX;
  const u = { type: 'ark', moving: true, dead: false, carried: false, x: 0, y: 0, ang: Math.PI / 2, d: { cat: 'vehicle' } };
  const G = { units: [u], blds: [], time: 0 };
  FX.tick(G, { time: 0, dt: 1 / 30 });
  assert.equal(FX.counts().treads, 1);
  const first = FX.pool.decals.find(d => !d.dead && d.k === 'tread');
  assert.ok(Math.abs(first.a - Math.PI / 2) < 1e-9);
  // a move shorter than the step emits nothing
  u.x = step * 0.4; FX.tick(G, { time: 1, dt: 1 / 30 });
  assert.equal(FX.counts().treads, 1);
  u.x = step * 1.1; FX.tick(G, { time: 2, dt: 1 / 30 });
  assert.equal(FX.counts().treads, 2);
  // fade
  FX.tick(G, { time: 2 + Loop5.D.DECAL_FADE_TRACK + 0.01, dt: 1 / 30 });
  assert.equal(FX.counts().treads, 0);
  // cap
  FX.reset();
  for (let i = 0; i < Loop5.D.TREAD_CAP + 25; i++) {
    u.x = i * step * 1.5; FX.tick(G, { time: 10 + i, dt: 1 / 30 });
  }
  assert.ok(FX.counts().treads <= Loop5.D.TREAD_CAP);
  assert.ok(FX.pool.decals.filter(d => !d.dead && d.k === 'tread').length <= Loop5.D.TREAD_CAP);
});

test('crater and scorch emitters are deterministic, faded and capped', () => {
  FX.reset();
  FX.addCrater(100, 200, { large: true, born: 0 });
  FX.addScorch(50, 50, { r: 12, born: 0 });
  const a = JSON.parse(JSON.stringify(FX.pool.decals.filter(d => !d.dead).map(d => ({ k: d.k, x: d.x, y: d.y, r: d.r, large: !!d.large }))));
  FX.reset();
  FX.addCrater(100, 200, { large: true, born: 0 });
  FX.addScorch(50, 50, { r: 12, born: 0 });
  const b = JSON.parse(JSON.stringify(FX.pool.decals.filter(d => !d.dead).map(d => ({ k: d.k, x: d.x, y: d.y, r: d.r, large: !!d.large }))));
  assert.deepEqual(a, b);
  assert.ok(a.some(d => d.k === 'crater' && d.large));
  assert.ok(a.some(d => d.k === 'scorch'));
  // fade out
  FX.tick({ units: [], blds: [], time: Loop5.D.DECAL_FADE_SCORCH + 0.1 }, { time: Loop5.D.DECAL_FADE_SCORCH + 0.1, dt: 1 / 30 });
  assert.equal(FX.counts().craters + FX.counts().scorches, 0);
  FX.reset();
  for (let i = 0; i < 200; i++) FX.addCrater(i, i, { born: 0 });
  assert.ok(FX.counts().craters <= Loop5.D.CRATER_CAP);
  assert.ok(FX.counts().scorches <= Loop5.D.SCORCH_CAP);
});

test('tread cap does not evict live craters or scorches', () => {
  FX.reset();
  const t0 = 1000;
  for (let i = 0; i < 10; i++) FX.addCrater(i * 20, 40, { born: t0, r: 12 });
  const craters = FX.counts().craters, scorches = FX.counts().scorches;
  assert.ok(craters >= 10 && scorches >= 10);
  const step = Loop5.D.TREAD_STEP_PX;
  const u = { type: 'ark', moving: true, dead: false, carried: false, x: 0, y: 200, ang: 0, d: { cat: 'vehicle' } };
  const G = { units: [u], blds: [], time: t0 };
  for (let i = 0; i < Loop5.D.TREAD_CAP + 10; i++) {
    u.x = i * step * 1.5; FX.tick(G, { time: t0 + i * 0.01, dt: 1 / 30 });
  }
  assert.ok(FX.counts().treads <= Loop5.D.TREAD_CAP);
  assert.equal(FX.counts().craters, craters);
  assert.equal(FX.counts().scorches, scorches);
});

test('shell impact and fire kill feed the in-sim visual layer, leaving G.decals on its existing path', () => {
  const { RTS, seed } = load();
  seed(7); RTS.newArena(7);
  const V = RTS.Loop5.FX;
  const before = RTS.G.decals.length;
  V.reset();
  const tank = RTS.makeUnit('ark', 0, 400, 400);
  tank.hp = 1;
  RTS.kill(tank, null, 'fire');
  assert.ok(RTS.G.decals.length >= before); // existing burn/scorch path unchanged
  assert.ok(V.counts().scorches >= 1, 'fire kill left a visual scorch');
  V.reset();
  V.onImpact({ w: 'shell', tx: 200, ty: 200, splash: 1.5, big: false }, 0);
  assert.ok(V.counts().craters >= 1);
});

test('visual FX tick does not change the seeded sim', () => {
  function snap(G) {
    return JSON.stringify({
      time: G.time,
      units: G.units.map(u => [u.id, u.type, u.x, u.y, u.hp, u.dead, u.ang]),
      blds: G.blds.map(b => [b.id, b.type, b.hp, b.dmgState, b.dead]),
      credits: G.credits && G.credits.slice(),
      decals: G.decals.length,
      fx: G.fx.length,
      proj: (G.proj || []).length,
    });
  }
  function run(tickFx) {
    const { RTS, seed } = load();
    seed(11); RTS.newArena(11);
    const a = RTS.makeUnit('ark', 0, 20 * 32, 40 * 32);
    const b = RTS.makeUnit('brute', 1, 28 * 32, 40 * 32);
    RTS.issueMove([a], b.x, b.y, true);
    RTS.issueMove([b], a.x, a.y, true);
    const hq = RTS.makeBld('hq', 0, 18, 42);
    hq.hp = hq.maxhp * 0.2; RTS.setDmgState(hq);
    for (let i = 0; i < 90; i++) {
      RTS.step(1 / 30);
      if (tickFx) FX.tick(RTS.G, { time: RTS.G.time, dt: 1 / 30 });
    }
    return snap(RTS.G);
  }
  FX.reset();
  const without = run(false);
  FX.reset();
  const withFx = run(true);
  assert.equal(withFx, without);
});
