// Combat spec (loop3/1-combat-spec.md) automated matchups, run on the real game code headless.
// Open ground, no plague, sides 8 tiles apart, both attack-move. 20 seeded runs each; pass = expected side wins >= 80%.
// CLI: node tests/matchups.js [runs]
'use strict';
const { load, mulberry32 } = require('./harness');
const TILE = 32, CX = 30 * TILE, CY = 40 * TILE, GAP = 8 * TILE, LIMIT = 240;

const MATCHUPS = [
  { id: '1', name: '6 Riflemen (600) vs 10 Zombies (600)', a: { survivor: 6 }, b: { zombie: 10 }, expect: 'b', target: 'Zombies win with 3-6 left (risen counted separately)', check: r => r.bLeftOrig >= 3 && r.bLeftOrig <= 6 },
  { id: '2', name: '1 Tank (800) vs 13 Zombies (780)', a: { ark: 1 }, b: { zombie: 13 }, expect: 'a', target: 'Tank wins with >= 20% HP', check: r => r.aHpPct >= 20 },
  { id: '3', name: '4 Angels (1,800) vs 9 Imps (1,800)', a: { seraph: 4 }, b: { imp: 9 }, expect: 'b', target: 'Imps win with >= 2 left (Dezi, Loop 3; was >= 3)', check: r => r.bLeft >= 2 },
  { id: '4', name: '9 Riflemen (900) vs 4 Imps (800)', a: { survivor: 9 }, b: { imp: 4 }, expect: 'a', target: 'Riflemen win with >= 5 left', check: r => r.aLeft >= 5 },
  { id: '5a', name: '1 Hellbrute (900) vs 1 Tank (800)', a: { ark: 1 }, b: { brute: 1 }, expect: 'b', target: 'Hellbrute wins with 15-40% HP', check: r => r.bHpPct >= 15 && r.bHpPct <= 40 },
  { id: '5b', name: '2 Angels vs 1 Hellbrute', a: { seraph: 2 }, b: { brute: 1 }, expect: 'a', target: 'Angels win with 0 losses', check: r => r.aLost === 0, strictWin: r => r.aLost === 0 },
  { id: '6', name: 'Scrap Truck drives through 5 Zombies', truck: true, expect: 'a', target: 'crush >= 3 and lose <= 25% HP', check: r => r.crushed >= 3 && r.truckLossPct <= 25, strictWin: r => r.crushed >= 3 && r.truckLossPct <= 25 },
];

