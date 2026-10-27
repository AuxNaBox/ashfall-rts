// Combat spec (loop3/1-combat-spec.md) automated matchups, run on the real game code headless.
// Open ground, no plague, sides 8 tiles apart, both attack-move. 20 seeded runs each; pass = expected side wins >= 80%.
// CLI: node tests/matchups.js [runs]
'use strict';
const { load, mulberry32 } = require('./harness');
const TILE = 32, CX = 30 * TILE, CY = 40 * TILE, GAP = 8 * TILE, LIMIT = 240;

const MATCHUPS = [
  { id: '1', name: '6 Riflemen (600) vs 10 Zombies (600)', a: { survivor: 6 }, b: { zombie: 10 }, expect: 'b', target: 'Zombies win with 3-6 left (risen counted separately)', check: r => r.bLeftOrig >= 3 && r.bLeftOrig <= 6 },
  { id: '2', name: '1 Tank (800) vs 13 Zombies (780)', a: { ark: 1 }, b: { zombie: 13 }, expect: 'a', target: 'Tank wins with >= 20% HP', check: r => r.aHpPct >= 20 },
  { id: '3', name: '4 Angels (1,800) vs 9 Imps (1,800)', a: { seraph: 4 }, b: { imp: 9 }, expect: 'b', target: 'Imps win with >= 3 left', check: r => r.bLeft >= 3 },
  { id: '4', name: '9 Riflemen (900) vs 4 Imps (800)', a: { survivor: 9 }, b: { imp: 4 }, expect: 'a', target: 'Riflemen win with >= 5 left', check: r => r.aLeft >= 5 },
  { id: '5a', name: '1 Hellbrute (900) vs 1 Tank (800)', a: { ark: 1 }, b: { brute: 1 }, expect: 'b', target: 'Hellbrute wins with 15-40% HP', check: r => r.bHpPct >= 15 && r.bHpPct <= 40 },
  { id: '5b', name: '2 Angels vs 1 Hellbrute', a: { seraph: 2 }, b: { brute: 1 }, expect: 'a', target: 'Angels win with 0 losses', check: r => r.aLost === 0, strictWin: r => r.aLost === 0 },
  { id: '6', name: 'Scrap Truck drives through 5 Zombies', truck: true, expect: 'a', target: 'crush >= 3 and lose <= 25% HP', check: r => r.crushed >= 3 && r.truckLossPct <= 25, strictWin: r => r.crushed >= 3 && r.truckLossPct <= 25 },
];

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
  if (m.strictWin && r.win === 'a' && !m.strictWin(r)) r.win = 'a*';
  return r;
}
function runMatchup(m, runs = 20) {
  const res = []; for (let s = 1; s <= runs; s++) res.push(runOne(m, s));
  const wins = res.filter(r => r.win === m.expect).length, met = res.filter(r => r.win === m.expect && m.check(r)).length;
  const avg = k => +(res.reduce((s, r) => s + (r[k] || 0), 0) / res.length).toFixed(1);
  return { id: m.id, name: m.name, expect: m.expect, runs, wins, winRate: wins / runs, targetMet: met, target: m.target, res, avg };
}
module.exports = { MATCHUPS, runOne, runMatchup };
if (require.main === module) {
  const runs = +process.argv[2] || 20;
  for (const m of MATCHUPS) {
    const r = runMatchup(m, runs);
    const extra = m.truck ? `crushed avg ${r.avg('crushed')}, truck HP lost avg ${r.avg('truckLossPct')}%` : `A left ${r.avg('aLeft')} (HP ${r.avg('aHpPct')}%), B left ${r.avg('bLeft')} (orig ${r.avg('bLeftOrig')}, HP ${r.avg('bHpPct')}%), risen ${r.avg('risen')}, purified ${r.avg('purified')}, time ${r.avg('time')}s`;
    console.log(`${r.id.padEnd(3)} ${(r.winRate * 100).toFixed(0).padStart(3)}% ${r.winRate >= 0.8 ? 'PASS' : 'FAIL'} | target met ${r.targetMet}/${runs} | ${r.name} | ${extra} | outcomes ${[...new Set(r.res.map(x => x.win))].map(w => w + ':' + r.res.filter(x => x.win === w).length).join(' ')}`);
  }
}
