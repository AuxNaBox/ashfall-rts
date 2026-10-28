// node tests/remote-ai.js [seeds=10]  -> remote yards spec §9.4: AI expansion sim
//  Normal seeds 1..N to 7:00: the 2nd Grinder Pit is >= 15 tiles from the Hive by 7:00 on >= 8 of 10 seeds
//  Easy seeds 1..N to 10:00: no remote Grinder Pit before 10:00
'use strict';
const { load } = require('./harness.js');
const { openingSim } = require('./opening-sim.js');
const N = +(process.argv[2] || 10), need = Math.ceil(N * 0.8);
const fmt = t => t === null || t === undefined ? '-' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
function run(diff, s, minutes) {
  const { RTS, seed } = load(); seed(s);
  openingSim(RTS, { diff, minutes });
  const G = RTS.G, hive = G.blds.find(b => b.side === 1 && b.type === 'hq') || { tx: G.baseE.x - 1, ty: G.baseE.y - 1, w: 3, h: 3 };
  const hx = hive.tx + hive.w / 2, hy = hive.ty + hive.h / 2, log = G.ai.pitLog || [];
  const p2 = log[1], dist = p2 ? Math.hypot(p2.tx + 1.5 - hx, p2.ty + 1 - hy) : null;
  return { RTS, G, log, p2, dist };
}
let ok = true; const rows = []; let hits = 0;
for (let s = 1; s <= N; s++) {
  const r = run('normal', s, 7), good = !!(r.p2 && r.p2.t <= 420 && r.dist >= 15); if (good) hits++;
  rows.push({ diff: 'normal', seed: s, pits: r.log.length, pit2At: fmt(r.p2 && r.p2.t), pit2Tile: r.p2 ? `${r.p2.tx},${r.p2.ty}` : '-', pit2Dist: r.dist === null ? '-' : +r.dist.toFixed(1), remote: r.p2 ? r.p2.remote : '-', ok: good });
}
const normalOk = hits >= need;
let easyOk = true;
for (let s = 1; s <= N; s++) {
  const r = run('easy', s, 10), early = r.log.filter(p => p.remote && p.t < 600); if (early.length) easyOk = false;
  rows.push({ diff: 'easy', seed: s, pits: r.log.length, pit2At: fmt(r.p2 && r.p2.t), pit2Tile: r.p2 ? `${r.p2.tx},${r.p2.ty}` : '-', pit2Dist: r.dist === null ? '-' : +r.dist.toFixed(1), remote: r.p2 ? r.p2.remote : '-', ok: !early.length });
}
console.table(rows);
console.log(`Normal: 2nd pit >= 15 tiles from the Hive by 7:00 on ${hits}/${N} seeds (need >= ${need}) ${normalOk ? 'PASS' : 'FAIL'}`);
console.log(`Easy: no remote pit before 10:00 ${easyOk ? 'PASS' : 'FAIL'}`);
ok = normalOk && easyOk;
console.log(ok ? 'REMOTE AI PASS' : 'REMOTE AI FAIL');
process.exit(ok ? 0 : 1);
