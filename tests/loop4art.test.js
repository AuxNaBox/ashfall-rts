// node --test tests/  (loop 4 art integration: art/buildings/HANDOFF-buildings.md §10.1 + art/units/HANDOFF.md §9.1)
// tech-building overlay rule (Dezi, replaces the research-only rule): plays while the building's own queue is busy (research or training)
// and it is powered; off when idle or unpowered. 9 cases = busy / idle / unpowered x Armory / Church / Dark Altar, plus the other hooks.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UA = require('../unitart.js');
const { load } = require('./harness.js');
const A = path.join(__dirname, '..', 'assets');
const J = f => JSON.parse(fs.readFileSync(path.join(A, f), 'utf8'));
const MAN = { survivors: UA.parseBuildingManifest(J('buildings/survivors-buildings-atlas.json')), horde: UA.parseBuildingManifest(J('buildings/horde-buildings-atlas.json')) };
const { RTS } = load();
const ID = { armory: 'armory', church: 'church', altar: 'dark_altar' }, SIDE = { armory: 0, church: 0, altar: 1 };
const RES = at => Object.keys(RTS.Combat.RESEARCH).find(id => RTS.Combat.RESEARCH[id].at === at);

// a base with the tech building; powered = enough Power Plants, unpowered = consumers beyond supply (net < 0)
function base(type, powered) {
  RTS.newArena(7); const G = RTS.G, s = SIDE[type];
  RTS.makeBld('hq', s, 10, 10);
  const b = RTS.makeBld(type, s, 20, 10);
  if (powered) for (let k = 0; RTS.powerOf(s).net < 0 || k < 1; k++) RTS.makeBld('power', s, 30 + (k % 5) * 3, 10 + Math.floor(k / 5) * 3);
  else for (let k = 0; RTS.powerOf(s).net >= 0; k++) RTS.makeBld(type, s, 30 + (k % 5) * 3, 20 + Math.floor(k / 5) * 4);
  return { G, b, s };
}
// make the building's own queue busy the way the game does: research for Armory / Church, training for the Dark Altar
function makeBusy(G, b) {
  if (b.type === 'altar') G.queues[b.side].altar.list.push('demon');
  else G.rq[b.side][b.type].list.push(RES(b.type));
}
const frameAt = (b, t) => UA.selectOverlay(MAN[b.side ? 'horde' : 'survivors'], b, t);

for (const type of ['armory', 'church', 'altar']) {
  test(`overlay ${type}: busy + powered -> plays {id}-research_0..3 at ~4 fps`, () => {
    const { G, b, s } = base(type, true); makeBusy(G, b);
    assert.ok(RTS.powerOf(s).net >= 0); assert.equal(RTS.bldBusy(b), true); assert.equal(RTS.bldOverlayOn(b), true);
    const names = [0, 0.25, 0.5, 0.75, 1.0, 1.3].map(t => frameAt(b, t).name);
    assert.deepEqual(names, [0, 1, 2, 3, 0, 1].map(n => `${ID[type]}-research_${n}`));
    assert.equal(UA.OVERLAY_FPS, 4);
  });
  test(`overlay ${type}: idle (queue empty) -> off`, () => {
    const { b, s } = base(type, true);
    assert.ok(RTS.powerOf(s).net >= 0); assert.equal(RTS.bldBusy(b), false); assert.equal(RTS.bldOverlayOn(b), false);
  });
  test(`overlay ${type}: busy but unpowered (net < 0) -> off`, () => {
    const { G, b, s } = base(type, false); makeBusy(G, b);
    assert.ok(RTS.powerOf(s).net < 0); assert.equal(RTS.bldBusy(b), true); assert.equal(RTS.bldOverlayOn(b), false);
  });
}

