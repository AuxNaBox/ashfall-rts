// node --test tests/  Loop 4 (rts-loops/loop4/1-tech-spec.md) + opening addendum (1b-opening-addendum.md)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./harness.js');
const Combat = require('../combat.js');
const Salvage = require('../salvage.js');
const { TESTS, runTest } = require('./opening-arena.js');
const { openingSim } = require('./opening-sim.js');
const { MATCHUPS4, runOne } = require('./matchups.js');
const TILE = 32;
const J = x => JSON.parse(JSON.stringify(x)); // vm-realm arrays -> this realm for deepEqual

test('L4 data: new units, buildings, limits, power, research table', () => {
  const { RTS } = load(); const U = RTS.UDEF, B = RTS.BDEF;
  const want = { flamer: [250, 7, 150, 18, 0.6, 2.5], rocket: [300, 8, 110, 45, 2.0, 5.5], archangel: [2500, 35, 1400, 60, 1.5, 6], templar: [1400, 25, 1500, 70, 1.4, 1.1], demon: [2500, 35, 2400, 50, 1.5, 5] };
  for (const [t, [c, tm, hp, d, rof, rg]] of Object.entries(want)) assert.deepEqual([U[t].cost, U[t].time, U[t].hp, U[t].dmg, U[t].rof, U[t].range], [c, tm, hp, d, rof, rg], t);
  assert.equal(U.medic.cost, 200); assert.equal(U.medic.heal, 10); assert.equal(U.medic.hp, 90); assert.ok(!U.medic.weapon);
  assert.equal(U.archangel.limit, 1); assert.equal(U.templar.limit, 2); assert.equal(U.demon.limit, 1);
  assert.ok(U.archangel.fly && U.archangel.plagueImmune && U.templar.plagueImmune);
  assert.equal(U.demon.weapon, 'fire'); assert.ok(U.demon.hitsAir); assert.ok(!U.rocket.hitsAir); assert.ok(!U.templar.hitsAir);
  assert.deepEqual([B.armory.cost, B.armory.time, B.armory.hp, B.armory.w, B.armory.h], [1200, 12, 900, 2, 2]);
  assert.deepEqual([B.church.cost, B.church.time, B.church.hp, B.church.w, B.church.h], [1500, 15, 1000, 2, 3]);
  assert.deepEqual([B.altar.cost, B.altar.time, B.altar.hp, B.altar.w, B.altar.h, B.altar.name[1]], [1500, 15, 1000, 2, 3, 'Dark Altar']);
  assert.deepEqual([Salvage.powerOfType('armory'), Salvage.powerOfType('church'), Salvage.powerOfType('altar')], [-30, -40, -40]);
  assert.deepEqual(Object.keys(Combat.RESEARCH).sort(), ['barrels', 'blessed', 'halo', 'hollow', 'holyground', 'plating', 'rockets']);
  const cost = id => [Combat.RESEARCH[id].cost, Combat.RESEARCH[id].time];
  assert.deepEqual([cost('hollow'), cost('plating'), cost('rockets'), cost('barrels'), cost('blessed'), cost('halo'), cost('holyground')], [[600, 30], [800, 40], [600, 30], [1000, 45], [800, 40], [900, 40], [1000, 45]]);
});

