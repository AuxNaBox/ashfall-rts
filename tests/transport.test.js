// Loaded troop carriers must not be shoved by their own passengers (separate()
// used to treat cargo stacked on the hull as overlapping bodies).
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { load } = require('./harness.js');

const TILE = 32;
const DT = 1 / 30;
const at = (tx, ty) => ({ x: tx * TILE + 16, y: ty * TILE + 16 });

function boot(seed) {
  const H = load(); H.seed(seed);
  const RTS = H.RTS;
  RTS.newArena(seed);
  return { RTS, G: RTS.G };
}

function loadCarrier(RTS, kind, n, tx, ty) {
  const side = kind === 'apc' ? 0 : 1;
  const inf = kind === 'apc' ? 'survivor' : 'zombie';
  const p0 = at(tx, ty);
  const tr = RTS.makeUnit(kind, side, p0.x, p0.y);
  tr.order = 'idle'; tr.path = null; tr.target = null;
  const men = [];
  for (let i = 0; i < n; i++) {
    const u = RTS.makeUnit(inf, side, p0.x + 40, p0.y + (i - 2) * 12);
    assert.equal(RTS.loadUnit(tr, u), true, 'loads ' + u.type);
    men.push(u);
  }
  assert.equal((tr.cargo || []).length, n);
  return { tr, men, p0 };
}

function stepTrace(RTS, tr, men, ticks) {
  const out = [];
  let lx = tr.x, ly = tr.y, la = tr.ang || 0;
  for (let i = 0; i < ticks; i++) {
    RTS.step(DT);
    const dx = Math.hypot(tr.x - lx, tr.y - ly);
    let dAng = (tr.ang || 0) - la;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    const paxOff = men.map(u => Math.hypot(u.x - tr.x, u.y - tr.y));
    out.push({
      dx, dAng, x: tr.x, y: tr.y, ang: tr.ang || 0, order: tr.order,
      paxOff, paxPath: men.some(u => u.path && u.path.length),
      paxMoving: men.some(u => u.moving),
      paxCarried: men.every(u => u.carried === tr),
    });
    lx = tr.x; ly = tr.y; la = tr.ang || 0;
  }
  return out;
}

for (const kind of ['apc', 'crawler']) {
  test(kind + ': after loading, the carrier stays still and passengers do not move or collide inside', () => {
    const { RTS } = boot(1);
    const { tr, men, p0 } = loadCarrier(RTS, kind, 5, 20, 20);
    const samples = stepTrace(RTS, tr, men, 60); // 2 s idle
    const meanDx = samples.reduce((s, r) => s + r.dx, 0) / samples.length;
    const maxDx = Math.max(...samples.map(r => r.dx));
    const drift = Math.hypot(tr.x - p0.x, tr.y - p0.y);
    assert.ok(meanDx < 0.05, kind + ' mean per-tick move ' + meanDx.toFixed(3) + ' px (need < 0.05)');
    assert.ok(maxDx < 0.5, kind + ' max per-tick move ' + maxDx.toFixed(3) + ' px (need < 0.5)');
    assert.ok(drift < 1, kind + ' drifted ' + drift.toFixed(2) + ' px in 2 s (need < 1)');
    assert.ok(samples.every(r => r.paxCarried), kind + ' passengers stay carried');
    assert.ok(samples.every(r => r.paxOff.every(d => d < 0.5)), kind + ' passengers stay on the hull, not shoved out');
    assert.ok(samples.every(r => !r.paxPath && !r.paxMoving), kind + ' passengers have no path and are not moving');
    assert.equal(tr.order, 'idle', kind + ' load does not reset the carrier onto a move order');
  });

  test(kind + ': a loaded carrier ordered to a point arrives without jitter or heading oscillation', () => {
    const { RTS } = boot(2);
    const { tr, men } = loadCarrier(RTS, kind, 5, 16, 20);
    const dest = at(26, 20); // 10 tiles east, empty arena
    const dist0 = Math.hypot(dest.x - tr.x, dest.y - tr.y);
    RTS.issueMove([tr], dest.x, dest.y, false);
    const samples = stepTrace(RTS, tr, men, 30 * 10); // 10 s
    let arrivedAt = null;
    for (let i = 0; i < samples.length; i++) {
      if (Math.hypot(samples[i].x - dest.x, samples[i].y - dest.y) <= 16) { arrivedAt = (i + 1) / 30; break; }
    }
    const finalDist = Math.hypot(tr.x - dest.x, tr.y - dest.y);
    assert.ok(arrivedAt != null && arrivedAt <= 8, kind + ' arrived in ' + arrivedAt + 's (need <= 8s); final ' + finalDist.toFixed(1) + ' px from a ' + dist0.toFixed(0) + ' px trip');
    assert.ok(finalDist <= 16, kind + ' still at the destination (' + finalDist.toFixed(1) + ' px), not shoved off after arriving');
    // After the first 0.2 s (initial turn onto the path), heading should stay stable
    // and no tick should jump farther than normal travel (the bug kicked 13–18 px).
    const later = samples.slice(6);
    const maxTurn = Math.max(...later.map(r => Math.abs(r.dAng)));
    assert.ok(maxTurn < 25 * Math.PI / 180, kind + ' max heading step after 0.2s is ' + (maxTurn * 180 / Math.PI).toFixed(1) + ' deg (need < 25)');
    const moving = later.filter(r => r.dx > 0.2 && r.order !== 'idle');
    if (moving.length) {
      const meanDx = moving.reduce((s, r) => s + r.dx, 0) / moving.length;
      const maxDx = Math.max(...moving.map(r => r.dx));
      assert.ok(meanDx < 4, kind + ' mean step while moving is ' + meanDx.toFixed(2) + ' px (need < 4; collision kicks were ~15)');
      assert.ok(maxDx < 8, kind + ' max per-tick jump while moving is ' + maxDx.toFixed(2) + ' px (need < 8; sporadic kicks were 13–18)');
    }
    // Cross-track drift off the start→goal line: the bug wandered randomly, not along the path.
    const x0 = samples[0].x, y0 = samples[0].y;
    const lx = dest.x - x0, ly = dest.y - y0, llen = Math.hypot(lx, ly) || 1;
    let maxCross = 0;
    for (const r of samples) {
      const cross = Math.abs((r.x - x0) * ly - (r.y - y0) * lx) / llen;
      if (cross > maxCross) maxCross = cross;
    }
    assert.ok(maxCross < 16, kind + ' wandered ' + maxCross.toFixed(1) + ' px off the path (need < 16; the bug drifted hundreds)');
    // After the carrier settles at the goal, it must stay put — no more unordered jumps.
    // "Arrived" is the first tick inside 16 px, so skip the remaining approach ticks.
    if (arrivedAt != null) {
      const first = Math.round(arrivedAt * 30);
      let settle = samples.findIndex((r, i) => i >= first && (r.order === 'idle' || r.dx < 0.5));
      if (settle < 0) settle = samples.length - 30;
      const after = samples.slice(Math.max(settle, first) + 1);
      if (after.length) {
        const maxAfter = Math.max(...after.map(r => r.dx));
        const endDrift = Math.hypot(tr.x - dest.x, tr.y - dest.y);
        assert.ok(maxAfter < 0.5, kind + ' jumped ' + maxAfter.toFixed(2) + ' px/tick after settling (need < 0.5; bug was 13–18)');
        assert.ok(endDrift <= 16, kind + ' drifted to ' + endDrift.toFixed(1) + ' px from the goal after settling');
      }
    }
    assert.ok(samples.every(r => r.paxCarried), kind + ' passengers stay inside for the trip');
    assert.ok(samples.every(r => r.paxOff.every(d => d < 0.5)), kind + ' passengers are not separated off the hull');
    assert.ok(samples.every(r => !r.paxPath && !r.paxMoving), kind + ' passengers do not path or collide-walk inside');
  });
}

