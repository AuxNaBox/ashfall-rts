// Loop 5 §10 M1–M12 and §13 M13–M17. 20 seeds, pass = target met on >= 16/20. Reported, not asserted in npm test.
'use strict';
const { load, mulberry32 } = require('./harness');
const TILE = 32, CX = 30 * TILE, CY = 40 * TILE, GAP = 8 * TILE, LIMIT = 240;

const MATCHUPS5 = [
  { id: 'M1', name: '1 Flame Tower vs 15 Zombies', b: { zombie: 15 }, bldsA: { flametower: 1 }, expect: 'a', target: 'the tower survives', check: r => r.aBldAlive >= 1 },
  { id: 'M2', name: '1 Flame Tower vs 5 Rocket Soldiers from range', a: { rocket: 5 }, bldsB: { flametower: 1 }, expect: 'a', target: 'soldiers win, lose 1 at most', check: r => r.aLeft >= 4, gap: 6 },
  { id: 'M3a', name: '1 Rocket Tower vs 1 Tank', a: { ark: 1 }, bldsB: { rockettower: 1 }, expect: 'b', target: 'the tower wins', check: () => true },
  { id: 'M3b', name: '2 Rocket Towers vs 3 Hellbrutes', b: { brute: 3 }, bldsA: { rockettower: 2 }, expect: 'a', target: 'the towers win', check: r => r.aBldAlive >= 1 },
  { id: 'M4', name: '1 Rocket Tower vs 8 Zombies', b: { zombie: 8 }, bldsA: { rockettower: 1 }, expect: 'b', target: 'the Zombies win', check: () => true },
  { id: 'M5', name: '2 Artillery + 1 Rifleman vs 1 Turret + 1 Rocket Tower', a: { artillery: 2, survivor: 1 }, bldsB: { turret: 1, rockettower: 1 }, expect: 'a', target: 'towers die, 0 Artillery lost', check: r => r.aLostArt === 0 && r.bBldAlive === 0, gap: 9 },
  { id: 'M6', name: '2 Artillery vs 3 Imps rushing', a: { artillery: 2 }, b: { imp: 3 }, expect: 'b', target: 'the Imps win', check: () => true, gap: 2 },
  { id: 'M7', name: 'Plague Sprayer vs 10 Riflemen', a: { survivor: 10 }, b: { sprayer: 1 }, expect: 'b', target: 'Sprayer kills 5+ before dying', check: r => r.aLost >= 5 },
  { id: 'M8', name: 'Plague Sprayer vs 1 Templar', a: { templar: 1 }, b: { sprayer: 1 }, expect: 'a', target: 'Templar wins with more than 50% HP', check: r => r.aHpPct > 50 },
  { id: 'M9', name: 'Purifier vs 20 Zombies in a plague zone', a: { purifier: 1 }, b: { zombie: 20 }, expect: 'a', target: 'the Purifier survives', check: r => r.aLeft >= 1, plague: true },
  { id: 'M10', name: 'APC drop of 5 Rocket Soldiers on an unguarded Grinder Pit', custom: 'drop', expect: 'a', target: 'the pit dies within 30 s of unload', check: r => r.killedIn <= 30 },
  { id: 'M11', name: '15 Zombies vs a 6-segment wall + 1 Flame Tower', b: { zombie: 15 }, custom: 'hold', expect: 'a', target: 'the defense holds', check: r => r.aBldAlive >= 1 && r.towerAlive },
  { id: 'M12', name: '1v1 pair win splits between 40/60 and 60/40', custom: 'pairs', expect: 'a', target: 'each pair is within 40/60–60/40', check: r => r.pairsOk },
  { id: 'M13', name: '4 Spitters vs 1 Tank', a: { ark: 1 }, b: { spitter: 4 }, expect: 'b', target: 'Spitters win and lose 1 at most', check: r => r.bLeft >= 3 },
  { id: 'M14', name: '4 Spitters vs 1 Tank compared with 4 Rocket Soldiers vs 1 Hellbrute', custom: 'compare', expect: 'a', target: 'win rates within 10 points', check: r => r.delta <= 10 },
  { id: 'M15', name: '6 Riflemen vs 2 Spitters (equal cost)', a: { survivor: 6 }, b: { spitter: 2 }, expect: 'a', target: 'the Riflemen win', check: () => true },
  { id: 'M16', name: '3 Flamers vs 4 Spitters', a: { flamer: 3 }, b: { spitter: 4 }, expect: 'a', target: 'the Flamers win', check: () => true },
  { id: 'M17', name: 'Imps with Long Spines vs equal-cost Riflemen', a: { survivor: 10 }, b: { imp: 5 }, research: { 1: ['spines', 'claws'] }, expect: 'split', target: 'win split between 40/60 and 60/40', check: r => true, split: true },
  { id: 'M18', name: '4 Shock Troopers vs 1 Flame Tower', a: { shock: 4 }, bldsB: { flametower: 1 }, expect: 'b', target: 'the tower wins', check: () => true },
  { id: 'M19', name: '4 Ghoul Leapers leap a 6-segment wall and kill 2 unescorted Artillery within 20 s', custom: 'leapkill', expect: 'a', target: 'both Artillery die within 20 s', check: r => r.killedIn <= 20 },
  { id: 'M20', name: '3 unescorted Demo Squads vs 1 Turret', a: { demo: 3 }, bldsB: { turret: 1 }, expect: 'b', target: 'the Turret survives', check: r => r.bBldAlive >= 1 },
  { id: 'M21', name: '3 Demo Squads escorted by 4 Riflemen vs 1 Turret', a: { demo: 3, survivor: 4 }, bldsB: { turret: 1 }, expect: 'a', target: 'the Turret dies', check: r => r.bBldAlive === 0 },
  { id: 'M22', name: '2 Bloaters with a 6-Zombie escort vs a 6-segment wall plus a Flame Tower', custom: 'bloatbreach', expect: 'a', target: 'the wall is breached', check: r => r.breached },
  { id: 'M23', name: '5 unescorted Demo Squads vs an HQ', a: { demo: 5 }, bldsB: { hq: 1 }, expect: 'b', target: 'the HQ ends above 50%', check: r => r.bHpBld > 50 },
];

