// Env art pass 1 (rts-loops/art/env/HANDOFF-env.md): blocking props, design-map loading through EnvTerrain.resolveMap(),
// and the review-scene routing check (1-tile gap beside the burning van on road tile (26,13)).
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { load } = require('./harness.js');
const EnvTerrain = require('../env-terrain.js');
const ROOT = path.join(__dirname, '..');
const J = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8'));
const MAPS = ['crossroads', 'fallen-city', 'ash-ring'];
const img = { width: 1, height: 1 };
const fakeCanvas = () => { const c = { width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => t[k] !== undefined ? t[k] : () => {}, set: (t, k, v) => { t[k] = v; return true; } }) }; return c; };
const ENV = EnvTerrain.create({ tiles: [J('assets/env/env-tiles-atlas.json'), img], props: [J('assets/env/env-props-atlas.json'), img], fx: [J('assets/env/env-fx-atlas.json'), img], makeCanvas: fakeCanvas });
const PF = ENV.frames.props;

function game(seed, withEnv) {
  const L = load(); L.seed(seed);
  if (withEnv) L.ctx.EnvArt = { env: ENV, state: { mode: 'ready', loadMs: 0 }, onReady() {} };
  return L;
}
// 4-way ground reach over terrain only (like game.js reach())
function reachFrom(R, x0, y0) {
  const { MW, MH } = R, BLOCK = [false, true, true, true, false], seen = new Uint8Array(MW * MH), q = [y0 * MW + x0]; seen[q[0]] = 1;
  while (q.length) { const c = q.pop(), x = c % MW, y = (c / MW) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= MW || Y >= MH) continue; const j = Y * MW + X; if (!seen[j] && !BLOCK[R.terr[j]]) { seen[j] = 1; q.push(j); } } }
  return seen;
}
const footprintTiles = p => { const f = PF[p.name], out = []; if (!f || !f.footprint) return out; for (let y = Math.round(p.ty); y < Math.round(p.ty) + f.footprint[1]; y++) for (let x = Math.round(p.tx); x < Math.round(p.tx) + f.footprint[0]; x++) out.push([x, y]); return out; };

test('procedural map: trees and cars block movement, never on or next to a Scrap Pile, never cut off reachable ground', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const { RTS } = game(seed); RTS.newGame('normal'); const G = RTS.G, MW = RTS.MW;
    const blk = RTS.decos.filter(d => d.block);
    assert.ok(blk.length >= 20, `seed ${seed}: ${blk.length} tree/car blockers`);
    for (const d of blk) {
      const i = d.ty * MW + d.tx;
      assert.strictEqual(RTS.terr[i], RTS.T.RUBBLE, `seed ${seed}: blocker ${d.t} at ${d.tx},${d.ty} is impassable`);
      assert.ok(!RTS.walk(d.tx, d.ty));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) assert.ok(!RTS.res[(d.ty + dy) * MW + d.tx + dx], `seed ${seed}: no Scrap Pile under or beside ${d.tx},${d.ty}`);
    }
    const s = reachFrom(RTS, G.baseP.x, G.baseP.y);
    assert.ok(s[G.baseE.y * MW + G.baseE.x], `seed ${seed}: bases connect`);
    for (let i = 0; i < MW * RTS.MH; i++) if (RTS.res[i]) assert.ok(s[i], `seed ${seed}: pile ${i % MW},${(i / MW) | 0} reachable`);
    for (const b of G.blds) assert.ok(s[b.pad], `seed ${seed}: ${b.type} dock pad reachable`);
  }
});