test('L4 research modifiers never change base stats', () => {
  const { RTS } = load(); RTS.newArena(1); const G = RTS.G;
  const r = RTS.makeUnit('survivor', 0, 100, 100), ark = RTS.makeUnit('ark', 0, 200, 100), t = RTS.makeBld('turret', 0, 10, 10), s = RTS.makeUnit('seraph', 0, 300, 100);
  const base = JSON.stringify([RTS.UDEF.survivor, RTS.UDEF.ark, RTS.BDEF.turret, RTS.UDEF.seraph]);
  assert.equal(RTS.dmgOf(r), 11); RTS.applyResearch(0, 'hollow'); assert.ok(Math.abs(RTS.dmgOf(r) - 13.2) < 1e-9); assert.ok(Math.abs(RTS.dmgOf(t) - 28 * 1.2) < 1e-9);
  ark.hp = 600; RTS.applyResearch(0, 'plating'); assert.equal(ark.maxhp, 840); assert.equal(ark.hp, 740);
  RTS.applyResearch(0, 'barrels'); assert.equal(RTS.rangeOf(ark), 7); assert.equal(RTS.rangeOf(t), 7.5);
  RTS.applyResearch(0, 'halo'); assert.equal(s.maxhp, 300); assert.ok(Math.abs(RTS.speedOf(s) - RTS.UDEF.seraph.speed * 1.15) < 1e-9);
  assert.equal(JSON.stringify([RTS.UDEF.survivor, RTS.UDEF.ark, RTS.BDEF.turret, RTS.UDEF.seraph]), base);
  // the other side is untouched
  const z = RTS.makeUnit('ark', 1, 400, 100); assert.equal(z.maxhp, 700);
});

test('L4 research queue: requirements, one at a time, refund on cancel, loss when the building dies', () => {
  const { RTS } = load(); RTS.newGame('normal'); const G = RTS.G; G.credits[0] = 20000;
  assert.equal(RTS.queueResearch(0, 'hollow'), false); // no Armory
  for (const t of ['barracks', 'refinery', 'power']) RTS.makeBld(t, 0, 4 + ['barracks', 'refinery', 'power'].indexOf(t) * 4, 60);
  const arm = RTS.makeBld('armory', 0, 4, 64);
  assert.equal(RTS.queueResearch(0, 'rockets'), false); // needs a Factory
  assert.equal(RTS.queueResearch(0, 'barrels'), false); // needs Hollow Points
  assert.ok(RTS.queueResearch(0, 'hollow')); assert.ok(RTS.queueResearch(0, 'barrels')); assert.equal(RTS.queueResearch(0, 'hollow'), false);
  const c0 = G.credits[0]; RTS.cancelResearch(0, 'hollow'); assert.equal(G.credits[0], c0 + 1600); // cancels the dependent Long Barrels too
  assert.ok(RTS.queueResearch(0, 'hollow')); assert.ok(RTS.queueResearch(0, 'plating'));
  for (let t = 0; t < 31; t += 0.5) RTS.updResearch(0.5);
  assert.ok(G.research[0].hollow); assert.ok(!G.research[0].plating); assert.equal(RTS.researchState(0, 'plating'), 'active');
  assert.ok(RTS.queueResearch(0, 'barrels'));
  const c1 = G.credits[0]; RTS.kill(arm, null, 'shell');
  assert.equal(G.credits[0], c1 + 1000); // in-progress Armor Plating lost, queued Long Barrels refunded
  assert.equal(G.rq[0].armory.list.length, 0); assert.ok(G.research[0].hollow); // finished research is kept
  // the Flamer needs an Armory, the Medic a Church, the Rocket Soldier the research
  G.blds = G.blds.filter(b => !b.dead);
  assert.equal(RTS.queueItem(0, 'flamer'), false); assert.equal(RTS.queueItem(0, 'medic'), false); assert.equal(RTS.queueItem(0, 'rocket'), false);
  RTS.makeBld('armory', 0, 4, 68); assert.ok(RTS.queueItem(0, 'flamer'));
  assert.equal(RTS.queueItem(1, 'altar'), false); assert.equal(RTS.queueItem(0, 'altar'), false); // Horde only, needs a Factory
});