let H = null;
function boot(seed) {
  if (!H) H = load();
  H.seed(seed * 7919 + 13);
  const R = H.RTS; R.newArena(seed);
  R.G.testPower = true; // matchups assume towers and gates have power, without placing a plant in the fight
  return R;
}
function placeBlds(R, counts, side, x0) {
  const out = []; let k = 0;
  for (const t in counts) for (let i = 0; i < counts[t]; i++, k++) {
    const col = Math.floor(k / 2), row = k % 2;
    const tx = Math.floor((x0 + (side ? 1 : -1) * col * 2 * TILE) / TILE);
    const ty = Math.floor((CY + (row - 0.5) * 2 * TILE) / TILE);
    out.push(R.makeBld(t, side, tx, ty));
  }
  return out;
}
function spawnUnits(R, counts, side, x0, jit) {
  const out = []; let k = 0;
  for (const t in counts) for (let i = 0; i < counts[t]; i++, k++) {
    const col = Math.floor(k / 5), row = k % 5;
    out.push(R.makeUnit(t, side, x0 + (side ? 1 : -1) * col * 24 + jit(), CY + (row - 2) * 24 + jit()));
  }
  return out;
}
function runCustom(m, R, seed, jit) {
  const G = R.G;
  if (m.custom === 'drop') {
    const pit = R.makeBld('refinery', 1, Math.floor(CX / TILE) + 4, Math.floor(CY / TILE) - 1);
    const apc = R.makeUnit('apc', 0, CX - 3 * TILE, CY);
    const men = []; for (let i = 0; i < 5; i++) men.push(R.makeUnit('rocket', 0, apc.x, apc.y));
    for (const u of men) R.loadUnit(apc, u);
    R.issueMove([apc], pit.x, pit.y, false); apc.unloadAfter = true;
    let unloadedAt = null, t = 0;
    while (t < 60 && !pit.dead) {
      R.step(1 / 30); t += 1 / 30;
      if (unloadedAt == null && men.every(u => !u.carried)) unloadedAt = t;
      if (unloadedAt != null) {
        const live = men.filter(u => !u.dead);
        if (live.length && (!live[0].target || live[0].target.dead)) R.orderAttack(live, pit);
      }
    }
    const r = { killedIn: pit.dead && unloadedAt != null ? +(t - unloadedAt).toFixed(1) : 99, time: +t.toFixed(1), pitDead: pit.dead };
    r.win = m.check(r) ? 'a' : 'b';
    return r;
  }
  if (m.custom === 'hold') {
    const tx = Math.floor(CX / TILE), ty = Math.floor(CY / TILE);
    const walls = []; for (let i = 0; i < 6; i++) walls.push(R.makeBld('wall', 0, tx, ty - 2 + i));
    const tw = R.makeBld('flametower', 0, tx - 2, ty);
    const zs = []; for (let i = 0; i < 15; i++) zs.push(R.makeUnit('zombie', 1, CX + 6 * TILE + (i % 5) * 20, CY + (Math.floor(i / 5) - 2) * 24 + jit()));
    R.issueMove(zs, tw.x, tw.y, true);
    let t = 0;
    while (t < 90 && !tw.dead && zs.some(z => !z.dead)) { R.step(1 / 30); t += 1 / 30; }
    const r = { aBldAlive: [tw, ...walls].filter(b => !b.dead).length, towerAlive: !tw.dead, bLeft: zs.filter(z => !z.dead).length, time: +t.toFixed(1) };
    r.win = r.towerAlive ? 'a' : 'b';
    return r;
  }
  if (m.custom === 'pairs') {
    const pairs = [
      { a: { apc: 1 }, b: { crawler: 1 }, name: 'APC vs Crawler' },
      { a: { artillery: 1 }, b: { catapult: 1 }, name: 'Artillery vs Catapult' },
      { a: { purifier: 1 }, b: { sprayer: 1 }, name: 'Purifier vs Sprayer' },
      { bldsA: { flametower: 1 }, bldsB: { flametower: 1 }, name: 'Flame Tower vs Brimstone Spire', gap: 3 },
      { bldsA: { rockettower: 1 }, bldsB: { rockettower: 1 }, name: 'Rocket Tower vs Bone Cannon', gap: 5 },
    ];
    const rows = [];
    for (const p of pairs) {
      let aW = 0;
      for (let s = 1; s <= 20; s++) {
        const r = runOne({ id: 'p', a: p.a || {}, b: p.b || {}, bldsA: p.bldsA, bldsB: p.bldsB, expect: 'a', check: () => true, gap: p.gap }, s);
        if (r.win === 'a') aW++;
      }
      const rate = aW / 20;
      rows.push({ name: p.name, aW, rate, ok: rate >= 0.4 && rate <= 0.6 });
    }
    const r = { pairsOk: rows.every(x => x.ok), rows, time: 0 };
    r.win = r.pairsOk ? 'a' : 'b';
    return r;
  }
  if (m.custom === 'leapkill') {
    const tx = Math.floor(CX / TILE), ty = Math.floor(CY / TILE);
    for (let i = 0; i < 6; i++) R.makeBld('wall', 0, tx, ty - 2 + i);
    const arts = [R.makeUnit('artillery', 0, CX - 2 * TILE, CY - 16), R.makeUnit('artillery', 0, CX - 2 * TILE, CY + 16)];
    for (const a of arts) { a.scan = 1e9; a.order = 'idle'; }
    const leps = []; for (let i = 0; i < 4; i++) leps.push(R.makeUnit('leaper', 1, CX + 1.2 * TILE + (i % 2) * 16, CY + (Math.floor(i / 2) - 0.5) * 24 + jit()));
    R.issueMove(leps, arts[0].x, arts[0].y, true);
    let t = 0;
    while (t < 20 && arts.some(a => !a.dead)) { R.step(1 / 30); t += 1 / 30; }
    const r = { killedIn: arts.every(a => a.dead) ? +t.toFixed(1) : 99, time: +t.toFixed(1) };
    r.win = m.check(r) ? 'a' : 'b';
    return r;
  }
  if (m.custom === 'bloatbreach') {
    const tx = Math.floor(CX / TILE), ty = Math.floor(CY / TILE);
    const walls = []; for (let i = 0; i < 6; i++) walls.push(R.makeBld('wall', 0, tx, ty - 2 + i));
    const tw = R.makeBld('flametower', 0, tx - 2, ty);
    const zs = []; for (let i = 0; i < 6; i++) zs.push(R.makeUnit('zombie', 1, CX + 6 * TILE + (i % 3) * 18, CY + (Math.floor(i / 3) - 1) * 22 + jit()));
    const bl = []; for (let i = 0; i < 2; i++) bl.push(R.makeUnit('bloater', 1, CX + 7 * TILE + i * 20, CY + jit()));
    R.issueMove(zs.concat(bl), tw.x, tw.y, true);
    let t = 0;
    while (t < 90 && walls.every(w => !w.dead)) { R.step(1 / 30); t += 1 / 30; }
    const r = { breached: walls.some(w => w.dead), time: +t.toFixed(1), towerAlive: !tw.dead };
    r.win = r.breached ? 'a' : 'b';
    return r;
  }
  if (m.custom === 'compare') {
    const a = runMatchup({ id: 'c1', a: { ark: 1 }, b: { spitter: 4 }, expect: 'b', check: () => true }, 20);
    const b = runMatchup({ id: 'c2', a: { rocket: 4 }, b: { brute: 1 }, expect: 'a', check: () => true }, 20);
    const delta = Math.abs(a.winRate - b.winRate) * 100;
    const r = { delta, aRate: a.winRate, bRate: b.winRate, time: 0 };
    r.win = delta <= 10 ? 'a' : 'b';
    return r;
  }
}

