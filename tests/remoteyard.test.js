// Remote Scrap Yards (rts-loops/features/1-remote-scrap-yards.md §9): placement rules, symmetry, setup (R2), AI spot rules
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { load } = require('./harness.js');
const MAP = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', n + '.json'), 'utf8'));

// open 80x80 arena: Survivor HQ top-left (1,1), Horde HQ (76,76); half line x + y = 79 (baseP (2,2), baseE (77,77)); all explored
function arena() {
  const L = load(); L.seed(1); const RTS = L.RTS; RTS.newArena(1); const G = RTS.G;
  RTS.makeBld('hq', 0, 1, 1); RTS.makeBld('hq', 1, 76, 76); RTS.expl.fill(1); RTS.vis.fill(0);
  return { RTS, G };
}
const S = [20, 10]; // a remote spot in the arena: own half, far from the HQ (gap > 5), clear ground

test('remote yard: half grid (strictly closer HQ start centre wins, ties neutral) on the built-in map and the arena', () => {
  const L = load(); L.seed(1); const RTS = L.RTS; RTS.newGame('normal'); const G = RTS.G, { MW, MH } = RTS;
  let neutral = 0;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) { const h = G.half[y * MW + x]; if (x === y) { assert.equal(h, -1); neutral++; } else assert.equal(h, y > x ? 0 : 1, `${x},${y}`); }
  assert.equal(neutral, 80);
  // strip: own-half tiles within 3 (Chebyshev) of a non-own tile are out; 4 away are in
  assert.equal(G.halfIn[0][(40 + 6) * MW + 40], 0); assert.equal(G.halfIn[0][(40 + 7) * MW + 40], 1); // diagonal line: Chebyshev 3 = |y - x| <= 6
  const A = arena(); assert.equal(A.G.half[10 * 80 + 20], 0); assert.equal(A.G.half[69 * 80 + 10], -1); assert.equal(A.G.half[70 * 80 + 10], 1);
});

test('remote yard §9.1: a valid remote spot passes; every rule rejects with its reason', () => {
  let { RTS, G } = arena();
  let pc = RTS.placeCheck(0, 'refinery', S[0], S[1], 0); assert.deepEqual([pc.ok, pc.remote], [true, true]);
  // other buildings keep the near-own-buildings rule
  assert.deepEqual([RTS.placeCheck(0, 'power', S[0], S[1], 0).ok, RTS.placeCheck(0, 'power', S[0], S[1], 0).reason], [false, 'Too far from your base']);
  // enemy half / neutral line / front-line strip
  assert.equal(RTS.placeCheck(0, 'refinery', 50, 40, 0).reason, 'Enemy half');
  assert.equal(RTS.placeCheck(0, 'refinery', 38, 38, 0).reason, 'Enemy half');      // the dock tile (39,40) is neutral (39 + 40 = 79)
  assert.equal(RTS.placeCheck(0, 'refinery', 36, 37, 0).reason, 'Too close to the front line');
  // unexplored (the AI is exempt)
  RTS.expl.fill(0); assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).reason, 'Unexplored');
  RTS.expl.fill(0); assert.equal(RTS.placeCheck(1, 'refinery', 56, 66, 0).ok, true);
  RTS.expl.fill(1);
  // a 1-tile gap from Salvage
  RTS.res[(S[1] + 2) * 80 + S[0] + 3] = 100; assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).reason, 'Too close to Salvage');
  RTS.res[(S[1] + 2) * 80 + S[0] + 3] = 0; RTS.res[(S[1] + 3) * 80 + S[0] + 4] = 100; assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).ok, true); // 2 away
  RTS.res[(S[1] + 3) * 80 + S[0] + 4] = 0;
  // visible enemy unit within 6 (hidden ones don't count); 7 away is fine
  const u = RTS.makeUnit('zombie', 1, (S[0] + 3 + 5) * 32 + 16, (S[1] + 1) * 32 + 16);
  RTS.vis[(S[1] + 1) * 80 + S[0] + 8] = 1; assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).reason, 'Enemies nearby');
  RTS.vis[(S[1] + 1) * 80 + S[0] + 8] = 0; assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).ok, true);
  u.x += 2 * 32; RTS.vis.fill(1); assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).ok, true); RTS.vis.fill(0); u.dead = true;
  // enemy building within 10 (gap 9 rejects, gap 11 passes)
  ({ RTS, G } = arena());
  RTS.makeBld('power', 1, S[0] + 3 + 9, S[1]); assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).reason, 'Enemies nearby');
  ({ RTS, G } = arena());
  RTS.makeBld('power', 1, S[0] + 3 + 11, S[1]); assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).ok, true);
  // no ground path from the HQ to the dock: a rock ring around the spot
  ({ RTS, G } = arena());
  for (let y = S[1] - 3; y <= S[1] + 5; y++) for (let x = S[0] - 3; x <= S[0] + 5; x++) if (x === S[0] - 3 || x === S[0] + 5 || y === S[1] - 3 || y === S[1] + 5) RTS.terr[y * 80 + x] = 1;
  assert.equal(RTS.placeCheck(0, 'refinery', S[0], S[1], 0).reason, 'No path');
});