test('L4 unit limits: alive + queued count (Archangel 1, Templar 2, Demon Lord 1)', () => {
  const { RTS } = load(); RTS.newGame('normal'); const G = RTS.G; G.credits[0] = 1e5; G.credits[1] = 1e5;
  RTS.makeBld('church', 0, 4, 60); RTS.makeBld('altar', 1, 60, 10);
  assert.ok(RTS.queueItem(0, 'archangel')); assert.equal(RTS.queueItem(0, 'archangel'), false);
  assert.ok(RTS.queueItem(0, 'templar')); assert.ok(RTS.queueItem(0, 'templar')); assert.equal(RTS.queueItem(0, 'templar'), false);
  assert.ok(RTS.queueItem(1, 'demon')); assert.equal(RTS.queueItem(1, 'demon'), false);
  G.queues[1].altar.list = []; RTS.makeUnit('demon', 1, 900, 900); assert.equal(RTS.queueItem(1, 'demon'), false);
});

test('L4 rise rules: fire kills burn, Blessed Rounds, Archangel 6-tile purify, Templar kills never rise', () => {
  const { RTS } = load();
  const rises = (setup, w) => { RTS.newArena(3); const G = RTS.G; setup && setup(G); const v = RTS.makeUnit('survivor', 0, 1000, 1000); RTS.kill(v, null, w); return G.rises.length; };
  assert.equal(rises(null, 'claw'), 1); assert.equal(rises(null, 'plague'), 1);
  assert.equal(rises(null, 'fire'), 0);
  assert.equal(rises(G => RTS.applyResearch(0, 'blessed'), 'claw'), 0);
  assert.equal(rises(() => RTS.makeUnit('archangel', 0, 1000 + 5.5 * TILE, 1000), 'claw'), 0);
  assert.equal(rises(() => RTS.makeUnit('archangel', 0, 1000 + 7 * TILE, 1000), 'claw'), 1);
  assert.equal(rises(null, 'holy'), 0);
  assert.equal(Combat.riseEligible('flamer', 0, 'claw'), false);
});

test('L4 auras: Archangel heals allies 5 HP/s (not itself); Demon Lord plague aura; Holy Ground cancels plague', () => {
  const { RTS } = load(); RTS.newArena(4); const G = RTS.G;
  const a = RTS.makeUnit('archangel', 0, 1000, 1000), r = RTS.makeUnit('survivor', 0, 1000 + 3 * TILE, 1000), far = RTS.makeUnit('survivor', 0, 1000 + 6 * TILE, 1000);
  a.hp = 1000; r.hp = 50; far.hp = 50; for (const u of [a, r, far]) u.scan = 1e9;
  for (let t = 0; t < 2.01; t += 1 / 30) RTS.step(1 / 30);
  assert.equal(r.hp, 60); assert.equal(far.hp, 50); assert.equal(a.hp, 1000);
  RTS.newArena(5); const dl = RTS.makeUnit('demon', 1, 1000, 1000), v = RTS.makeUnit('survivor', 0, 1000 + 2 * TILE, 1000), z = RTS.makeUnit('zombie', 1, 1000 - 2 * TILE, 1000);
  assert.ok(RTS.inPlague(v, 0)); dl.hp = 2000; z.hp = 60; v.scan = z.scan = dl.scan = 1e9;
  for (let t = 0; t < 1.01; t += 1 / 30) { RTS.step(1 / 30); v.target = z.target = dl.target = null; }
  assert.ok(v.hp < 100); assert.equal(z.hp, 64); assert.equal(dl.hp, 2000); // the Demon Lord does not heal from its own aura
  RTS.makeBld('church', 0, 34, 30); assert.equal(RTS.holyGround(v.x, v.y), false); RTS.applyResearch(0, 'holyground'); assert.equal(RTS.holyGround(v.x, v.y), true);
  const h = v.hp; for (let t = 0; t < 1.01; t += 1 / 30) { RTS.step(1 / 30); v.target = z.target = dl.target = null; } assert.equal(v.hp, h); assert.equal(z.hp, 64);
});