function runOne(m, seed) {
  const R = boot(seed); const G = R.G;
  const jr = mulberry32(seed * 104729 + 7), jit = () => (jr() - 0.5) * 16;
  if (m.custom) return runCustom(m, R, seed, jit);
  if (m.research) for (const side in m.research) for (const id of m.research[side]) R.applyResearch(+side, id);
  const gap = (m.gap || 8) * TILE;
  const bA = placeBlds(R, m.bldsA || {}, 0, CX - gap / 2);
  const bB = placeBlds(R, m.bldsB || {}, 1, CX + gap / 2);
  const A = spawnUnits(R, m.a || {}, 0, CX - gap / 2, jit);
  const B = spawnUnits(R, m.b || {}, 1, CX + gap / 2, jit);
  if (m.plague) {
    // a contiguous plague zone around the standing Zombies (not the Purifier's start)
    const r = 3;
    for (const u of B) {
      const cx = Math.floor(u.x / TILE), cy = Math.floor(u.y / TILE);
      for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
        if (xx < 0 || yy < 0 || xx >= R.MW || yy >= R.MH) continue;
        R.plague[yy * R.MW + xx] = 1;
      }
    }
  }
  // M5: the Rifleman spots from inside its 6-tile sight so Artillery can fire at 9, outside Rocket Tower range
  if (A.some(u => u.type === 'artillery') && B.length === 0 && bB.length) {
    const dest = bB[0];
    for (const u of A) if (u.type === 'survivor') {
      const d = Math.hypot(dest.x - u.x, dest.y - u.y) || 1;
      const want = 5 * TILE;
      u.x = dest.x - (dest.x - u.x) / d * want;
      u.y = dest.y - (dest.y - u.y) / d * want;
    }
  }
  // M9: "Zombies standing in a plague zone" — they hold, and plague heals the Horde until the Purifier cleanses
  if (m.plague) for (const z of B) { z.scan = 1e9; z.order = 'idle'; z.target = null; }
  const hpA = A.reduce((s, u) => s + u.maxhp, 0) || 1, hpB = B.reduce((s, u) => s + u.maxhp, 0) || 1;
  const aliveU = side => G.units.filter(u => u.side === side && !u.dead && !u.carried && !u.d.harv);
  const aliveB = side => G.blds.filter(b => b.side === side && !b.dead);
  const order = () => {
    const a = aliveU(0), b = aliveU(1);
    const c = l => l.length ? { x: l.reduce((s, u) => s + u.x, 0) / l.length, y: l.reduce((s, u) => s + u.y, 0) / l.length } : null;
    const tb = c(aliveB(1).concat(b)), ta = c(aliveB(0).concat(a));
    if (a.length && (b.length || (tb && aliveB(1).length))) R.issueMove(a.filter(u => !u.target), (tb || { x: CX, y: CY }).x, (tb || { x: CX, y: CY }).y, true);
    if (!m.plague && b.length && (a.length || (ta && aliveB(0).length))) R.issueMove(b.filter(u => !u.target), (ta || { x: CX, y: CY }).x, (ta || { x: CX, y: CY }).y, true);
  };
  order();
  let t = 0, next = 5;
  const combatOver = () => {
    const aU = aliveU(0).length, bU = aliveU(1).length, aB = aliveB(0).length, bB = aliveB(1).length;
    const aArmed = aU + aB, bArmed = bU + bB;
    return !aArmed || !bArmed;
  };
  while (t < LIMIT && !combatOver()) { R.step(1 / 30); t += 1 / 30; if (t >= next) { next += 5; order(); } }
  const a = aliveU(0), b = aliveU(1);
  const r = {
    time: +t.toFixed(1), aLeft: a.length, bLeft: b.length, aBldAlive: aliveB(0).length, bBldAlive: aliveB(1).length,
    aLost: A.filter(u => u.dead).length, aLostArt: A.filter(u => u.type === 'artillery' && u.dead).length,
    aHpPct: Math.round(100 * a.reduce((s, u) => s + u.hp, 0) / hpA),
    bHpPct: Math.round(100 * b.reduce((s, u) => s + u.hp, 0) / hpB),
    bHpBld: bB[0] && !bB[0].dead ? Math.round(100 * bB[0].hp / bB[0].maxhp) : 0,
  };
  const aWin = (a.length || r.aBldAlive) && !b.length && !r.bBldAlive;
  const bWin = (b.length || r.bBldAlive) && !a.length && !r.aBldAlive;
  r.win = aWin ? 'a' : bWin ? 'b' : 'draw';
  return r;
}
function runMatchup(m, runs = 20) {
  if (m.custom === 'pairs' || m.custom === 'compare') {
    const r = runOne(m, 1);
    const met = m.check(r) ? runs : 0;
    return { id: m.id, name: m.name, expect: m.expect, runs, wins: m.check(r) ? runs : 0, winRate: m.check(r) ? 1 : 0, targetMet: met, target: m.target, res: [r], avg: k => r[k] || 0, detail: r };
  }
  const res = []; for (let s = 1; s <= runs; s++) res.push(runOne(m, s));
  const passOf = r => {
    if (m.split) return r.win === 'a' || r.win === 'b';
    return r.win === m.expect && m.check(r);
  };
  const wins = res.filter(r => r.win === m.expect || (m.split && (r.win === 'a' || r.win === 'b'))).length;
  const met = res.filter(r => passOf(r)).length;
  // M17: pass is the split of wins, not per-seed target
  const aW = res.filter(r => r.win === 'a').length, bW = res.filter(r => r.win === 'b').length;
  const splitOk = m.split && aW / runs >= 0.4 && aW / runs <= 0.6;
  const avg = k => +(res.reduce((s, r) => s + (r[k] || 0), 0) / res.length).toFixed(1);
  return { id: m.id, name: m.name, expect: m.expect, runs, wins, winRate: m.split ? aW / runs : wins / runs, targetMet: m.split ? (splitOk ? runs : 0) : met, target: m.target, res, avg, aW, bW, splitOk };
}