test('remote yard §9.1: every accepted remote spot on the built-in map obeys the half / strip / Salvage rules', () => {
  const L = load(); L.seed(3); const RTS = L.RTS; RTS.newGame('normal'); const G = RTS.G, { MW, MH } = RTS; RTS.expl.fill(1);
  const seen = {}; let remote = 0;
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    const pc = RTS.placeCheck(0, 'refinery', tx, ty, 0); if (!pc.ok) { seen[pc.reason] = 1; continue; }
    if (!pc.remote) continue; remote++;
    for (let y = ty; y <= ty + 2; y++) for (let x = tx; x < tx + 3; x++) if (y < ty + 2 || x === tx + 1) assert.equal(G.halfIn[0][y * MW + x], 1, `${tx},${ty}`);
    for (let y = ty - 1; y <= ty + 2; y++) for (let x = tx - 1; x <= tx + 3; x++) if (x >= 0 && y >= 0 && x < MW && y < MH) assert.ok(!(RTS.res[y * MW + x] > 0), `salvage near ${tx},${ty}`);
  }
  assert.ok(remote > 100, `remote spots ${remote}`);
  for (const r of ['Enemy half', 'Too close to the front line', 'Too close to Salvage']) assert.ok(seen[r], r);
});

test('remote yard R1: a remote yard extends the build radius (REMOTE_EXTENDS_RADIUS = true)', () => {
  const { RTS, G } = arena(); assert.equal(RTS.REMOTE.REMOTE_EXTENDS_RADIUS, true);
  G.queues[0].structure.ready = 'refinery'; const b = RTS.placeBld(0, 'refinery', S[0], S[1]); assert.ok(b && b.remote);
  assert.equal(RTS.placeCheck(0, 'power', S[0] + 5, S[1], 0).ok, true);
});