test('player orders: infantry walk into an APC, then the APC can be sent to a point', () => {
  const { RTS } = boot(3);
  const p0 = at(18, 22), dest = at(28, 22);
  const apc = RTS.makeUnit('apc', 0, p0.x, p0.y);
  const men = [];
  for (let i = 0; i < 5; i++) men.push(RTS.makeUnit('survivor', 0, p0.x - 48, p0.y + (i - 2) * 14));
  RTS.orderLoad(men, apc);
  let loadedAt = null;
  for (let i = 0; i < 30 * 6; i++) {
    RTS.step(DT);
    if ((apc.cargo || []).length === 5) { loadedAt = (i + 1) / 30; break; }
  }
  assert.ok(loadedAt != null, 'all 5 board');
  const xBoard = apc.x, yBoard = apc.y;
  let maxIdle = 0, lx = apc.x, ly = apc.y;
  for (let i = 0; i < 30; i++) {
    RTS.step(DT);
    const step = Math.hypot(apc.x - lx, apc.y - ly);
    if (step > maxIdle) maxIdle = step;
    lx = apc.x; ly = apc.y;
  }
  const idleDrift = Math.hypot(apc.x - xBoard, apc.y - yBoard);
  assert.ok(maxIdle < 0.5, 'APC per-tick jump after boarding is ' + maxIdle.toFixed(2) + ' px (need < 0.5; bug was 13.6)');
  assert.ok(idleDrift < 1, 'APC does not drift after the last man boards, drift ' + idleDrift.toFixed(2));
  RTS.issueMove([apc], dest.x, dest.y, false);
  let arrivedAt = null;
  for (let i = 0; i < 30 * 10; i++) {
    RTS.step(DT);
    if (Math.hypot(apc.x - dest.x, apc.y - dest.y) <= 16) { arrivedAt = (i + 1) / 30; break; }
  }
  assert.ok(arrivedAt != null && arrivedAt <= 8, 'loaded APC arrives in ' + arrivedAt + 's');
  assert.equal((apc.cargo || []).length, 5);
  assert.ok(men.every(u => u.carried === apc && Math.hypot(u.x - apc.x, u.y - apc.y) < 0.5));
});