test('blockers: buildings cannot be placed on them, paths and units never enter them', () => {
  const { RTS } = game(3); RTS.newGame('normal'); const G = RTS.G, MW = RTS.MW;
  let checked = 0;
  for (const d of RTS.decos.filter(d => d.block)) {
    // a 2x2 Power Plant whose top-left is the blocker; an own Depot nearby satisfies the build-radius rule
    const area = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const i = y * MW + x; if (x < 0 || y < 0 || x >= MW || y >= RTS.MH || RTS.terr[i] !== RTS.T.GROUND || RTS.res[i] || RTS.bgrid[i] || (RTS.SAL.field[i] >= 0)) return false; } return true; };
    if (!area(d.tx + 1, d.ty, 1, 2) || !area(d.tx, d.ty + 1, 1, 1) || !area(d.tx + 3, d.ty - 1, 2, 2)) continue;
    const helper = RTS.makeBld('depot', 0, d.tx + 3, d.ty - 1);
    assert.strictEqual(RTS.canPlace(0, 'power', d.tx, d.ty, 0), false, `power over the ${d.t} at ${d.tx},${d.ty} is refused`);
    RTS.terr[d.ty * MW + d.tx] = RTS.T.GROUND;
    assert.strictEqual(RTS.canPlace(0, 'power', d.tx, d.ty, 0), true, 'same spot is fine without the blocker (control)');
    RTS.terr[d.ty * MW + d.tx] = RTS.T.RUBBLE;
    helper.dead = true; for (let y = helper.ty; y < helper.ty + helper.h; y++) for (let x = helper.tx; x < helper.tx + helper.w; x++) RTS.bgrid[y * MW + x] = 0; G.blds = G.blds.filter(b => b !== helper);
    // path from 3 tiles west to 3 tiles east never steps on the blocker
    const p = RTS.findPath(d.tx - 2, d.ty, d.tx + 2, d.ty);
    if (p) for (const [x, y] of p) assert.ok(RTS.walk(x, y), `path tile ${x},${y} walkable`);
    if (++checked >= 6) break;
  }
  assert.ok(checked >= 2, `checked ${checked} blockers`);
  // units ordered onto a blocker stop next to it and never stand on an impassable tile
  const d = RTS.decos.filter(d => d.block)[0];
  const us = []; for (let k = 0; k < 6; k++) us.push(RTS.makeUnit(k % 2 ? 'survivor' : 'ark', 0, (d.tx - 4) * 32 + 16, (d.ty + (k % 3) - 1) * 32 + 16));
  for (const u of us) if (!RTS.walk(Math.floor(u.x / 32), Math.floor(u.y / 32))) { u.x -= 64; }
  RTS.issueMove(us, d.tx * 32 + 16, d.ty * 32 + 16, false);
  let bad = 0; for (let i = 0; i < 30 * 20; i++) { RTS.step(1 / 30); for (const u of us) if (!u.dead && RTS.terr[Math.floor(u.y / 32) * MW + Math.floor(u.x / 32)] !== RTS.T.GROUND && RTS.terr[Math.floor(u.y / 32) * MW + Math.floor(u.x / 32)] !== RTS.T.ROAD) bad++; }
  assert.strictEqual(bad, 0, 'no unit frame inside a blocked tile');
});

test('procedural map resolves through EnvTerrain.resolveMap: every prop footprint on an impassable tile, aliases complete', () => {
  for (let seed = 1; seed <= 5; seed++) {
    const { RTS } = game(seed, true); RTS.newGame('normal');
    const st = RTS.envStats; assert.ok(st, 'env prepared');
    assert.strictEqual(st.offGrid, 0, `seed ${seed}: blockers off the gameplay grid`);
    assert.deepStrictEqual(st.missing, {});
    assert.ok(st.resolved.ruins > 0 && st.resolved.trees > 0 && st.resolved.cars > 0, JSON.stringify(st.resolved));
    assert.strictEqual(st.resolved.trees + st.resolved.cars, RTS.decos.filter(d => d.block).length, 'one prop per tree/car blocker');
    for (const g of RTS.G.env.R.groundProps) assert.notStrictEqual(g.name, 'crater_small', 'impassable craters are never the walkable crater_small');
  }
});

for (const name of MAPS) test(`design map ${name}: loads (rows/legend for gameplay, resolveMap for art) with a valid start/HQ/field layout`, () => {
  const m = J(`assets/maps/${name}.json`);
  const { RTS } = game(1, true); RTS.newGame('normal', { map: m }); const G = RTS.G;
  assert.strictEqual(RTS.MW, m.w); assert.strictEqual(RTS.MH, m.h);
  const s1 = m.starts.find(s => s.id === 1), s2 = m.starts.find(s => s.id === 2);
  const hq = G.blds.find(b => b.side === 0 && b.type === 'hq'), hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  assert.deepStrictEqual([hq.tx, hq.ty], [s1.x, s1.y]); assert.deepStrictEqual([hive.tx, hive.ty], [s2.x, s2.y]);
  let piles = 0; for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) { const c = m.rows[y][x], i = y * m.w + x;
    assert.strictEqual(RTS.walk(x, y) || !!RTS.bgrid[i], !'~#rcto'.includes(c), `walkability of '${c}' at ${x},${y}`);
    if ('SA'.includes(c)) { piles++; assert.ok(RTS.res[i] > 0); } }
  assert.strictEqual(G.env.stats.offGrid, 0); assert.deepStrictEqual(G.env.stats.missing, {});
  const sP = reachFrom(RTS, hq.tx + 1, hq.ty + 3), sE = reachFrom(RTS, hive.tx + 1, hive.ty + 3);
  for (let i = 0; i < m.w * m.h; i++) if (RTS.res[i]) { assert.ok(sP[i] && sE[i], `pile ${i % m.w},${(i / m.w) | 0} reachable from both starts`); }
  assert.ok(sP[hq.pad] && sE[hive.pad], 'dock pads reachable');
  assert.ok(RTS.SAL.fields.length >= m.fields.length - 1, `${RTS.SAL.fields.length} salvage fields for ${m.fields.length} listed`);
  assert.ok(piles > 0 && G.env.props.length > 0);
});

