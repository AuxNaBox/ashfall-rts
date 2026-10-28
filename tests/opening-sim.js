// Loop 4 opening addendum: 12-minute Normal regression with a scripted player following the expected opening
// (Truck + Power Plant at 0:00, Scrap Yard when affordable, Barracks, then Riflemen / Factory ...).
// Runs in node (tests/opening.js via the vm harness) and in the browser (rts-test/loop4.js injects this file).
// openingSim(RTS, { minutes, startCredits, dt, diff, map }) -> { checks, numbers, log }
const WAVE1_TARGET = { easy: 390, normal: 300, hard: 240 };
function openingSim(RTS, opts) {
  opts = opts || {};
  const minutes = opts.minutes || 12, dt = opts.dt || 1 / 30;
  if (!opts.noNewGame) RTS.newGame(opts.diff || 'normal', opts.map ? { map: opts.map } : undefined);   // opts.map: a design map JSON (env pass 1)
  const G = RTS.G, log = [];
  if (opts.startCredits) G.credits[0] = opts.startCredits;
  const hq0 = G.blds.find(b => b.side === 0 && b.type === 'hq');
  const snap = tag => { const c = s => G.units.filter(u => u.side === s && !u.dead).length; const bb = s => G.blds.filter(b => b.side === s && !b.dead).map(b => b.type).join(','); log.push(`${tag} t=${G.time.toFixed(0)} cr=${G.credits.map(Math.floor)} units=${c(0)}/${c(1)} P[${bb(0)}] E[${bb(1)}] waves=${G.ai.waveN} hq=${Math.round(hq0.hp)}`); };
  // place near the HQ, keeping the HQ dock pad and a 1-tile margin clear (canPlace margin 1)
  const tryPlace = () => {
    const q = G.queues[0].structure; if (!q.ready) return;
    const d = RTS.BDEF[q.ready];
    for (let r = 4; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
      const tx = hq0.tx + 1 + dx - (d.w >> 1), ty = hq0.ty + 1 + dy - (d.h >> 1);
      if (RTS.canPlace(0, q.ready, tx, ty, 1) && RTS.placeBld(0, q.ready, tx, ty)) return;
    }
  };
  const plan = ['power', 'refinery', 'barracks', 'factory', 'turret', 'power', 'depot', 'turret', 'power'];
  const first = {}; const reach = t => { if (first[t] === undefined && G.blds.some(b => b.side === 0 && b.type === t && !b.dead)) first[t] = G.time; };
  const blockT = new Map(); let maxBlock = [0, 0];
  let eaters180 = null, minHqPct = 1, eaters2At = null, hqAt480 = null, hqDeadAt = null, hqFirstHitAt = null; const aiFirst = {};
  RTS.queueItem(0, 'gleaner'); // 0:00 a Truck from the HQ (1,300 left) ...
  for (let i = 0; i < minutes * 60 / dt; i++) {
    RTS.step(dt);
    if (G.over) break;
    // check 4: Trucks waiting on a full storage cap (u.blocked), longest continuous wait before 6:00
    if (G.time < 360) for (const u of G.units) if (u.d.harv && !u.dead) {
      if (u.blocked) { const v = (blockT.get(u) || 0) + dt; blockT.set(u, v); if (v > maxBlock[u.side]) maxBlock[u.side] = v; } else blockT.set(u, 0);
    }
    if (eaters180 === null && G.time >= 180) eaters180 = G.units.filter(u => u.side === 1 && u.type === 'reaper' && !u.dead).length;
    minHqPct = Math.min(minHqPct, hq0.dead ? 0 : hq0.hp / hq0.maxhp);
    // Hard checks 2a-2c (Dezi): AI economy milestones, player HQ at 8:00, when it was first hit / destroyed
    if (eaters2At === null && G.units.filter(u => u.side === 1 && u.type === 'reaper' && !u.dead).length >= 2) eaters2At = G.time;
    for (const t of ['refinery', 'barracks']) if (aiFirst[t] === undefined && G.blds.some(b => b.side === 1 && b.type === t && !b.dead)) aiFirst[t] = G.time;
    if (hqFirstHitAt === null && hq0.hp < hq0.maxhp) hqFirstHitAt = G.time;
    if (hqDeadAt === null && hq0.dead) hqDeadAt = G.time;
    if (hqAt480 === null && G.time >= 480) hqAt480 = hq0.dead ? 0 : Math.round(100 * hq0.hp / hq0.maxhp);
    if (i % Math.round(0.5 / dt) === 0) {
      for (const t of ['barracks', 'factory', 'refinery']) reach(t);
      tryPlace();
      const q = G.queues[0], cr = G.credits[0];
      const next = plan[0], nextCost = next ? RTS.BDEF[next].cost : 0;
      if (next && !q.structure.list.length && !q.structure.ready && cr >= nextCost && RTS.queueItem(0, next)) plan.shift();
      const rifles = G.units.filter(u => u.side === 0 && u.type === 'survivor' && !u.dead).length + q.infantry.list.length;
      const hasF = G.blds.some(b => b.side === 0 && b.type === 'factory');
      // infantry: keep 3 Riflemen once the Barracks stands; beyond that only from surplus over the next structure (more after the Factory)
      if (q.infantry.list.length < 2 && G.blds.some(b => b.side === 0 && b.type === 'barracks')) {
        if (rifles < 3 && cr >= 100) RTS.queueItem(0, 'survivor');
        else if (cr - (plan.length ? nextCost : 0) >= (hasF ? 100 : 400)) RTS.queueItem(0, 'survivor');
      }
      if (hasF && q.vehicle.list.length < 1 && cr - (plan.length ? nextCost : 0) >= 800) RTS.queueItem(0, 'ark');
    }
    if (i % Math.round(60 / dt) === 0) snap('min');
  }
  snap('end');
  const A = G.ai;
  const numbers = {
    barracksAt: first.barracks ?? null, factoryAt: first.factory ?? null, yardAt: first.refinery ?? null,
    hqHpPct: hq0.dead ? 0 : Math.round(100 * hq0.hp / hq0.maxhp), hqMinHpPct: Math.round(100 * minHqPct), hqAlive: !hq0.dead,
    aiEatersAt180: eaters180, wave1At: A.wave1At ?? null, waves: A.waveLog || [], maxBlockedS: maxBlock.map(v => +v.toFixed(1)),
    hqHpPctAt480: hqAt480, hqDeadAt, hqFirstHitAt, aiEaters2At: eaters2At, aiGrinderPitAt: aiFirst.refinery ?? null, aiSpawningPitAt: aiFirst.barracks ?? null,
    over: G.over, time: +G.time.toFixed(0), stats: G.stats, credits: G.credits.map(Math.floor),
  };
  // check 3 wave-1 target per difficulty (fixed here, not read from game.js DIFF): Easy 6:30, Normal 5:00, Hard 4:00, each +/- 5 s
  const diff = opts.diff || 'normal', W1 = WAVE1_TARGET[diff] || WAVE1_TARGET.normal, W1L = Math.floor(W1 / 60) + ':' + String(W1 % 60).padStart(2, '0');
  // Hard (Dezi ruling, AI tuning unchanged): check 2 (HQ >= 50% at 12:00) is replaced by 2a / 2b / 2c. 2c is judged across seeds
  // (HQ alive at 8:00 on >= 8 of 10 seeds, tests/opening-hard.js), so it is returned in `aggregate`, not `checks`. Easy / Normal unchanged.
  const by = (t, lim) => t !== null && t !== undefined && t <= lim;
  const check2 = diff === 'hard' ? {
    '2a AI economy: 2 Scrap Eaters, a Grinder Pit and a Spawning Pit by 3:00 (hard)': by(eaters2At, 180) && by(aiFirst.refinery, 180) && by(aiFirst.barracks, 180),
    '2b AI wave 1 at 4:00 +/- 5 s (hard)': numbers.wave1At !== null && Math.abs(numbers.wave1At - 240) <= 5,
  } : { '2 HQ survives to 12:00 with >= 50% HP': numbers.hqAlive && numbers.hqHpPct >= 50 && G.time >= minutes * 60 - 1 };
  const aggregate = diff === 'hard' ? { '2c player HQ survives to 8:00 (hard; >= 8 of 10 seeds)': hqDeadAt === null || hqDeadAt > 480 } : {};
  const checks = {
    '1 Barracks by 3:45 and Factory by 6:30': numbers.barracksAt !== null && numbers.barracksAt <= 225 && numbers.factoryAt !== null && numbers.factoryAt <= 390,
    ...check2,
    [`3 AI has 2 Scrap Eaters by 3:00 and sends wave 1 at ${W1L} +/- 5 s (${diff})`]: eaters180 >= 2 && numbers.wave1At !== null && Math.abs(numbers.wave1At - W1) <= 5,
    '4 no Truck waits on a full cap > 20 s before 6:00': maxBlock[0] <= 20 && maxBlock[1] <= 20,
  };
  return { checks, aggregate, numbers, log };
}
if (typeof module !== 'undefined' && module.exports) module.exports = { openingSim };