// Loop 4 (rts-loops/loop4/1-tech-spec.md "Test matchups"). Printed by `npm run matchups`; per the brief these are NOT
// asserted at 80% in npm test (misses are reported, never tuned). research: finished research per side for the run.
const L4 = 'L4-';
const MATCHUPS4 = [
  { id: L4 + '1', name: '4 Flamers (1,000) vs 16 Zombies (960)', a: { flamer: 4 }, b: { zombie: 16 }, expect: 'a', target: 'Flamers win with >= 2 left, 0 Zombies rise', check: r => r.aLeft >= 2 && r.risen === 0 },
  { id: L4 + '2', name: '4 Flamers (1,000) vs 5 Imps (1,000)', a: { flamer: 4 }, b: { imp: 5 }, expect: 'b', target: 'Imps win', check: () => true },
  { id: L4 + '3', name: '3 Rocket Soldiers (900) vs 1 Hellbrute (900)', a: { rocket: 3 }, b: { brute: 1 }, expect: 'a', target: 'Rocket Soldiers win with >= 1 left', check: r => r.aLeft >= 1 },
  { id: L4 + '4', name: '4 Riflemen in plague 20 s: with 2 Medics / without (control)', custom: 'medic', expect: 'a', target: 'with Medics all 4 live; without, all 4 die', check: r => r.withAlive === 4 && r.withoutAlive === 0 },
  { id: L4 + '5', name: '1 Archangel (2,500) vs 12 Imps (2,400)', a: { archangel: 1 }, b: { imp: 12 }, expect: 'b', target: 'Imps win with >= 3 left', check: r => r.bLeft >= 3 },
  { id: L4 + '6', name: 'Blessed Rounds: 6 Riflemen vs 10 Zombies', a: { survivor: 6 }, b: { zombie: 10 }, research: { 0: ['blessed'] }, expect: 'a', strictWin: r => r.risen === 0, target: '0 Riflemen rise', check: r => r.risen === 0 },
  { id: L4 + '7', name: '1 Templar (1,400) vs 1 Hellbrute (900)', a: { templar: 1 }, b: { brute: 1 }, expect: 'a', target: 'Templar wins with 15-45% HP', check: r => r.aHpPct >= 15 && r.aHpPct <= 45 },
  { id: L4 + '8', name: '1 Templar (1,400) vs 23 Zombies (1,380)', a: { templar: 1 }, b: { zombie: 23 }, expect: 'b', target: 'Zombies win, 0 rise from Templar kills', check: r => r.risen === 0 },
  { id: L4 + '9', name: '1 Demon Lord (2,500) vs 1 Archangel (2,500)', a: { archangel: 1 }, b: { demon: 1 }, expect: 'b', target: 'Demon Lord wins with 20-50% HP', check: r => r.bHpPct >= 20 && r.bHpPct <= 50 },
  { id: L4 + '10', name: '1 Demon Lord (2,500) vs 3 Tanks (2,400)', a: { ark: 3 }, b: { demon: 1 }, expect: 'a', target: 'Tanks win with >= 2 left', check: r => r.aLeft >= 2 },
  { id: L4 + '11', name: '1 Demon Lord (2,500) vs 8 Rocket Soldiers (2,400)', a: { rocket: 8 }, b: { demon: 1 }, expect: 'a', target: 'Rocket Soldiers win with >= 2 left', check: r => r.aLeft >= 2 },
  { id: L4 + '12', name: 'Plague aura: 4 Riflemen 2 tiles from an idle Demon Lord, 10 s; then inside Holy Ground', custom: 'aura', expect: 'a', target: 'damage taken without Holy Ground, none inside it', check: r => r.dmgNoHG > 0 && r.dmgHG === 0 },
];
// custom runs (#4, #12): units passive (no target scanning) so only plague / healing acts
const passive = u => { u.scan = 1e9; u.order = 'idle'; return u; };
function runCustom(m, R, G, jit) {
  if (m.custom === 'medic') {
    const one = withMedics => {
      R.newArena(G.seed); const P = R.plague;
      const ty = Math.floor(CY / TILE), tx = Math.floor(CX / TILE);
      const rs = []; for (let k = 0; k < 4; k++) rs.push(passive(R.makeUnit('survivor', 0, (tx + k % 2) * TILE + 16 + jit() / 4, (ty + (k >> 1)) * TILE + 16 + jit() / 4)));
      for (let y = ty - 1; y <= ty + 2; y++) for (let x = tx - 1; x <= tx + 2; x++) P[y * R.MW + x] = 1;   // a 4x4 plague patch under them
      if (withMedics) for (let k = 0; k < 2; k++) R.makeUnit('medic', 0, (tx + 4) * TILE + 16, (ty + k) * TILE + 16); // just outside the plague, within 3 tiles
      for (let t = 0; t < 20; t += 1 / 30) R.step(1 / 30);
      return rs.filter(u => !u.dead).length;
    };
    const r = { withAlive: one(true), withoutAlive: one(false), time: 20 };
    r.win = m.check(r) ? 'a' : 'b'; return r;
  }
  if (m.custom === 'aura') {
    const one = hg => {
      R.newArena(G.seed); const g = R.G;
      const dl = passive(R.makeUnit('demon', 1, CX, CY));
      const rs = []; for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2; rs.push(passive(R.makeUnit('survivor', 0, CX + Math.cos(a) * 2 * TILE, CY + Math.sin(a) * 2 * TILE))); }
      if (hg) { R.makeBld('church', 0, Math.floor(CX / TILE) + 3, Math.floor(CY / TILE) - 1); g.research[0].holyground = true; }
      const hp0 = rs.reduce((s, u) => s + u.hp, 0);
      for (let t = 0; t < 10; t += 1 / 30) { R.step(1 / 30); dl.scan = 1e9; dl.target = null; for (const u of rs) { u.scan = 1e9; u.target = null; } }
      return Math.round(hp0 - rs.reduce((s, u) => s + Math.max(0, u.hp), 0));
    };
    const r = { dmgNoHG: one(false), dmgHG: one(true), time: 10 };
    r.win = m.check(r) ? 'a' : 'b'; return r;
  }
}
let H = null;
function runOne(m, seed) {
  if (!H) H = load();
  H.seed(seed * 7919 + 13);
  const R = H.RTS; R.newArena(seed); const G = R.G;
  const jr = mulberry32(seed * 104729 + 7), jit = () => (jr() - 0.5) * 16; // seeded spawn jitter +-8 px
  const spawn = (counts, side, x0) => { const out = []; let k = 0; for (const t in counts) for (let i = 0; i < counts[t]; i++, k++) { const col = Math.floor(k / 5), row = k % 5; out.push(R.makeUnit(t, side, x0 + (side ? 1 : -1) * col * 24 + jit(), CY + (row - 2) * 24 + jit())); } return out; };
  if (m.truck) {
    const truck = R.makeUnit('gleaner', 0, CX - 6 * TILE, CY);
    const zs = []; for (let i = 0; i < 5; i++) zs.push(R.makeUnit('zombie', 1, CX - 2 * TILE + i * 22 + jit(), CY + jit()));
    R.SAL.park(truck); R.issueMove([truck], CX + 10 * TILE, CY, false);
    const hp0 = truck.hp; let t = 0;
    while (t < 30 && !truck.dead && Math.hypot(truck.x - (CX + 10 * TILE), truck.y - CY) > 6) { R.step(1 / 30); t += 1 / 30; }
    const r = { crushed: G.stats.crushed, truckLossPct: truck.dead ? 100 : Math.round(100 * (hp0 - truck.hp) / hp0), time: +t.toFixed(1) };
    r.win = m.strictWin(r) ? 'a' : 'b'; return r;
  }
  if (m.custom) return runCustom(m, R, G, jit);
  if (m.research) for (const side in m.research) for (const id of m.research[side]) R.applyResearch(+side, id);
  const A = spawn(m.a, 0, CX - GAP / 2), B = spawn(m.b, 1, CX + GAP / 2);
  const hpA = A.reduce((s, u) => s + u.maxhp, 0), hpB = B.reduce((s, u) => s + u.maxhp, 0);
  const alive = side => G.units.filter(u => u.side === side && !u.dead && !u.d.harv);
  const order = () => { const a = alive(0), b = alive(1); const c = l => ({ x: l.reduce((s, u) => s + u.x, 0) / l.length, y: l.reduce((s, u) => s + u.y, 0) / l.length });
    if (a.length && b.length) { const ca = c(a), cb = c(b); R.issueMove(a.filter(u => !u.target), cb.x, cb.y, true); R.issueMove(b.filter(u => !u.target), ca.x, ca.y, true); } };
  order();
  let t = 0, nextOrder = 5;
  while (t < LIMIT && alive(0).length && alive(1).length) { R.step(1 / 30); t += 1 / 30; if (t >= nextOrder) { nextOrder += 5; order(); } } // re-issue attack-move every 5 s (open ground, no stalls)
  const a = alive(0), b = alive(1), bo = b.filter(u => !u.risen);
  const r = { time: +t.toFixed(1), aLeft: a.length, bLeft: b.length, bLeftOrig: bo.length, risen: G.stats.risen, purified: G.stats.purified,
    aLost: A.filter(u => u.dead).length, aHpPct: Math.round(100 * a.reduce((s, u) => s + u.hp, 0) / hpA), bHpPct: Math.round(100 * bo.reduce((s, u) => s + u.hp, 0) / hpB) };
  r.win = !a.length && b.length ? 'b' : a.length && !b.length ? 'a' : 'draw';
  if (m.strictWin && m.research) r.win = m.strictWin(r) ? 'a' : 'b';   // L4 #6: pass/fail is about rising, not who wins
  else if (m.strictWin && r.win === 'a' && !m.strictWin(r)) r.win = 'a*';
  return r;
}
function runMatchup(m, runs = 20) {
  const res = []; for (let s = 1; s <= runs; s++) res.push(runOne(m, s));
  const wins = res.filter(r => r.win === m.expect).length, met = res.filter(r => r.win === m.expect && m.check(r)).length;
  const avg = k => +(res.reduce((s, r) => s + (r[k] || 0), 0) / res.length).toFixed(1);
  return { id: m.id, name: m.name, expect: m.expect, runs, wins, winRate: wins / runs, targetMet: met, target: m.target, res, avg };
}
module.exports = { MATCHUPS, MATCHUPS4, runOne, runMatchup };
if (require.main === module) {
  const runs = +process.argv[2] || 20;
  for (const m of MATCHUPS.concat(MATCHUPS4)) {
    if (m === MATCHUPS4[0]) console.log('--- Loop 4 matchups (reported, not asserted in npm test) ---');
    const r = runMatchup(m, runs);
    const extra = m.custom === 'medic' ? `with Medics alive avg ${r.avg('withAlive')}/4, without avg ${r.avg('withoutAlive')}/4` : m.custom === 'aura' ? `damage without Holy Ground avg ${r.avg('dmgNoHG')}, inside Holy Ground avg ${r.avg('dmgHG')}` : m.truck ? `crushed avg ${r.avg('crushed')}, truck HP lost avg ${r.avg('truckLossPct')}%` : `A left ${r.avg('aLeft')} (HP ${r.avg('aHpPct')}%), B left ${r.avg('bLeft')} (orig ${r.avg('bLeftOrig')}, HP ${r.avg('bHpPct')}%), risen ${r.avg('risen')}, purified ${r.avg('purified')}, time ${r.avg('time')}s`;
    console.log(`${r.id.padEnd(3)} ${(r.winRate * 100).toFixed(0).padStart(3)}% ${r.winRate >= 0.8 ? 'PASS' : 'FAIL'} | target met ${r.targetMet}/${runs} | ${r.name} | ${extra} | outcomes ${[...new Set(r.res.map(x => x.win))].map(w => w + ':' + r.res.filter(x => x.win === w).length).join(' ')}`);
  }
}
