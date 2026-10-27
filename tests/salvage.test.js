// node --test tests/  (salvage.js: Loop 2 smallest playable loop)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Salvage = require('../salvage.js');
const D = Salvage.D;

// Minimal host: open 20x20 grid, straight-line movement, credits per side.
function world({ credits = [0, 0], cap = [100000, 100000], fieldTiles = [[5, 5], [6, 5], [5, 6], [6, 6]], amount = D.tileMax, plants = [{ tx: 10, ty: 10 }], mult = [1, 1] } = {}) {
  const MW = 20, MH = 20, TILE = 32, res = new Uint16Array(MW * MH);
  for (const [x, y] of fieldTiles) res[y * MW + x] = amount;
  const units = [], events = [];
  const blds = plants.map((p, k) => ({ id: k + 1, side: p.side || 0, type: 'refinery', tx: p.tx, ty: p.ty, dead: false, dockQ: [] }));
  const host = {
    MW, MH, TILE, res,
    units: () => units,
    plants: side => blds.filter(b => b.side === side && !b.dead),
    dockPoint: b => ({ x: (b.tx + 1) * TILE + 16, y: (b.ty + 2) * TILE + 16 }),
    moveTo: (u, x, y) => { u.path = [{ x, y }]; },
    followPath: (u, dt) => {
      if (!u.path) return true; const w = u.path[0], dx = w.x - u.x, dy = w.y - u.y, d = Math.hypot(dx, dy), st = u.d.speed * dt;
      if (d <= st) { u.x = w.x; u.y = w.y; u.path = null; return true; } u.x += dx / d * st; u.y += dy / d * st; return false;
    },
    getCredits: s => credits[s], addCredits: (s, n) => { credits[s] += n; }, storageCap: s => cap[s], incomeMult: s => mult[s],
    emit: (ev, data) => events.push({ ev, data }),
  };
  const S = Salvage.create(host); S.initFields();
  const addTruck = (x, y, side = 0) => { const u = { side, x, y, d: { harv: true, cap: D.haulerCapacity, speed: D.haulerSpeedTiles * TILE }, load: 0, hs: 'seek', dead: false, path: null }; units.push(u); return u; };
  const run = (sec, dt = 1 / 60) => { for (let t = 0; t < sec; t += dt) S.update(dt); };
  return { S, host, res, units, events, blds, credits, cap, addTruck, run, MW };
}
const count = (ev, w) => w.events.filter(e => e.ev === ev).length;

test('balance table: Loop 1 spec + Director ruling 1 + addendum values', () => {
  assert.equal(D.haulerCapacity, 500); assert.equal(D.haulerCost, 1200); assert.equal(D.gatherPerSec, 25); assert.equal(D.unloadPerSec, 100);
  assert.equal(D.plantCost, 2000); assert.equal(D.powerPlantPower, 100); assert.equal(D.plantPower, -30); assert.equal(D.factoryPower, -40);
  assert.equal(D.startScripAI, 3000); assert.equal(D.aiGorgerReserve, 1200);
  for (const k in Salvage.TABLE) assert.ok(Salvage.TABLE[k].src, k + ' has a source');
  const ph = Object.keys(Salvage.TABLE).filter(k => /PLACEHOLDER/.test(Salvage.TABLE[k].src));
  assert.ok(ph.includes('tickRate') && ph.includes('siloPower'), 'placeholders are marked');
});

test('stages: ceil(amount/125), 4 stages; pips: 5', () => {
  assert.deepEqual([0, 1, 125, 126, 250, 375, 376, 500].map(Salvage.stageOf), [0, 1, 1, 2, 2, 3, 4, 4]);
  assert.deepEqual([0, 1, 100, 101, 499, 500].map(l => Salvage.pipsOf(l, 500)), [0, 1, 1, 2, 5, 5]);
});

test('storage cap and power balance (addendum §1, §3)', () => {
  assert.equal(Salvage.storageCap({ hq: 1 }), 2000, 'HQ 2,000 (Director ruling)');
  assert.equal(Salvage.storageCap({ hq: 1, refinery: 1 }), 4000, 'starting cap 4,000');
  assert.equal(Salvage.storageCap({ hq: 1, refinery: 1, depot: 2 }), 7000);
  assert.deepEqual(Salvage.powerBalance(['hq', 'power', 'refinery']), { made: 100, used: 30, net: 70 }, 'player start runs at full speed');
  assert.deepEqual(Salvage.powerBalance(['hq', 'power', 'refinery', 'factory']), { made: 100, used: 70, net: 30 });
  assert.deepEqual(['hq', 'turret', 'depot', 'barracks', 'silo'].map(Salvage.powerOfType), [0, -20, -10, -20, -50]);
  for (const k of ['hqPower', 'turretPower', 'depotPower', 'barracksPower', 'siloPower']) assert.match(Salvage.TABLE[k].src, /PLACEHOLDER/);
  assert.equal(Salvage.powerBalance(['refinery']).net, -30);
});