test('overlay: Church also plays while training (Archangel / Templar), Dark Altar through the whole 35 s Demon Lord build, off once done', () => {
  let { G, b } = base('church', true);
  G.queues[0].church.list.push('archangel'); assert.equal(RTS.bldOverlayOn(b), true);
  G.queues[0].church.list.length = 0; assert.equal(RTS.bldOverlayOn(b), false);
  ({ G, b } = base('altar', true));
  G.credits[1] = 1e5; G.started = true;
  for (const t of ['barracks', 'factory']) RTS.makeBld(t, 1, 40 + (t === 'factory' ? 4 : 0), 30);
  assert.ok(RTS.queueItem(1, 'demon'), 'Demon Lord queued');
  const T = RTS.UDEF.demon.time; assert.ok(T >= 30, 'build time ' + T);
  let on = 0, steps = 0, done = null;
  for (let t = 0; t < T + 5; t += 0.5) { RTS.updProduction(0.5); steps++; if (RTS.bldOverlayOn(b)) on++; else if (done === null) done = t; }
  assert.ok(G.units.some(u => u.type === 'demon' && u.side === 1), 'Demon Lord trained');
  assert.ok(on * 0.5 >= T - 1 && done !== null && done >= T - 1, `on ${on * 0.5}s of ${T}s, off from ${done}s`);
  assert.equal(RTS.bldOverlayOn(b), false);
});

test('overlay: other building types never play it; a finished structure waiting for placement is not busy', () => {
  const { G } = base('armory', true);
  for (const t of ['barracks', 'factory', 'power', 'hq']) assert.equal(RTS.bldOverlayOn(RTS.makeBld(t, 0, 50, 50)), false, t);
  assert.deepEqual([...RTS.L4_OVERLAY], ['armory', 'church', 'altar']);
  G.queues[0].structure.list.push('power'); G.queues[0].structure.ready = 'power';
  assert.equal(RTS.bldBusy({ type: 'structure', side: 0 }), false);
  for (const m of Object.values(MAN)) for (const t of ['hq', 'power', 'barracks']) assert.equal(UA.selectOverlay(m, { type: t, side: 0 }, 0), null, t);
});

test('destroyed rubble frames for the 3 tech buildings (own faction only), HQ / Hive top fx frames, extra frames kept out of the index', () => {
  for (const [t, id] of Object.entries(ID)) {
    const fac = SIDE[t] ? 'horde' : 'survivors', other = SIDE[t] ? 'survivors' : 'horde';
    const f = UA.selectDestroyed(MAN[fac], { type: t }); assert.equal(f.name, `${id}-destroyed`); assert.equal(f.shadow, null);
    assert.equal(UA.selectDestroyed(MAN[other], { type: t }), null);
  }
  assert.equal(UA.selectDestroyed(MAN.survivors, { type: 'barracks' }), null);
  assert.deepEqual(UA.topFxFrames(MAN.survivors, 'hq').map(f => f.name), ['hq_muzzle_flash-0', 'hq_muzzle_flash-1', 'hq_muzzle_flash-2']);
  assert.deepEqual(UA.topFxFrames(MAN.horde, 'hq').map(f => f.name), ['hive_fire_puff-0', 'hive_fire_puff-1', 'hive_fire_puff-2', 'hive_fire_puff-3']);
  for (const m of Object.values(MAN)) { for (const f of m.index.values()) assert.ok(f.part !== 'overlay' && f.part !== 'fx'); for (const [team, x] of m.bakedExtra) assert.equal(x.size, m.extra.size, team); }
  // HQ / Hive tops carry a muzzle point for the fx
  for (const m of Object.values(MAN)) assert.ok(UA.selectBuilding(m, { type: 'hq', side: 0, tx: 0, ty: 0, hp: 1, maxhp: 1 }).top.muzzle);
});

test('HQ shot fx window: 0.1 s after a shot while it has a target, phase 0..1', () => {
  const { G } = base('armory', true); const hq = G.blds.find(b => b.type === 'hq');
  assert.equal(RTS.hqShotPhase(hq), -1);
  hq.target = {}; hq.cd = hq.d.rof; assert.equal(RTS.hqShotPhase(hq), 0);
  hq.cd = hq.d.rof - 0.05; assert.ok(Math.abs(RTS.hqShotPhase(hq) - 0.5) < 1e-9);
  hq.cd = hq.d.rof - 0.2; assert.equal(RTS.hqShotPhase(hq), -1);
});