test('L4 Medic heals one infantry target 10 HP/s, never vehicles', () => {
  const { RTS } = load(); RTS.newArena(6);
  const m = RTS.makeUnit('medic', 0, 1000, 1000), a = RTS.makeUnit('survivor', 0, 1000 + 2 * TILE, 1000), b = RTS.makeUnit('survivor', 0, 1000, 1000 + 2 * TILE), tk = RTS.makeUnit('ark', 0, 1000 - 2 * TILE, 1000);
  a.hp = 40; b.hp = 70; tk.hp = 100; for (const u of [a, b, tk]) u.scan = 1e9;
  for (let t = 0; t < 1; t += 1 / 30) RTS.step(1 / 30);
  assert.ok(a.hp > 47 && a.hp <= 50.5, 'most hurt first: ' + a.hp); assert.equal(b.hp, 70); assert.equal(tk.hp, 100);
});

test('L4 AI: Dark Altar after the Factory at altarTime (earlier once the player builds a Church); wave bonus', () => {
  const { RTS } = load(); RTS.newGame('normal'); const G = RTS.G;
  for (const t of ['power', 'refinery', 'barracks', 'turret', 'factory']) RTS.makeBld(t, 1, 50 + ['power', 'refinery', 'barracks', 'turret', 'factory'].indexOf(t) * 4, 4);
  RTS.makeBld('power', 1, 50, 9); RTS.makeBld('power', 1, 54, 9);
  G.time = 300; assert.notEqual(RTS.aiNextBuild(), 'altar');
  G.time = 541; assert.equal(RTS.aiNextBuild(), 'altar');
  G.time = 300; G.ai.churchSeen = true; assert.equal(RTS.aiNextBuild(), 'altar');
});

test('opening addendum: bare start, HQ turret + slow drop-off, Trucks only from HQ / Factory, wave-1 overrides', () => {
  const { RTS } = load(); RTS.newGame('normal'); const G = RTS.G;
  assert.equal(G.units.length, 0); assert.deepEqual(J(G.blds.map(b => b.type)), ['hq', 'hq']); assert.deepEqual(J(G.credits), [2500, 3000]);
  const B = RTS.BDEF.hq; assert.deepEqual([B.dmg, B.rof, B.range, B.hitsAir, B.power], [20, 1.0, 5, true, 0]);
  assert.deepEqual(J(G.blds.map(b => b.weapon)), ['bullet', 'fire']); assert.equal(Salvage.powerOfType('hq'), 0);
  assert.equal(Salvage.D.hqUnloadPerSec, 50); assert.equal(Salvage.D.hqStorage, 2000); assert.equal(RTS.storageCapOf(0), 2000);
  for (const [t, d] of Object.entries(RTS.UDEF)) if (d.from.includes('hq')) assert.ok(d.harv, t);
  assert.deepEqual(J(RTS.UDEF.gleaner.from), ['hq', 'factory']);
  assert.deepEqual(J(RTS.dropOffs(0).map(b => b.type)), ['hq']);
  const W = { easy: [390, { zombie: 3 }], normal: [300, { zombie: 4, imp: 1 }], hard: [240, { zombie: 5, imp: 1 }] };
  for (const [k, [t, c]] of Object.entries(W)) { RTS.newGame(k); assert.equal(RTS.G.ai.nextWave, t, k); assert.deepEqual(J(RTS.G.diff.wave1), c, k); }
});

for (const t of TESTS) test(`opening addendum test ${t.id}: ${t.name} (${t.target}), 20 seeded runs`, () => {
  const r = runTest(t, 20); assert.equal(r.ok, 20, JSON.stringify(r.res.filter(x => !t.pass(x)).slice(0, 2)));
});

test('opening addendum: 12-minute Normal regression with the scripted expected opening (checks 1-4)', () => {
  const { RTS, seed } = load(); seed(1);
  const r = openingSim(RTS, {});
  for (const [k, v] of Object.entries(r.checks)) assert.ok(v, k + ' ' + JSON.stringify(r.numbers));
});

test('L4 matchups run on the real code (pass rates reported by npm run matchups, not asserted here)', () => {
  for (const m of MATCHUPS4) { const r = runOne(m, 1); assert.ok(['a', 'b', 'draw', 'a*'].includes(r.win), m.id); }
});