function printAll(runs = 20) {
  console.log('--- Loop 5 matchups M1–M23 (reported, not asserted in npm test; pass = 16/20) ---');
  const out = [];
  for (const m of MATCHUPS5) {
    const r = runMatchup(m, runs);
    const pass = r.targetMet >= Math.ceil(runs * 0.8);
    const extra = m.custom === 'drop' ? `killedIn avg ${r.avg('killedIn')}s` : m.custom === 'pairs' ? (r.detail.rows || []).map(x => `${x.name} ${(x.rate * 100).toFixed(0)}%${x.ok ? '' : ' FAIL'}`).join('; ') : m.custom === 'compare' ? `delta ${r.detail.delta.toFixed(1)} pts (spitter ${((r.detail.aRate || 0) * 100).toFixed(0)}% vs rocket ${((r.detail.bRate || 0) * 100).toFixed(0)}%)` : m.split ? `A ${r.aW}/${runs} B ${r.bW}/${runs}` : `A left ${r.avg('aLeft')} (HP ${r.avg('aHpPct')}%, blds ${r.avg('aBldAlive')}), B left ${r.avg('bLeft')} (HP ${r.avg('bHpPct')}%, blds ${r.avg('bBldAlive')}), time ${r.avg('time')}s`;
    const line = `${r.id.padEnd(4)} ${pass ? 'PASS' : 'FAIL'} | target met ${r.targetMet}/${runs} | ${r.name} | ${extra}`;
    console.log(line);
    out.push({ id: r.id, pass, targetMet: r.targetMet, runs, name: r.name, extra });
  }
  return out;
}
module.exports = { MATCHUPS5, runOne, runMatchup, printAll };
if (require.main === module) printAll(+process.argv[2] || 20);