// review scene from rts-loops/art/render-env.js (44x26 inside a flat arena): E-W road rows 12-13, N-S road cols 21-22;
// burning van (car_van_ew) on (26,13) leaves a 1-tile gap at (26,12), sedan at (16,12) leaves (16,13), hatch at (7,13) leaves (7,12)
function reviewScene(RTS) {
  RTS.newArena(1); const MW = RTS.MW, T = RTS.T, set = (x, y, t) => { RTS.terr[y * MW + x] = t; };
  for (let x = 0; x < 44; x++) { set(x, 12, T.ROAD); set(x, 13, T.ROAD); }
  for (let y = 0; y < 26; y++) { set(21, y, T.ROAD); set(22, y, T.ROAD); }
  // close the scene: everything outside rows 12-13 within x 0..43 blocked except the N-S road, so the road is the only corridor
  for (let y = 0; y < 26; y++) for (let x = 0; x < 44; x++) if (y !== 12 && y !== 13 && x !== 21 && x !== 22) set(x, y, T.RUBBLE);
  for (let x = 44; x < 80; x++) for (let y = 0; y < 80; y++) set(x, y, T.RUBBLE);
  for (let y = 26; y < 80; y++) for (let x = 0; x < 44; x++) set(x, y, T.RUBBLE);
  const props = [{ name: 'car_sedan_ew', tx: 16, ty: 12 }, { name: 'car_van_ew', tx: 26, ty: 13 }, { name: 'car_hatch', tx: 21, ty: 3 }, { name: 'car_pickup', tx: 22, ty: 20 }, { name: 'car_hatch_ew', tx: 7, ty: 13 }];
  for (const p of props) for (const [x, y] of footprintTiles(p)) set(x, y, T.RUBBLE);
  return props;
}
test('review scene: units route through the 1-tile gap beside the burning van at (26,13)', () => {
  const { RTS } = game(1); reviewScene(RTS);
  assert.ok(!RTS.walk(26, 13) && RTS.walk(26, 12), 'van tile blocked, gap open');
  const p = RTS.findPath(2, 13, 40, 13);
  assert.ok(p, 'a path exists along the road');
  // findPath returns smoothed waypoints (tile centres); walk the segments at 1/20 tile and collect every tile crossed
  const crossed = new Set(); let prev = [2, 13];
  for (const w of p) { for (let k = 0; k <= 20 * 60; k++) { const f = k / 1200, x = prev[0] + 0.5 + (w[0] - prev[0]) * f, y = prev[1] + 0.5 + (w[1] - prev[1]) * f; crossed.add(Math.floor(x) + ',' + Math.floor(y)); } prev = w; }
  const route = p.map(t => t.join(',')).join(' ');
  for (const k of crossed) { const [x, y] = k.split(',').map(Number); assert.ok(RTS.walk(x, y), `route ${route} crosses blocked tile ${k}`); }
  assert.ok(crossed.has('26,12') && !crossed.has('26,13'), 'route goes through the gap (26,12): ' + route);
  assert.ok(crossed.has('16,13') && crossed.has('7,12'), 'and the gaps beside the sedan (16,13) and hatchback (7,12)');
  // live units: a rifle squad, a Tank and a Scrap Truck drive the road west -> east and all arrive (no stall at the van)
  const us = [];
  for (let k = 0; k < 5; k++) us.push(RTS.makeUnit('survivor', 0, (2 + k * 0.6) * 32, 12.5 * 32 + (k % 2) * 20));
  us.push(RTS.makeUnit('ark', 0, 4.5 * 32, 13.5 * 32)); us.push(RTS.makeUnit('gleaner', 0, 1.5 * 32, 12.5 * 32));
  RTS.issueMove(us, 40 * 32 + 16, 12 * 32 + 32, false);
  let t = 0, gap = new Set(), bad = 0;
  for (; t < 90; t += 1 / 30) { RTS.step(1 / 30);
    for (const u of us) { const tx = Math.floor(u.x / 32), ty = Math.floor(u.y / 32); if (tx === 26 && ty === 12) gap.add(u.id); if (!RTS.walk(tx, ty)) bad++; }
    if (us.every(u => u.x > 37 * 32)) break; }
  assert.ok(us.every(u => u.x > 37 * 32), 'all 7 units got past the van: ' + us.map(u => u.type + '@' + (u.x / 32).toFixed(1) + ',' + (u.y / 32).toFixed(1)).join(' '));
  assert.strictEqual(gap.size, us.length, 'every unit went through (26,12)');
  assert.strictEqual(bad, 0, 'no unit frame inside a blocked tile');
  console.log(`# review-scene: 7 units through the van gap in ${t.toFixed(1)} s`);
});
