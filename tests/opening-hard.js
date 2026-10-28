// node tests/opening-hard.js [seeds=10]  -> Hard regression over seeds 1..N (Dezi ruling: Hard check 2 replaced by 2a / 2b / 2c, no AI tuning)
//  per seed: checks 1, 2a (AI economy by 3:00), 2b (wave 1 at 4:00 +/- 5 s), 3, 4 must pass; 2c: player HQ alive at 8:00 on >= 8 of 10 seeds
'use strict';
const { load } = require('./harness.js');
const { openingSim } = require('./opening-sim.js');
const N = +(process.argv[2] || 10), need = Math.ceil(N * 0.8);
const fmt = t => t === null || t === undefined ? '-' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
let ok = true, alive8 = 0; const rows = [];
for (let s = 1; s <= N; s++) {
  const { RTS, seed } = load(); seed(s);
  const r = openingSim(RTS, { diff: 'hard' }), n = r.numbers;
  const fails = Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k.split(' ')[0]);
  const a8 = Object.values(r.aggregate).every(Boolean); if (a8) alive8++;
  if (fails.length) ok = false;
  rows.push({ seed: s, hq8: n.hqHpPctAt480, hq12: n.hqHpPct, hqDead: fmt(n.hqDeadAt), hqFirstHit: fmt(n.hqFirstHitAt), eaters2: fmt(n.aiEaters2At), grinderPit: fmt(n.aiGrinderPitAt), spawningPit: fmt(n.aiSpawningPitAt), wave1: fmt(n.wave1At), fails: fails.join(',') || 'none' });
}
console.table(rows);
const agg = alive8 >= need;
console.log(`2c player HQ alive at 8:00: ${alive8}/${N} seeds (need >= ${need}) ${agg ? 'PASS' : 'FAIL'}`);
console.log(ok && agg ? 'HARD REGRESSION PASS' : 'HARD REGRESSION FAIL');
process.exit(ok && agg ? 0 : 1);
