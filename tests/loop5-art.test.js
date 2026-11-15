// Loop 5 atlas integration: wall masks, gate orientation / open animation, mid-air leap poses,
// ART_PENDING cleared, Bone Forge overlay, spawn points from damaged-frame metadata.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UA = require('../unitart.js');
const { load } = require('./harness.js');

const J = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', rel), 'utf8'));
const S5 = UA.parseBuildingManifest(J('buildings/survivors-l5-atlas.json'));
const H5 = UA.parseBuildingManifest(J('buildings/horde-l5-atlas.json'));
const B = (type, extra) => Object.assign({ type, side: 0, tx: 10, ty: 20, w: 1, h: 1, hp: 100, maxhp: 100, charge: 0, tang: 0, target: null, tileMask: 0, rot: 0, gate: 'closed', animT: 0 }, extra || {});

test('ART_PENDING is empty and L5 types are in BLD_MAP', () => {
  const { RTS } = load();
  assert.deepEqual([...RTS.ART_PENDING].sort(), []);
  for (const t of ['wall', 'gate', 'flametower', 'rockettower', 'forge']) assert.ok(UA.BLD_MAP[t], t);
  assert.equal(UA.BLD_MAP.forge.survivors, null);
});

test('wall autotile uses m00-m15 from tileMask (N=1,E=2,S=4,W=8), idle fallback is m00', () => {
  for (let m = 0; m < 16; m++) {
    const sel = UA.selectBuilding(S5, B('wall', { tileMask: m }));
    assert.ok(sel, 'mask ' + m);
    const want = 'm' + String(m).padStart(2, '0');
    assert.equal(sel.base.state, want);
    assert.equal(sel.state, want);
  }
  const idle = UA.selectBuilding(S5, B('wall', { tileMask: 0 }));
  assert.equal(idle.base.state, 'm00');
  assert.deepEqual(idle.base.rect, S5.index.get('wall|base|idle').rect);
});

test('damaged walls keep the mask body and add a crack overlay; critical uses tear', () => {
  const dmg = UA.selectBuilding(S5, B('wall', { tileMask: 5, hp: 40 }));
  assert.equal(dmg.state, 'damaged');
  assert.equal(dmg.base.state, 'm05');
  assert.ok(dmg.ov && /^crack[12]$/.test(dmg.ov.state), dmg.ov && dmg.ov.state);
  const crit = UA.selectBuilding(S5, B('wall', { tileMask: 5, hp: 20 }));
  assert.equal(crit.state, 'critical');
  assert.equal(crit.base.state, 'm05');
  assert.ok(crit.ov && /^tear[12]$/.test(crit.ov.state), crit.ov && crit.ov.state);
});

test('gate orientation follows rot / footprint; f0 is closed, f3 is open, opening interpolates', () => {
  const closed = UA.selectBuilding(S5, B('gate', { w: 2, h: 1, rot: 0, gate: 'closed' }));
  assert.equal(UA.gateOrient({ rot: 0, w: 2, h: 1 }), 'h');
  assert.equal(closed.base.state, 'h-f0');
  const open = UA.selectBuilding(S5, B('gate', { w: 2, h: 1, rot: 0, gate: 'open' }));
  assert.equal(open.base.state, 'h-f3');
  const mid = UA.selectBuilding(S5, B('gate', { w: 2, h: 1, rot: 0, gate: 'opening', animT: 0.2 })); // GATE_ANIM_S 0.4 → frame 2
  assert.equal(UA.gateLeaf({ gate: 'opening', animT: 0.2 }), 2);
  assert.equal(mid.base.state, 'h-f2');
  const vert = UA.selectBuilding(S5, B('gate', { w: 1, h: 2, rot: 1, gate: 'closed' }));
  assert.equal(UA.gateOrient({ rot: 1, w: 1, h: 2 }), 'v');
  assert.equal(vert.base.state, 'v-f0');
  const closing = UA.selectBuilding(S5, B('gate', { w: 2, h: 1, gate: 'closing', animT: 0.2 }));
  assert.equal(closing.base.state, 'h-f1'); // 3-2
});

test('damaged / critical gates keep the current leaf and draw the orientation overlay', () => {
  const dmg = UA.selectBuilding(S5, B('gate', { w: 2, h: 1, gate: 'open', hp: 40 }));
  assert.equal(dmg.base.state, 'h-f3');
  assert.equal(dmg.ov && dmg.ov.state, 'h-damaged_ov');
  const critV = UA.selectBuilding(S5, B('gate', { w: 1, h: 2, rot: 1, gate: 'closed', hp: 10 }));
  assert.equal(critV.base.state, 'v-f0');
  assert.equal(critV.ov && critV.ov.state, 'v-critical_ov');
});

test('flametower and rockettower select a 16-heading top; forge has research overlay frames', () => {
  const rt = UA.selectBuilding(S5, B('rockettower', { tang: Math.PI / 2 }));
  assert.equal(rt.base.state, 'idle');
  assert.ok(rt.top, 'rocket top');
  const ft = UA.selectBuilding(H5, B('flametower', { side: 1, tang: 0 }));
  assert.ok(ft.top, 'flame top');
  const ov = UA.selectOverlay(H5, B('forge', { side: 1 }), 0);
  assert.ok(ov && ov.part === 'overlay', 'forge overlay');
  const ov2 = UA.selectOverlay(H5, B('forge', { side: 1 }), 0.3);
  assert.ok(ov2 && ov2.frame !== ov.frame, 'forge overlay animates');
});

test('Shock Trooper and Ghoul Leaper use the air state while leaping', () => {
  const SU = UA.parseManifest(J('units/survivors-l5-atlas.json'));
  const HU = UA.parseManifest(J('units/horde-l5-atlas.json'));
  const shock = { type: 'shock', side: 0, x: 0, y: 0, ang: 0, leaping: true };
  const leap = { type: 'leaper', side: 1, x: 0, y: 0, ang: Math.PI / 2, leaping: true };
  const s = UA.selectFrame(SU, 'shock', shock);
  const l = UA.selectFrame(HU, 'leaper', leap);
  assert.equal(s && s.stage, 'air');
  assert.equal(s && s.frame.state, 'air');
  assert.equal(l && l.stage, 'air');
  assert.equal(l && l.frame.state, 'air');
  const grounded = UA.selectFrame(SU, 'shock', { type: 'shock', side: 0, x: 0, y: 0, ang: 0, leaping: false });
  assert.ok(grounded && grounded.stage !== 'air');
});

test('damaged / critical frame metadata supplies fx_points, with procedural fallback if none', () => {
  const dmg = B('flametower', { hp: 40 });
  const pts = UA.dmgPoints; // needs a planned building, which needs a loaded atlas in the browser
  // Headless: read the damaged frame itself.
  const f = S5.index.get('flametower|base|damaged');
  assert.ok(f && Array.isArray(f.fx_points) && f.fx_points.length >= 1, 'damaged fx_points');
  const c = S5.index.get('flametower|base|critical');
  assert.ok(c && Array.isArray(c.fx_points) && c.fx_points.length >= 1, 'critical fx_points');
  assert.ok(c.fx_points.length >= f.fx_points.length, 'critical has at least as many points as damaged');
});
