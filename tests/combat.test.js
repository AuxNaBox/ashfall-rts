// Loop 3 combat spec tests (rts-loops/loop3/1-combat-spec.md), run headless on the real game code.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const Combat = require('../combat.js');
const { load } = require('./harness');
const { MATCHUPS, runMatchup } = require('./matchups');
const T = 32;
const H = load(), R = H.RTS;
const arena = (seed = 1) => { H.seed(seed); R.newArena(seed); return R.G; };
const steps = (sec) => { for (let i = 0; i < Math.round(sec * 30); i++) R.step(1 / 30); };

test('damage matrix matches the spec', () => {
  const M = Combat.MATRIX;
  assert.deepEqual(M.bullet, { light: 1.0, heavy: 0.6, air: 1.0, structure: 0.6 });
  assert.deepEqual(M.claw, { light: 1.0, heavy: 0.6, air: null, structure: 0.6 });
  assert.deepEqual(M.fire, { light: 1.25, heavy: 0.75, air: 1.0, structure: 0.6 });
  assert.deepEqual(M.shell, { light: 0.8, heavy: 1.25, air: null, structure: 1.0 });
  assert.deepEqual(M.cleave, { light: 1.0, heavy: 1.25, air: null, structure: 1.25 });
  assert.deepEqual(M.beam, { light: 1.25, heavy: 1.0, air: 1.0, structure: 0.6 });
  assert.equal(Combat.mult('plague', 'light'), 1); assert.equal(Combat.mult('nuke', 'structure'), 1);
});

test('unit definitions carry armor, dmgType, hitsAir and the spec stats', () => {
  const U = R.UDEF;
  const want = { survivor: ['light', 'bullet', true, 100, 11, 0.75, 4.5, 1.8, 6, 100, 4], ark: ['heavy', 'shell', false, 700, 75, 2.2, 6, 1.25, 7, 800, 13], seraph: ['air', 'beam', true, 240, 30, 1.3, 5, 2.75, 8, 450, 9],
    zombie: ['light', 'claw', false, 120, 13, 1.0, 0.8, 1.1, 5, 60, 2.5], imp: ['light', 'fire', true, 110, 20, 1.3, 4.5, 2.2, 6, 200, 6], brute: ['heavy', 'cleave', false, 1000, 70, 1.6, 1.1, 1.1, 6, 900, 14] };
  for (const k in want) { const [armor, w, air, hp, dmg, rof, range, sp, sight, cost, time] = want[k], u = U[k];
    assert.deepEqual([u.armor, u.weapon, u.hitsAir, u.hp, u.dmg, u.rof, u.range, +(u.speed / 32).toFixed(2), u.sight, u.cost, u.time], [armor, w, air, hp, dmg, rof, range, sp, sight, cost, time], k); }
  assert.equal(U.ark.splash, 1.0); assert.equal(U.brute.splash, 0.9);
  assert.equal(U.gleaner.armor, 'heavy'); assert.equal(U.reaper.armor, 'heavy'); assert.equal(U.gleaner.weapon, undefined);
  assert.deepEqual(Combat.TOWERS.turret.dmgType, ['bullet', 'fire']);
});

test('air targeting option A: only bullet, fire (and the holy beam) hit Angels', () => {
  arena();
  const angel = R.makeUnit('seraph', 0, 20 * T, 20 * T);
  for (const [t, hits] of [['zombie', false], ['imp', true], ['brute', false]]) { const e = R.makeUnit(t, 1, 21 * T, 20 * T); assert.equal(R.findEnemy(e, 10 * T, 1) === angel, hits, t); e.dead = true; }
  const z = R.makeUnit('zombie', 1, 22 * T, 20 * T), tank = R.makeUnit('ark', 0, 23 * T, 20 * T);
  const zt = R.findEnemy(z, 10 * T, 1); assert.equal(zt, tank, 'zombie skips the Angel and goes for the Tank');
  const tk = R.findEnemy(tank, 10 * T, 0); assert.equal(tk, z);
  const spire = R.makeBld('turret', 1, 25, 20); assert.equal(spire.weapon, 'fire'); const tur = R.makeBld('turret', 0, 18, 18); assert.equal(tur.weapon, 'bullet');
  R.orderAttack([tank], angel); assert.notEqual(tank.target, angel, 'forced attack on air is refused for shells');
});

test('trucks: low auto-target priority, towers target them, forced attack works, they never fight back', () => {
  const G = arena();
  const rifle = R.makeUnit('survivor', 0, 20 * T, 20 * T), eater = R.makeUnit('reaper', 1, 21 * T, 20 * T), imp = R.makeUnit('imp', 1, 24 * T, 20 * T);
  assert.equal(R.findEnemy(rifle, 6 * T, 0), imp, 'armed Imp first even though the Eater is closer');
  imp.dead = true; assert.equal(R.findEnemy(rifle, 6 * T, 0), eater, 'truck when no armed enemy');
  const tur = R.makeBld('turret', 0, 22, 22); const tz = R.makeUnit('zombie', 1, 22 * T, 25 * T), te = R.makeUnit('reaper', 1, 22.5 * T, 23.6 * T);
  assert.equal(R.findEnemy(tur, 6.5 * T, 0), te, 'turret auto-targets the nearer truck');
  tz.dead = true; R.orderAttack([rifle], eater); assert.equal(rifle.target, eater);
  const truck = R.makeUnit('gleaner', 0, 40 * T, 40 * T), z = R.makeUnit('zombie', 1, 41 * T, 40 * T); R.SAL.park(truck);
  steps(3); assert.ok(truck.hp < truck.maxhp, 'zombie claws the truck'); assert.equal(truck.target || null, null, 'truck never fights back'); assert.equal(z.hp, z.maxhp);
});

