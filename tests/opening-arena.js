// Loop 4 opening addendum "New tests" 1-5 on the real game code (headless arena). Shared by tests/loop4.test.js and the CLI.
// CLI: node tests/opening-arena.js [runs]
'use strict';
const { load, mulberry32 } = require('./harness');
const TILE = 32, CX = 40 * TILE, CY = 40 * TILE;
let H = null;
function arena(seed) { if (!H) H = load(); H.seed(seed * 7919 + 101); const R = H.RTS; R.newArena(seed); return R; }
// HQ (3x3) centred on (CX, CY); attackers 9 tiles east, attack-moving onto it every 5 s
function hqDefence(seed, attackers, rifles) {
  const R = arena(seed), G = R.G, jr = mulberry32(seed * 104729 + 3), jit = () => (jr() - 0.5) * 16;
  const hq = R.makeBld('hq', 0, CX / TILE - 1, CY / TILE - 1);
  const def = []; for (let k = 0; k < (rifles || 0); k++) def.push(R.makeUnit('survivor', 0, CX + 2 * TILE + jit(), CY + (k - 1) * 24 + jit()));
  const att = []; let k = 0; for (const t in attackers) for (let i = 0; i < attackers[t]; i++, k++) att.push(R.makeUnit(t, 1, CX + 9 * TILE + Math.floor(k / 5) * 24 + jit(), CY + (k % 5 - 2) * 24 + jit()));
  const alive = l => l.filter(u => !u.dead);
  let t = 0, next = 0;
  while (t < 180 && !hq.dead && alive(att).length) { if (t >= next) { next += 5; R.orderAttack(alive(att).filter(u => !u.target || u.target.dead), hq); } R.step(1 / 30); t += 1 / 30; }
  return { hqHpPct: hq.dead ? 0 : Math.round(100 * hq.hp / hq.maxhp), hqDead: hq.dead, attackersLeft: alive(att).length, riflesLeft: alive(def).length, time: +t.toFixed(1) };
}
// test 4: HQ turret vs 1 Angel held at a distance (tiles from the HQ centre); returns shots fired / damage dealt in 5 s
function hqVsAngel(seed, tiles) {
  const R = arena(seed), G = R.G;
  const hq = R.makeBld('hq', 0, CX / TILE - 1, CY / TILE - 1);
  const a = R.makeUnit('seraph', 1, CX + tiles * TILE, CY); a.side = 1; a.scan = 1e9;
  const hp0 = a.hp; let shots = 0, cd0 = hq.cd;
  for (let t = 0; t < 5; t += 1 / 30) { a.x = CX + tiles * TILE; a.y = CY; a.target = null; a.scan = 1e9; a.order = 'idle'; R.step(1 / 30); if (hq.cd > cd0 + 0.5) shots++; cd0 = hq.cd; }
  return { shots, dmg: Math.round(hp0 - a.hp) };
}
// test 5: a full Truck at the HQ dock with no Scrap Yard; Credits banked after 10 s of unloading
function hqDropOff(seed) {
  const R = arena(seed), G = R.G;
  const hq = R.makeBld('hq', 0, CX / TILE - 1, CY / TILE - 1);
  const dp = R.dockPoint(hq), u = R.makeUnit('gleaner', 0, dp.x, dp.y + 2 * TILE);
  u.load = u.d.cap; R.SAL.orderPlant ? R.SAL.orderPlant(u, hq) : null;
  let t = 0; while (t < 30 && u.hs !== 'unload') { R.step(1 / 30); t += 1 / 30; }
  const c0 = G.credits[0], plants = R.dropOffs(0).map(b => b.type);
  for (let s = 0; s < 12 * 30; s++) R.step(1 / 30); // addendum 1d: 600 at 50/s = 12 s
  return { reachedDockS: +t.toFixed(1), unloaded10s: Math.round(G.credits[0] - c0), loadLeft: u.load, dropOffs: plants };
}
const TESTS = [
  { id: 'A1', name: 'HQ alone vs 4 Zombies', run: s => hqDefence(s, { zombie: 4 }), pass: r => !r.hqDead && r.hqHpPct >= 75 && r.attackersLeft === 0, target: 'HQ survives with >= 75% HP' },
  { id: 'A2', name: 'HQ + 3 Riflemen vs Normal wave 1 (4 Zombies, 1 Imp)', run: s => hqDefence(s, { zombie: 4, imp: 1 }, 3), pass: r => r.attackersLeft === 0 && r.hqHpPct >= 80 && r.riflesLeft >= 1, target: 'Survivors win, HQ >= 80%, >= 1 Rifleman left' },
  { id: 'A3', name: 'HQ alone vs 12 Zombies (control)', run: s => hqDefence(s, { zombie: 12 }), pass: r => r.hqDead, target: 'HQ destroyed' },
  // Job F: HQ turret range 6 (Combat.HQ_TURRET_RANGE, was 5), so A4 moves out one tile (was: no fire at 6, hits at 4.5)
  { id: 'A4', name: 'HQ turret vs 1 Angel at 7 / 5.5 tiles', run: s => ({ at6: hqVsAngel(s, 7), at45: hqVsAngel(s, 5.5), at6old: hqVsAngel(s, 6) }), pass: r => r.at6.shots === 0 && r.at6.dmg === 0 && r.at45.shots > 0 && r.at45.dmg > 0, target: 'no fire at 7 tiles; fires and hits at 5.5' },
  { id: 'A5', name: 'Opening drop-off: Truck unloads at the HQ, no Scrap Yard', run: s => hqDropOff(s), pass: r => r.unloaded10s >= 600 && r.dropOffs.join() === 'hq', target: '600 Credits in 12 s (addendum 1d, was 500 in 10 s)' },
];
function runTest(t, runs = 20) { const res = []; for (let s = 1; s <= runs; s++) res.push(t.run(s)); const ok = res.filter(t.pass).length; return { id: t.id, name: t.name, target: t.target, runs, ok, rate: ok / runs, res }; }
module.exports = { TESTS, runTest, hqDefence, hqVsAngel, hqDropOff };
if (require.main === module) {
  const runs = +process.argv[2] || 20;
  for (const t of TESTS) {
    const r = runTest(t, runs), avg = f => +(r.res.reduce((s, x) => s + f(x), 0) / runs).toFixed(1);
    const extra = t.id === 'A4' ? `shots@7 avg ${avg(x => x.at6.shots)}, shots@5.5 avg ${avg(x => x.at45.shots)}, dmg@5.5 avg ${avg(x => x.at45.dmg)}, shots@6 avg ${avg(x => x.at6old.shots)}` : t.id === 'A5' ? `unloaded in 12 s avg ${avg(x => x.unloaded10s)}` : `HQ HP avg ${avg(x => x.hqHpPct)}%, HQ destroyed ${r.res.filter(x => x.hqDead).length}/${runs}, attackers left avg ${avg(x => x.attackersLeft)}, Riflemen left avg ${avg(x => x.riflesLeft)}, time ${avg(x => x.time)}s`;
    console.log(`${t.id} ${r.ok}/${runs} ${r.ok === runs ? 'PASS' : 'FAIL'} | ${t.name} | ${t.target} | ${extra}`);
  }
}