// §9.2: symmetry. Every spot valid for a Survivor remote yard has its partner valid for a Horde one (no units, all explored)
function symmetry(name, partner) {
  const L = load(); L.seed(1); const RTS = L.RTS; RTS.newGame('normal', { map: MAP(name) }); const G = RTS.G, { MW, MH } = RTS;
  RTS.expl.fill(1); G.units.length = 0;
  let n = 0; const bad = [];
  for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    if (!RTS.placeCheck(0, 'refinery', tx, ty, 0).ok) continue;
    const a = RTS.remoteCheck(0, tx, ty); if (!a.ok) continue; n++;
    const [px, py] = partner(MW, MH, tx, ty), b = RTS.remoteCheck(1, px, py), f = RTS.placeCheck(1, 'refinery', px, py, 0);
    if (!b.ok || !f.ok) bad.push({ tx, ty, s: `${tx},${ty} -> ${px},${py} ${b.reason || f.reason}` });
  }
  return { n, bad, G, MW, MH, RTS };
}
test('remote yard §9.2: half grids are symmetric on Crossroads (180 degrees), Ash Ring (X mirror) and Fallen City (180 degrees: its starts are rotated partners)', () => {
  for (const [name, mirror] of [['crossroads', (W, H, x, y) => [W - 1 - x, H - 1 - y]], ['ash-ring', (W, H, x, y) => [W - 1 - x, y]], ['fallen-city', (W, H, x, y) => [W - 1 - x, H - 1 - y]]]) {
    const L = load(); L.seed(1); const RTS = L.RTS; RTS.newGame('normal', { map: MAP(name) }); const G = RTS.G, { MW, MH } = RTS;
    for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
      const [px, py] = mirror(MW, MH, x, y), h = G.half[y * MW + x], hp = G.half[py * MW + px];
      assert.equal(hp, h < 0 ? -1 : 1 - h, `${name} ${x},${y}`);
      for (const s of [0, 1]) assert.equal(G.halfIn[s][y * MW + x], G.halfIn[1 - s][py * MW + px]);
    }
  }
});
test('remote yard §9.2: Ash Ring (X mirror) - every Survivor remote spot has its mirror valid for the Horde', () => {
  const r = symmetry('ash-ring', (W, H, x, y) => [W - x - 3, y]);
  assert.ok(r.n > 50, `spots ${r.n}`); assert.deepEqual(r.bad.map(b => b.s), []);
});
test('remote yard §9.2: Crossroads (180 degrees) - every Survivor remote spot has its rotated partner valid for the Horde', () => {
  // the rotated footprint keeps the dock on the south side, so the partner is the 180-degree footprint with its own dock below
  // The dock can't rotate: a partner's dock is the rotated tile ABOVE the original footprint. Every mismatch must be exactly that
  // (that tile unreachable for the Survivors); all other rules are symmetric. 2026-10-28 at this commit: 50 of 918 spots.
  const r = symmetry('crossroads', (W, H, x, y) => [W - x - 3, H - y - 2]), reach0 = r.RTS.reachOf(0);
  assert.ok(r.n > 50, `spots ${r.n}`);
  assert.deepEqual(r.bad.filter(b => reach0[(b.ty - 1) * r.MW + b.tx + 1] >= 0).map(b => b.s), []);
});

test('remote yard §9.3 / R2: deploys over 10 s from 25% HP; no power, storage or drop-off until online; normal yards are instant', () => {
  const { RTS, G } = arena(); const R = RTS.REMOTE; assert.deepEqual([R.REMOTE_SETUP_S, R.REMOTE_SETUP_HP0], [10, 0.25]);
  const p0 = RTS.powerOf(0).used, s0 = RTS.storageCapOf(0);
  G.queues[0].structure.ready = 'refinery'; const b = RTS.placeBld(0, 'refinery', S[0], S[1]);
  assert.ok(b.remote && b.setup); assert.equal(b.hp, b.maxhp * 0.25);
  assert.equal(RTS.powerOf(0).used, p0); assert.equal(RTS.storageCapOf(0), s0);
  assert.ok(!RTS.dropOffs(0).includes(b));
  // a loaded Truck sent to it waits at the pad until it is online
  const t = RTS.makeUnit('gleaner', 0, (S[0] + 1) * 32 + 16, (S[1] + 4) * 32 + 16); t.load = t.d.cap;
  RTS.SAL.orderPlant(t, b); const c0 = G.credits[0];
  for (let i = 0; i < 9 * 30; i++) RTS.step(1 / 30);
  assert.ok(b.setup); assert.equal(G.credits[0], c0); assert.ok(Math.abs(b.hp / b.maxhp - (0.25 + 0.75 * 0.9)) < 0.01, `hp ${b.hp / b.maxhp}`);
  for (let i = 0; i < 6 * 30; i++) RTS.step(1 / 30);
  assert.ok(!b.setup); assert.equal(b.hp, b.maxhp); assert.ok(RTS.dropOffs(0).includes(b)); assert.ok(RTS.powerOf(0).used > p0);
  assert.ok(G.credits[0] > c0, 'unloaded once online');
  // a normal (near-base) yard is instant
  G.queues[0].structure.ready = 'refinery'; const n = RTS.placeBld(0, 'refinery', 6, 1);
  assert.ok(n && !n.remote && !n.setup); assert.equal(n.hp, n.maxhp);
});