test('fields: 8-connected flood fill groups tiles', () => {
  const w = world({ fieldTiles: [[1, 1], [2, 2], [3, 3], [10, 1], [11, 1]] });
  assert.deepEqual(w.S.fields.map(f => f.tiles.length).sort(), [2, 3]);
});

test('fixed step: update() runs whole steps from variable dt and keeps the remainder', () => {
  const w = world();
  assert.equal(w.S.update(0.05), 0 + Math.floor(0.05 * D.tickRate + 1e-9));
  w.S.update(0.5); w.S.update(0.45);
  assert.equal(w.S.steps, Math.floor(1.0 * D.tickRate + 1e-6));
  assert.equal(w.S.update(10), D.maxStepsPerFrame, 'spiral-of-death guard');
});

test('full loop: gather 500 in ~20 s, return, unload 100/s, Credits +500, events fire', () => {
  const w = world();
  const u = w.addTruck(5 * 32 + 16, 7 * 32 + 16);
  w.run(10); assert.equal(u.hs, 'gather'); assert.ok(u.load > 0 && u.load < 500);
  w.run(25); assert.ok(['toPlant', 'queue', 'unload'].includes(u.hs) || w.credits[0] > 0);
  w.run(25);
  assert.equal(w.credits[0], 500);
  assert.equal(count('unload', w), 1);
  assert.equal(w.events.find(e => e.ev === 'unload').data.amount, 500);
  assert.ok(count('harvestStart', w) >= 1 && count('loadChanged', w) >= 10 && count('tileStageChanged', w) >= 1);
  const left = [...w.res].reduce((a, b) => a + b, 0), mined = 4 * 500 - left;
  assert.ok(mined <= 500 + u.load && mined >= 500 + u.load - 25 * 4 * 4, `mined ${mined}: unloaded + carried, minus in-place regrowth`);
});

test('gather/unload timing matches the spec (20 s fill, 5 s unload)', () => {
  const w = world();
  const u = w.addTruck(5 * 32 + 16, 5 * 32 + 16);
  let tGather = null, tFull = null, tUnload = null, tDone = null, t = 0; const dt = 1 / 60;
  while (t < 60 && tDone === null) {
    w.S.update(dt); t += dt;
    if (tGather === null && u.hs === 'gather') tGather = t;
    if (tFull === null && u.load >= 500) tFull = t;
    if (tUnload === null && u.hs === 'unload') tUnload = t;
    if (tUnload !== null && tDone === null && u.hs !== 'unload') tDone = t;
  }
  assert.ok(Math.abs(tFull - tGather - 20) < 0.3, `fill took ${tFull - tGather}`);
  assert.ok(Math.abs(tDone - tUnload - 5) < 0.3, `unload took ${tDone - tUnload}`);
});

test('nearest pile: stays in the same field and moves to the nearest non-empty tile', () => {
  const w = world({ fieldTiles: [[5, 5], [6, 5], [7, 5], [15, 15]] });
  const u = w.addTruck(5 * 32 + 16, 5 * 32 + 16);
  w.res[5 * 20 + 5] = 0;
  assert.equal(w.S.nearestPile(u, 5 * 20 + 5), 5 * 20 + 6);
  w.res[5 * 20 + 6] = 0; w.res[5 * 20 + 7] = 0;
  assert.equal(w.S.nearestPile(u, 5 * 20 + 5), 15 * 20 + 15, 'falls back to another field when its own is empty');
});

test('nearest pile: avoids a pile another truck already targets (soft reservation)', () => {
  const w = world({ fieldTiles: [[5, 5], [6, 5]] });
  const a = w.addTruck(5 * 32 + 16, 5 * 32 + 16), b = w.addTruck(5 * 32 + 16, 5 * 32 + 16);
  w.S.orderPile(a, 5 * 20 + 5);
  assert.equal(w.S.nearestPile(b, 5 * 20 + 5), 5 * 20 + 6);
});

