// node tests/rush.js [seeds=10] [--minutes 6]  -> Job F rush sims (Director, Oct 28), Normal and Hard, seeds 1..N. Report only, no tuning.
//  (a) player Barracks rush: Barracks at 0:00 (before the Power Plant), Riflemen non-stop to 3:00, attack-move every 4+ idle Riflemen at the Hive
//  (b) AI Spawning-Pit rush: the AI queues its Spawning Pit at 0:00 and attack-moves every 4+ idle army units at the player HQ (its own build /
//      unit logic otherwise unchanged); the player plays the standard opening (tests/opening-sim.js)
//  per run: first HQ / Hive hit, HQ and Hive HP at 3:00 and 5:00, units lost per side, economy stall per side
//  (stall = no Credits income for >= 60 s between 1:00 and 5:00, or no living harvester for >= 30 s)
//  checks (addendum 1d §8): R1 (a) the Hive is alive at 5:00 on Normal and Hard, 10/10; R2 (b) the player HQ is at >= 60% at 5:00, 10/10
//  rush columns: the AI rush response (AI_RUSH_DEFENSE) on / most attackers seen / off times
//  --out <file>: also write the rows as JSON (kept out of the repo)
'use strict';
const { load } = require('./harness.js');
const { openingSim } = require('./opening-sim.js');
const argv = process.argv.slice(2), opt = (k, d) => { const i = argv.indexOf(k); if (i < 0) return d; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const OUT = opt('--out', null), MIN = +opt('--minutes', 6), N = +(argv[0] || 10);
const fmt = t => t === null || t === undefined ? '-' : `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}`;
function run(mode, diff, s, extraTick) {
  const { RTS, seed } = load(); seed(s);
  const T = { hq: [null, null], hp3: [null, null], hp5: [null, null], inc: [0, 0], lastInc: [0, 0], gap: [0, 0], noHarv: [0, 0], noHarvSince: [null, null], sent: 0 };
  let G, hqs;
  const pct = b => b.dead ? 0 : Math.round(100 * b.hp / b.maxhp);
  const onStart = g => {
    G = g; hqs = [0, 1].map(sd => G.blds.find(b => b.side === sd && b.type === 'hq'));
    const raw = G.credits; G.credits = new Proxy(raw, { set(t, k, v) { if ((k === '0' || k === '1') && v > t[k]) { T.inc[k] += v - t[k]; if (G.time >= 60) { T.gap[k] = Math.max(T.gap[k], G.time - T.lastInc[k]); } T.lastInc[k] = G.time; } t[k] = v; return true; } });
    if (mode === 'b') RTS.queueItem(1, 'barracks');   // the AI's Spawning Pit first; updAI places it when ready
  };
  const onTick = () => {
    const t = G.time; if (extraTick) extraTick(G, RTS);
    for (const sd of [0, 1]) {
      if (T.hq[sd] === null && hqs[sd].hp < hqs[sd].maxhp) T.hq[sd] = t;
      const h = G.units.some(u => u.side === sd && u.d.harv && !u.dead);
      if (!h) { if (T.noHarvSince[sd] === null) T.noHarvSince[sd] = t; T.noHarv[sd] = Math.max(T.noHarv[sd], t - T.noHarvSince[sd]); } else T.noHarvSince[sd] = null;
    }
    if (T.hp3[0] === null && t >= 180) T.hp3 = hqs.map(pct);
    if (T.hp5[0] === null && t >= 300) T.hp5 = hqs.map(pct);
    if (t >= 300 && T.alive5 === undefined) T.alive5 = hqs.map(b => !b.dead);
    if (mode === 'a') {
      const q = G.queues[0].infantry;
      if (t < 180 && q.list.length < 2 && G.credits[0] >= 100 && G.blds.some(b => b.side === 0 && b.type === 'barracks' && !b.dead)) RTS.queueItem(0, 'survivor');
      const idle = G.units.filter(u => u.side === 0 && u.type === 'survivor' && !u.dead && !u.target && u.order !== 'attackmove' && u.order !== 'attack');
      if (idle.length >= 4 && !hqs[1].dead) { RTS.issueMove(idle, hqs[1].x, hqs[1].y, true); T.sent += idle.length; }
    } else {
      const idle = G.units.filter(u => u.side === 1 && !u.dead && !u.d.harv && !u.target && u.order !== 'attackmove' && u.order !== 'attack');
      if (idle.length >= 4 && !hqs[0].dead) { RTS.issueMove(idle, hqs[0].x, hqs[0].y, true); T.sent += idle.length; }
    }
  };
  const plan = mode === 'a' ? ['barracks', 'power', 'refinery', 'factory', 'turret', 'power', 'depot', 'turret', 'power'] : undefined;
  const r = openingSim(RTS, { diff, minutes: MIN, plan, onStart, onTick });
  for (const sd of [0, 1]) if (G.time - T.lastInc[sd] > T.gap[sd] && G.time >= 60) T.gap[sd] = Math.min(300, G.time) - Math.max(60, T.lastInc[sd]);
  const stall = sd => T.gap[sd] >= 60 || T.noHarv[sd] >= 30;
  if (T.alive5 === undefined) T.alive5 = hqs.map(b => !b.dead);   // the game ended before 5:00
  if (T.hp5[0] === null) T.hp5 = hqs.map(pct);
  const rl = G.ai.rushLog || [];
  const pb = r.numbers.barracksAt, ab = r.numbers.aiSpawningPitAt;
  return { seed: s, P_barracks: fmt(pb), AI_pit: fmt(ab), sent: T.sent,
    hqHit: fmt(T.hq[0]), hiveHit: fmt(T.hq[1]), 'HQ@3': T.hp3[0], 'HQ@5': T.hp5[0], 'Hive@3': T.hp3[1], 'Hive@5': T.hp5[1],
    lostP: G.stats.lost, lostAI: G.stats.kills, incP: Math.round(T.inc[0]), incAI: Math.round(T.inc[1]), maxGapP: +T.gap[0].toFixed(0), maxGapAI: +T.gap[1].toFixed(0),
    rushOn: rl.map(x => fmt(x.t0)).join(' ') || '-', rushN: rl.map(x => x.n).join(' ') || '-', rushOff: rl.map(x => fmt(x.t1)).join(' ') || '-',
    hiveAlive5: T.alive5[1], stallP: stall(0), stallAI: stall(1), over: G.over ? (hqs[0].dead ? 'P lost' : 'AI lost') : '' };
}
module.exports = { run };
if (require.main === module) {
const all = {};
for (const mode of ['a', 'b']) for (const diff of ['normal', 'hard']) {
  const rows = []; for (let s = 1; s <= N; s++) rows.push(run(mode, diff, s));
  const k = `${mode === 'a' ? '(a) player Barracks rush' : '(b) AI Spawning-Pit rush'} - ${diff}`;
  console.log('\n' + k); console.table(rows); all[k] = rows;
  if (mode === 'a') { const n = rows.filter(r => r.hiveAlive5).length; console.log(`R1 ${diff}: Hive alive at 5:00 on ${n}/${N} seeds (need ${N}/${N}) ${n === N ? 'PASS' : 'FAIL'}`); }
  else { const n = rows.filter(r => r['HQ@5'] >= 60).length; console.log(`R2 ${diff}: player HQ >= 60% at 5:00 on ${n}/${N} seeds (need ${N}/${N}) ${n === N ? 'PASS' : 'FAIL'}`); }
}
if (OUT) require('fs').writeFileSync(OUT, JSON.stringify(all, null, 1));
}