test('remote yard §7: AI spot is a remote field pit far from the Hive; Easy keeps it near the Hive before 10:00; caps', () => {
  for (const diff of ['normal', 'easy']) {
    const L = load(); L.seed(2); const RTS = L.RTS; RTS.newGame(diff); const G = RTS.G;
    const hive = G.blds.find(b => b.side === 1); RTS.makeBld('refinery', 1, hive.tx - 5, hive.ty + 4);
    const sp = RTS.aiFindSpot('refinery'), d = Math.hypot(sp[0] + 1.5 - (hive.tx + 1.5), sp[1] + 1 - (hive.ty + 1.5));
    if (diff === 'normal') { assert.ok(d >= 15, `dist ${d}`); assert.ok(RTS.remoteCheck(1, sp[0], sp[1]).ok); }
    else { assert.ok(d < 15, `easy dist ${d}`); G.time = 600; const s2 = RTS.aiFindSpot('refinery'); assert.ok(Math.hypot(s2[0] - hive.tx, s2[1] - hive.ty) >= 12); }
  }
  const L = load(); L.seed(1); const RTS = L.RTS; assert.deepEqual(RTS.REMOTE.AI_PIT_CAP, { easy: 2, normal: 3, hard: 4 });
});

// Fallen City is a campaign-style asymmetric map (JSON symmetry: 'none'; its terrain matches under no rotation or mirror), so the
// partner test does not apply. Instead: both sides have valid remote spots, each remote spot obeys the half / strip / Salvage rules,
// and each side has a remote spot that can serve a Salvage field (dock within 2 tiles of a field; for the Horde, aiRemoteSpot finds one)
test('remote yard §9.2: Fallen City (asymmetric) - both sides have valid remote spots that obey the rules and can serve a field', () => {
  const m = MAP('fallen-city'); assert.equal(m.symmetry, 'none');
  const L = load(); L.seed(1); const RTS = L.RTS; RTS.newGame('normal', { map: m }); const G = RTS.G, { MW, MH } = RTS;
  RTS.expl.fill(1); G.units.length = 0;
  const BLOCK = [false, true, true, true, false]; let terrDiff = 0;
  for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (BLOCK[RTS.terr[y * MW + x]] !== BLOCK[RTS.terr[(MH - 1 - y) * MW + MW - 1 - x]]) terrDiff++;
  assert.ok(terrDiff > 0, 'Fallen City terrain is not 180-degree symmetric');
  const n = [0, 0], serve = [0, 0];
  const nearField = (tx, ty) => { for (let y = ty + 2 - 2; y <= ty + 2 + 2; y++) for (let x = tx + 1 - 2; x <= tx + 1 + 2; x++) if (x >= 0 && y >= 0 && x < MW && y < MH && RTS.SAL.field[y * MW + x] >= 0) return true; return false; };
  for (const side of [0, 1]) for (let ty = 0; ty < MH; ty++) for (let tx = 0; tx < MW; tx++) {
    if (!RTS.placeCheck(side, 'refinery', tx, ty, 0).ok || !RTS.remoteCheck(side, tx, ty).ok) continue;
    n[side]++; if (nearField(tx, ty)) serve[side]++;
    for (let y = ty; y <= ty + 2; y++) for (let x = tx; x < tx + 3; x++) if (y < ty + 2 || x === tx + 1) assert.equal(G.halfIn[side][y * MW + x], 1, `${side} ${tx},${ty}`);
  }
  assert.ok(n[0] > 100 && n[1] > 100, `remote spots ${n}`);
  assert.ok(serve[0] > 0 && serve[1] > 0, `field-serving spots ${serve}`);
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq'); RTS.makeBld('refinery', 1, hive.tx - 5, hive.ty + 4);
  const sp = RTS.aiRemoteSpot(); assert.ok(sp && RTS.remoteCheck(1, sp[0], sp[1]).ok, 'AI finds a remote Grinder Pit spot');
});