test('dock queue: FIFO, one truck unloads at a time', () => {
  const w = world({ fieldTiles: [] });
  const p = w.blds[0], dp = w.host.dockPoint(p);
  const a = w.addTruck(dp.x + 40, dp.y), b = w.addTruck(dp.x + 50, dp.y), c = w.addTruck(dp.x + 60, dp.y);
  for (const u of [a, b, c]) { u.load = 500; w.S.orderPlant(u, p); }
  let maxUnloading = 0, order = [];
  for (let t = 0; t < 30; t += 1 / 60) {
    w.S.update(1 / 60);
    const un = [a, b, c].filter(u => u.hs === 'unload'); maxUnloading = Math.max(maxUnloading, un.length);
    for (const u of un) if (!order.includes(u)) order.push(u);
  }
  assert.equal(maxUnloading, 1);
  assert.deepEqual(order, [a, b, c]);
  assert.equal(w.credits[0], 1500);
});

test('storage full (USER D1): truck holds its load on the pad, resumes when space frees', () => {
  const w = world({ credits: [3900, 0], cap: [4000, 4000], fieldTiles: [] });
  const p = w.blds[0], dp = w.host.dockPoint(p), u = w.addTruck(dp.x, dp.y + 40), v = w.addTruck(dp.x, dp.y + 60);
  u.load = 500; v.load = 500; w.S.orderPlant(u, p); w.S.orderPlant(v, p);
  w.run(15);
  assert.equal(w.credits[0], 4000); assert.equal(u.hs, 'unload'); assert.equal(u.blocked, true); assert.equal(u.load, 400);
  assert.equal(v.hs, 'queue', 'the next truck waits behind the blocked one');
  assert.equal(count('storageBlocked', w), 1);
  w.credits[0] = 0; w.run(10);
  assert.equal(u.load, 0); assert.ok(w.credits[0] >= 400);
});

test('income multiplier (AI difficulty) applies on deposit', () => {
  const w = world({ fieldTiles: [], mult: [1, 1.35], plants: [{ tx: 10, ty: 10, side: 1 }] });
  const p = w.blds[0], dp = w.host.dockPoint(p), u = w.addTruck(dp.x, dp.y + 30, 1);
  u.load = 100; w.S.orderPlant(u, p); w.run(5);
  assert.ok(Math.abs(w.credits[1] - 135) < 1e-9);
});

test('regrowth in place: partly mined +25 per 15 s up to original', () => {
  const w = world({ fieldTiles: [[5, 5]] });
  const i = 5 * 20 + 5; w.res[i] = 450;
  w.run(15.05); assert.equal(w.res[i], 475);
  w.run(15); assert.equal(w.res[i], 500);
  w.run(30); assert.equal(w.res[i], 500, 'never above original');
});

test('regrowth: cleared tile waits 120 s, then +25 per 180 s, cap 100 (addendum §4)', () => {
  const w = world({ fieldTiles: [[5, 5]], amount: 25 });
  const u = w.addTruck(5 * 32 + 16, 5 * 32 + 16), i = 5 * 20 + 5;
  w.run(3); assert.equal(w.res[i], 0); assert.equal(count('fieldDepleted', w), 1);
  u.dead = true;
  w.run(110); assert.equal(w.res[i], 0);
  w.run(15); assert.equal(w.res[i], 25);
  w.run(170); assert.equal(w.res[i], 25, 'slow track ignores the 15 s rule');
  w.run(15); assert.equal(w.res[i], 50);
  w.run(180 * 4); assert.equal(w.res[i], 100, 'capped at 100');
});

test('parked truck ignores the economy until ordered; right-click pile resumes', () => {
  const w = world();
  const u = w.addTruck(2 * 32, 2 * 32); w.S.park(u); w.run(5);
  assert.equal(u.hs, 'parked'); assert.equal(u.load, 0);
  w.S.orderPile(u, 5 * 20 + 6); w.run(10);
  assert.equal(u.hs, 'gather'); assert.equal(u.htile, 5 * 20 + 6);
});

test('no Scrap Yard: truck waits (noPlant) and goes once one exists', () => {
  const w = world({ fieldTiles: [], plants: [] });
  const u = w.addTruck(100, 100); u.load = 300; w.run(3);
  assert.equal(u.hs, 'noPlant');
  w.blds.push({ id: 9, side: 0, type: 'refinery', tx: 3, ty: 3, dead: false, dockQ: [] });
  w.run(20); assert.equal(w.credits[0], 300);
});