test('loop 4 units: SETS + UNIT_MAP, every facing selects a frame (W mirrored); fx atlas parses', () => {
  assert.deepEqual(UA.SETS['survivors-l4'], { dir: 'units/', json: 'survivors-l4-atlas.json', kind: 'units' });
  assert.deepEqual(UA.SETS['horde-l4'], { dir: 'units/', json: 'horde-l4-atlas.json', kind: 'units' });
  const L4 = { 'survivors-l4': UA.parseManifest(J('units/survivors-l4-atlas.json')), 'horde-l4': UA.parseManifest(J('units/horde-l4-atlas.json')) };
  const want = { flamer: 'flamer', rocket: 'rocket_soldier', medic: 'medic', archangel: 'archangel', templar: 'templar', demon: 'demon_lord' };
  for (const [t, unit] of Object.entries(want)) {
    const m = UA.UNIT_MAP[t]; assert.equal(m.unit, unit); assert.equal(m.kind, 'creature');
    for (const [ang, mir] of [[0, false], [Math.PI / 2, false], [-Math.PI / 2, false], [Math.PI, true]]) {
      const s = UA.selectFrame(L4[m.faction], t, { type: t, side: t === 'demon' ? 1 : 0, ang, tang: ang });
      assert.ok(s && s.frame.unit === unit, t + ' ' + ang); assert.equal(s.mirror, mir, t + ' mirror ' + ang);
    }
  }
  const fx = UA.parseFxManifest(J('units/loop4-fx-atlas.json'));
  for (const [k, n] of Object.entries({ holy_aura: 4, plague_aura: 4, burn_decal: 3, flame_cone: 3, heal_beam: 2, heal_plus: 3 })) assert.equal(fx.fx.get(k).filter(Boolean).length, n, k);
  assert.equal(UA.SETS['fx:l4'].kind, 'fx');
});

test('burn decal: 2x only for units 2+ tiles in size (Demon Lord), 1x for Templar / Archangel / everything else (size test, not UDEF big)', () => {
  const L4 = { s: UA.parseManifest(J('units/survivors-l4-atlas.json')), h: UA.parseManifest(J('units/horde-l4-atlas.json')) };
  const h = (m, t) => UA.selectFrame(m, t, { type: t, side: 0, ang: 0 }).frame.rect[3];
  assert.equal(UA.burnScale(h(L4.h, 'demon')), 2);
  for (const t of ['templar', 'archangel', 'flamer', 'medic']) assert.equal(UA.burnScale(h(L4.s, t)), 1, t);
  // without art (node / ?unitart=off) the game estimates the size from r
  RTS.newArena(2);
  const mk = t => RTS.makeUnit(t, t === 'demon' || t === 'zombie' || t === 'brute' ? 1 : 0, 500, 500);
  assert.equal(RTS.burnScaleOf(mk('demon')), 2);
  for (const t of ['templar', 'archangel', 'survivor', 'zombie', 'brute']) assert.equal(RTS.burnScaleOf(mk(t)), 1, t);
  const z = mk('zombie'); RTS.kill(z, null, 'fire'); const d = RTS.G.decals.find(d => d.k === 'burn'); assert.equal(d.s, 1); assert.equal(d.r, 7);
  const dl = mk('demon'); RTS.kill(dl, null, 'fire'); const d2 = RTS.G.decals.filter(d => d.k === 'burn').pop(); assert.equal(d2.s, 2); assert.equal(d2.r, 16);
});

test('Demon Lord health bar sits above the sprite (u.y - 85); other units keep u.y - r - 7', () => {
  const H = UA.parseManifest(J('units/horde-l4-atlas.json')), S = UA.parseManifest(J('units/survivors-l4-atlas.json'));
  const u = { type: 'demon', side: 1, x: 100, y: 200, r: 22, ang: 0 }, f = UA.selectFrame(H, 'demon', u).frame;
  assert.equal(UA.hpBarY(u, f), 200 - 85);
  const t = { type: 'templar', side: 0, x: 0, y: 200, r: 11, ang: 0 };
  assert.equal(UA.hpBarY(t, UA.selectFrame(S, 'templar', t).frame), 200 - 11 - 7);
  assert.equal(UA.hpBarY(u, null), 200 - 22 - 7);
});

test('dead tech building leaves a ruin decal carrying type / side / tile (art destroyed frame); the HQ dock marker and HQ turret come from art', () => {
  const { G, b } = base('church', true);
  RTS.kill(b, null, 'bullet');
  const d = G.decals.find(d => d.k === 'ruin'); assert.ok(d); assert.equal(d.type, 'church'); assert.equal(d.side, 0); assert.equal(d.tx, b.tx); assert.equal(d.ty, b.ty);
  for (const m of Object.values(MAN)) { const s = UA.selectBuilding(m, { type: 'hq', side: 0, tx: 0, ty: 0, hp: 1, maxhp: 1 }); assert.ok(s.top && s.pad); assert.deepEqual(s.base.dock_pad.tile, [1, 3]); }
});