test('damage uses the matrix', () => {
  arena();
  const rifle = R.makeUnit('survivor', 0, 10 * T, 10 * T), z = R.makeUnit('zombie', 1, 30 * T, 30 * T), tank = R.makeUnit('ark', 0, 50 * T, 50 * T);
  R.damage(z, 100, tank, 'shell'); assert.equal(z.hp, 120 - 80);
  R.damage(tank, 100, z, 'cleave'); assert.equal(tank.hp, 700 - 125);
  R.damage(rifle, 20, z, 'fire'); assert.equal(rifle.hp, 100 - 25);
});

test('the dead rise: claw and plague kills rise, purified within 4 tiles of an Angel, others never rise', () => {
  const G = arena();
  const z = R.makeUnit('zombie', 1, 5 * T, 5 * T);
  const kill = (x, w, src) => { const r = R.makeUnit('survivor', 0, x, 30 * T); R.kill(r, src, w); };
  kill(20 * T, 'claw', z); kill(22 * T, 'plague', null);
  for (const w of ['crush', 'shell', 'fire', 'cleave', 'bullet']) kill(24 * T, w, z);
  assert.equal(G.rises.length, 2);
  const angel = R.makeUnit('seraph', 0, 40 * T, 30 * T);
  kill(43.9 * T, 'claw', z); assert.equal(G.rises.length, 2, 'Angel 3.9 tiles away purifies'); assert.equal(G.stats.purified, 1);
  assert.ok(G.fx.some(f => f.k === 'purify'), 'white purify flash');
  kill(44.5 * T, 'claw', z); assert.equal(G.rises.length, 3, '4.5 tiles: rises');
  angel.dead = true; G.units = G.units.filter(u => !u.dead);
  steps(1.7); assert.equal(G.stats.risen, 3); assert.equal(G.units.filter(u => u.type === 'zombie' && u.risen).length, 3);
});

test('crushing: a moving truck kills enemy Light infantry only', () => {
  const G = arena();
  const truck = R.makeUnit('gleaner', 0, 10 * T, 20 * T); R.SAL.park(truck);
  const y = 20 * T;
  const z = R.makeUnit('zombie', 1, 14 * T, y), imp = R.makeUnit('imp', 1, 16 * T, y);
  for (const u of [z, imp]) { u.scan = 99; u.order = 'move'; u.path = null; }
  R.issueMove([truck], 22 * T, y, false); steps(14);
  assert.ok(z.dead && imp.dead, 'zombie and imp crushed');
  const at = (t, side) => R.makeUnit(t, side, truck.x + 4, truck.y);
  for (const [t, side, ok] of [['survivor', 0, false], ['zombie', 0, false], ['brute', 1, false], ['ark', 1, false], ['seraph', 1, false], ['zombie', 1, true], ['imp', 1, true]]) { const o = at(t, side); assert.equal(Combat.canCrush(truck, { side: o.side, dead: false, armor: o.d.armor, x: o.x, y: o.y }), ok, t + side); o.dead = true; }
  assert.equal(G.stats.crushed, 2);
  const r = R.makeUnit('survivor', 0, 30 * T, 30 * T), eater = R.makeUnit('reaper', 1, 26 * T, 30 * T); R.SAL.park(eater); r.scan = 99; r.order = 'move';
  R.issueMove([eater], 34 * T, 30 * T, false); steps(8); assert.ok(r.dead, 'Scrap Eater crushes a Rifleman'); assert.equal(G.rises.length, 0, 'crushed Riflemen do not rise');
});

test('plague: Survivor infantry -6/s, vehicles and trucks -4/s, Horde heals 4/s, Angels immune', () => {
  const G = arena(), P = R.plague;
  const at = (t, side, x) => { const u = R.makeUnit(t, side, x * T + 16, 10 * T + 16); u.scan = 1e9; P[10 * 80 + x] = 1; return u; };
  const rifle = at('survivor', 0, 10), tank = at('ark', 0, 20), truck = at('gleaner', 0, 30), angel = at('seraph', 0, 40), z = at('zombie', 1, 50); z.hp = 50; R.SAL.park(truck);
  steps(2.2);
  assert.equal(rifle.hp, 100 - 12); assert.equal(tank.hp, 700 - 8); assert.equal(truck.hp, truck.maxhp - 8); assert.equal(angel.hp, 240); assert.equal(z.hp, 58);
  assert.deepEqual([Combat.D.plagueInfDps, Combat.D.plagueVehDps, Combat.D.plagueHealDps], [6, 4, 4]);
});

test('truck below 50% HP heads home with its load; on death half its cargo drops on the field', () => {
  const G = arena();
  for (let i = 0; i < 4; i++) R.res[30 * 80 + 30 + i] = 300; R.SAL.initFields();
  const yard = R.makeBld('refinery', 0, 10, 10); const truck = G.units.find(u => u.d.harv);
  truck.x = 31 * T + 16; truck.y = 30 * T + 16; truck.load = 300; truck.hs = 'gather'; truck.htile = 30 * 80 + 31;
  R.damage(truck, 350, null, 'nuke'); assert.equal(truck.hs, 'toPlant'); assert.ok(truck.retreated);
  const before = R.res[30 * 80 + 31]; R.damage(truck, 500, null, 'nuke'); assert.ok(truck.dead); assert.equal(R.res[30 * 80 + 31], before + 150);
});

for (const m of MATCHUPS) test(`matchup ${m.id}: ${m.name} (expected winner >= 80% of 20 seeded runs)`, () => {
  const r = runMatchup(m, 20);
  assert.ok(r.winRate >= 0.8, `${m.name}: ${r.wins}/20 wins`);
});
