// node --test tests/  (unitart.js: Artie's unit art v2 - manifest parsing, facing/heading selection, turret mount, fallback)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UA = require('../unitart.js');
const J = f => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'units', f), 'utf8'));
const SUR = UA.parseManifest(J('survivors-atlas.json')), HOR = UA.parseManifest(J('horde-atlas.json'));
const D = Math.PI / 180;

const pngSize = f => { const b = fs.readFileSync(path.join(__dirname, '..', 'assets', 'units', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
test('art v3 atlases: frame counts, sizes from the manifest match the PNGs, half states present', () => {
  const s = J('survivors-atlas.json'), h = J('horde-atlas.json');
  assert.equal(s.frames.length, 176); assert.equal(s.neutral.frames.length, 88);
  assert.equal(h.frames.length, 48); assert.equal(h.neutral.frames.length, 24);
  for (const m of [s, h]) {
    assert.deepEqual(pngSize(m.image), m.size); assert.deepEqual(pngSize(m.trim_mask.image), m.trim_mask.size);
    assert.deepEqual(pngSize(m.neutral.image), m.neutral.size); assert.deepEqual(pngSize(m.neutral.trim_image), m.neutral.size);
    for (const f of m.neutral.frames) { const [x, y, w, hh] = f.rect; assert.ok(x + w <= m.neutral.size[0] && y + hh <= m.neutral.size[1], f.name); assert.ok(f.anchor[0] >= 0 && f.anchor[0] <= w && f.anchor[1] >= 0 && f.anchor[1] <= hh, f.name); }
  }
  assert.deepEqual(h.size, [512, 256]);
  for (let k = 0; k < 16; k++) assert.ok(SUR.index.get(UA.fkey('scrap_truck', 'half', k * 22.5)));
  for (const f of 'ESNW') assert.ok(HOR.index.get(UA.fkey('scrap_eater', 'half', f)));
  // Horde default ramp = Artie's v3 violet, read from the manifest
  assert.equal(h.default_team, 'violet'); assert.deepEqual(h.team_ramps.violet, { light: '#D2B0FF', base: '#B07CFF', dark: '#7A48D0' });
  assert.deepEqual(HOR.ramps.violet, h.team_ramps.violet);
});
test('Scrap Eater half/full: 1.05x / 1.1x baked into the frame pixels (scale field), same ground anchor and shadow offset', () => {
  for (const f of 'ESN') {
    const e = HOR.index.get(UA.fkey('scrap_eater', 'empty', f)), hf = HOR.index.get(UA.fkey('scrap_eater', 'half', f)), fu = HOR.index.get(UA.fkey('scrap_eater', 'full', f));
    assert.ok(Math.abs(fu.scale / e.scale - 1.1) < 0.002); assert.ok(Math.abs(hf.scale / e.scale - 1.05) < 0.002);
    for (const x of [hf, fu]) {
      assert.ok(x.rect[2] >= e.rect[2] && x.rect[3] >= e.rect[3], 'bigger rect ' + f);
      assert.equal(x.anchor[0], x.rect[2] / 2); assert.equal(x.rect[3] - x.anchor[1], e.rect[3] - e.anchor[1]); // bottom-centre ground point
      assert.equal(x.shadow.dx, e.shadow.dx); assert.equal(x.shadow.dy, e.shadow.dy);
    }
  }
});
test('Scrap Eater shadow rx/ry scale by state (empty 1.0, half 1.05, full 1.1) on every facing; offset and alpha unchanged', () => {
  for (const idx of [HOR.index, HOR.baked.get('violet'), HOR.baked.get('red')]) for (const f of 'ESNW') {
    const e = idx.get(UA.fkey('scrap_eater', 'empty', f)).shadow;
    for (const [st, k] of [['empty', 1.0], ['half', 1.05], ['full', 1.1]]) {
      const s = idx.get(UA.fkey('scrap_eater', st, f)).shadow;
      assert.ok(Math.abs(s.rx - e.rx * k) <= 0.006, st + ' ' + f + ' rx ' + s.rx + ' vs ' + e.rx * k);   // manifest rounds to 2 dp
      assert.ok(Math.abs(s.ry - e.ry * k) <= 0.006, st + ' ' + f + ' ry ' + s.ry + ' vs ' + e.ry * k);
      assert.equal(s.dx, 3); assert.equal(s.dy, 0.5); assert.equal(s.alpha, 0.3);
    }
  }
  // W mirrors E, so its shadow matches E's
  for (const st of ['empty', 'half', 'full']) assert.deepEqual(HOR.index.get(UA.fkey('scrap_eater', st, 'W')).shadow, HOR.index.get(UA.fkey('scrap_eater', st, 'E')).shadow);
});
test('parseManifest indexes every neutral frame of both atlases', () => {
  assert.equal(SUR.index.size, J('survivors-atlas.json').neutral.frames.length);
  assert.equal(HOR.index.size, J('horde-atlas.json').neutral.frames.length);
  assert.equal(SUR.image, 'survivors-atlas-neutral.png'); assert.equal(SUR.trim, 'survivors-atlas-neutral-trim.png');
  assert.equal(HOR.image, 'horde-atlas-neutral.png');
  for (const fac of ['survivors-atlas.json', 'horde-atlas.json']) for (const f of ['image', 'trim_image']) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'units', J(fac).neutral[f])), f);
  // every mapped game unit has every frame it can ask for
  for (let h = 0; h < 16; h++) for (const st of ['empty', 'full']) assert.ok(SUR.index.get(UA.fkey('scrap_truck', st, h * 22.5)), 'truck ' + st + h);
  for (let h = 0; h < 16; h++) { assert.ok(SUR.index.get(UA.fkey('tank_hull', 'idle', h * 22.5)).turret_mount); assert.ok(SUR.index.get(UA.fkey('tank_turret', 'idle', h * 22.5))); }
  for (const u of ['rifleman', 'angel']) for (const f of 'ESN') assert.ok(SUR.index.get(UA.fkey(u, 'idle', f)), u + f);
  for (const u of ['zombie', 'imp', 'hellbrute']) for (const f of 'ESN') assert.ok(HOR.index.get(UA.fkey(u, 'idle', f)), u + f);
  for (const st of ['empty', 'full']) for (const f of 'ESN') assert.ok(HOR.index.get(UA.fkey('scrap_eater', st, f)));
});
test('parseManifest rejects a manifest without neutral frames; skips malformed frames', () => {
  assert.throws(() => UA.parseManifest({}), /neutral\.frames/);
  assert.throws(() => UA.parseManifest(null));
  assert.throws(() => UA.parseManifest({ neutral: { frames: 'x' } }));
  const m = UA.parseManifest({ neutral: { image: 'a.png', trim_image: 'b.png', frames: [{ unit: 'zombie', state: 'idle', facing: 'E', rect: [0, 0, 4, 4], anchor: [2, 4] }, { unit: 'zombie', state: 'idle', facing: 'S', rect: [0, 0] }, null] } });
  assert.equal(m.index.size, 1);
});
test('snap16: 16 headings, nearest 22.5, wraps 360 -> 0 and negatives', () => {
  for (let h = 0; h < 16; h++) { assert.equal(UA.snap16(h * 22.5), h * 22.5); assert.equal(UA.snap16(h * 22.5 + 11), h * 22.5); assert.equal(UA.snap16(h * 22.5 - 11 + 360), h * 22.5); }
  assert.equal(UA.snap16(359), 0); assert.equal(UA.snap16(348.75 + 0.1), 0); assert.equal(UA.snap16(-10), 0); assert.equal(UA.snap16(-90), 270); assert.equal(UA.snap16(720 + 45), 45);
});
test('vehicle selection: hull snapped to 16 headings, turret aimed independently (tang)', () => {
  for (let h = 0; h < 16; h++) {
    const s = UA.selectFrame(SUR, 'ark', { ang: (h * 22.5 + 5) * D, tang: (h * 22.5 + 5) * D });
    assert.equal(s.heading, h * 22.5); assert.equal(s.frame.unit, 'tank_hull'); assert.equal(s.frame.facing, h * 22.5); assert.equal(s.turret.facing, h * 22.5); assert.equal(s.mirror, false);
  }
  const s = UA.selectFrame(SUR, 'ark', { ang: 0, tang: -90 * D }); // hull east, turret north
  assert.equal(s.frame.facing, 0); assert.equal(s.turret.facing, 270);
  assert.equal(UA.selectFrame(SUR, 'ark', { ang: 90 * D }).turret.facing, 90); // no tang -> turret follows hull
  assert.equal(UA.selectFrame(SUR, 'gleaner', { ang: Math.PI, load: 0, d: { cap: 500 } }).frame.facing, 180);
});
test('creature facing E/S/N; W = E mirrored with anchorW.x = w - anchorE.x', () => {
  assert.equal(UA.facing4(0), 'E'); assert.equal(UA.facing4(Math.PI / 2), 'S'); assert.equal(UA.facing4(-Math.PI / 2), 'N'); assert.equal(UA.facing4(Math.PI), 'W');
  assert.equal(UA.facing4(30 * D), 'E'); assert.equal(UA.facing4(60 * D), 'S'); assert.equal(UA.facing4(170 * D), 'W'); assert.equal(UA.facing4(-120 * D), 'N');
  for (const [m, t] of [[SUR, 'survivor'], [SUR, 'seraph'], [HOR, 'zombie'], [HOR, 'imp'], [HOR, 'brute']]) {
    for (const [a, f] of [[0, 'E'], [90, 'S'], [-90, 'N']]) { const s = UA.selectFrame(m, t, { ang: a * D }); assert.equal(s.frame.facing, f); assert.equal(s.mirror, false); }
    const w = UA.selectFrame(m, t, { ang: Math.PI }), e = UA.selectFrame(m, t, { ang: 0 });
    assert.equal(w.frame, e.frame); assert.equal(w.mirror, true);
    const f = e.frame, [ex] = UA.topLeft(f, 100, 100, false), [wx, wy] = UA.topLeft(f, 100, 100, true);
    assert.equal(ex, Math.round(100 - f.anchor[0])); assert.equal(wx, Math.round(100 - (f.rect[2] - f.anchor[0]))); assert.equal(wy, Math.round(100 - f.anchor[1]));
  }
  // no E frame but a baked W -> baked W unmirrored
  const m = UA.parseManifest({ neutral: { frames: [{ unit: 'zombie', state: 'idle', facing: 'W', rect: [0, 0, 4, 4], anchor: [1, 4] }] } });
  assert.deepEqual([UA.selectFrame(m, 'zombie', { ang: Math.PI }).mirror], [false]);
});
test('topLeft rounds px - anchor; turret pivot lands on hull rect top-left + turret_mount', () => {
  const hull = { rect: [0, 0, 40, 40], anchor: [19.6, 20.4], turret_mount: [20, 19] };
  assert.deepEqual(UA.topLeft(hull, 100.3, 200.2, false), [81, 180]);
  assert.deepEqual(UA.turretPos(hull, 100.3, 200.2), [101, 199]);
  // real atlas: every hull's mount is within 3px of its own anchor, so the turret sits on the unit position
  for (let h = 0; h < 16; h++) {
    const f = SUR.index.get(UA.fkey('tank_hull', 'idle', h * 22.5)), [mx, my] = UA.turretPos(f, 500, 500);
    assert.ok(Math.hypot(mx - 500, my - 500) <= 3.5, 'heading ' + h * 22.5 + ' mount ' + [mx, my]);
    const t = SUR.index.get(UA.fkey('tank_turret', 'idle', h * 22.5)), [tx, ty] = UA.topLeft(t, mx, my, false);
    assert.deepEqual([tx, ty], [Math.round(mx - t.anchor[0]), Math.round(my - t.anchor[1])]);
  }
});
const SAL = require('../salvage.js');
test('cargo stages come from pipsOf + cargoHalfPips/cargoFullPips (Dezi option C); no fraction thresholds', () => {
  assert.equal(SAL.D.cargoHalfPips, 1); assert.equal(SAL.D.cargoFullPips, 4);
  assert.match(SAL.TABLE.cargoHalfPips.src, /Dezi/); assert.match(SAL.TABLE.cargoFullPips.src, /Dezi/);
  assert.equal(SAL.D.cargoHalfAt, undefined); assert.equal(SAL.D.cargoFullAt, undefined); assert.equal(UA.FULL_AT, undefined);
  assert.equal(UA.salvage(), SAL);
  // pipsOf still rounds up (Loop 2 rule unchanged)
  assert.deepEqual([0, 1, 100, 101, 499, 500].map(l => SAL.pipsOf(l, 500)), [0, 1, 1, 2, 5, 5]);
});
// boundary loads (cap 500): 0, tiny, 0.2, 0.6, just over 0.6, 0.8, 1.0 -> pips 0,1,1,3,4,4,5
const BOUNDS = [[0, 0, 'empty'], [1, 1, 'half'], [100, 1, 'half'], [300, 3, 'half'], [301, 4, 'full'], [400, 4, 'full'], [500, 5, 'full']];
const stageOfPips = p => p >= 4 ? 'full' : p >= 1 ? 'half' : 'empty';
// v3 atlases ship 'half' frames; the "without" cases strip them to prove the per-facing fallback to 'empty' still works
const noHalf = fac => { const j = J(fac); j.neutral.frames = j.neutral.frames.filter(f => f.state !== 'half'); return UA.parseManifest(j); };
const S0 = noHalf('survivors-atlas.json'), H0 = noHalf('horde-atlas.json');
const CASES = [[S0, 'gleaner', false], [H0, 'reaper', false], [SUR, 'gleaner', true], [HOR, 'reaper', true]];
test('cargo stage at boundary loads, without (half -> empty frame) and with a half frame', () => {
  const d = { cap: 500 };
  for (const [load, pips, stage] of BOUNDS) {
    assert.equal(SAL.pipsOf(load, 500), pips, 'pips ' + load);
    for (const [m, t, half] of CASES) for (const ang of [0, 2, Math.PI]) {
      const s = UA.selectFrame(m, t, { ang, load, d });
      assert.equal(s.stage, stage, t + ' ' + load); assert.equal(s.frame.state, stage === 'half' && !half ? 'empty' : stage, t + ' ' + load + ' half=' + half);
    }
  }
  assert.equal(UA.selectFrame(SUR, 'survivor', { ang: 0, load: 500 }).frame.state, 'idle');
});
test('sprite stage and pip bar agree at every load 0..1 (step 0.001 of capacity), with and without a half frame', () => {
  const d = { cap: 500 };
  for (let k = 0; k <= 1000; k++) {
    const load = k * 0.5, want = stageOfPips(SAL.pipsOf(load, 500));
    for (const [m, t, half] of CASES) {
      const s = UA.selectFrame(m, t, { ang: k % 7, load, d });
      assert.equal(s.stage, want, t + ' ' + load);
      assert.equal(s.frame.state, want === 'half' && !half ? 'empty' : want, t + ' ' + load);
    }
  }
});
test('a half frame for only some facings is picked up per facing; others draw empty', () => {
  const j = J('horde-atlas.json'), d = { cap: 500 };
  j.neutral.frames = j.neutral.frames.filter(f => !(f.state === 'half' && f.facing !== 'S'));
  const H3 = UA.parseManifest(j);
  assert.equal(UA.selectFrame(H3, 'reaper', { ang: Math.PI / 2, load: 250, d }).frame.state, 'half');
  assert.equal(UA.selectFrame(H3, 'reaper', { ang: 0, load: 250, d }).frame.state, 'empty');
});
test('cargo unit without Salvage table values -> procedural fallback (null)', () => {
  assert.equal(UA.selectFrame(SUR, 'gleaner', { ang: 0, load: 0, d: { cap: 500 } }, null, { D: {}, pipsOf: SAL.pipsOf }), null);
});
test('fallback selection: unmapped types, missing manifest, missing frames -> null (procedural)', () => {
  for (const t of ['hq', 'turret', 'nope', undefined]) assert.equal(UA.selectFrame(SUR, t, { ang: 0 }), null);
  assert.equal(UA.selectFrame(null, 'survivor', { ang: 0 }), null);
  assert.equal(UA.selectFrame(HOR, 'survivor', { ang: 0 }), null); // wrong atlas
  const only = f => UA.parseManifest({ neutral: { frames: J('survivors-atlas.json').neutral.frames.filter(f) } });
  assert.equal(UA.selectFrame(only(f => f.unit !== 'tank_turret'), 'ark', { ang: 0 }), null);          // turret missing -> whole tank procedural
  assert.equal(UA.selectFrame(only(f => !(f.unit === 'tank_hull' && f.facing === 90)), 'ark', { ang: Math.PI / 2 }), null);
  assert.ok(UA.selectFrame(only(f => !(f.unit === 'tank_hull' && f.facing === 90)), 'ark', { ang: 0 }));
  assert.equal(UA.selectFrame(only(f => !(f.unit === 'rifleman' && f.facing === 'S')), 'survivor', { ang: Math.PI / 2 }), null);
  assert.equal(UA.selectFrame(only(f => !(f.unit === 'scrap_truck' && f.state === 'full')), 'gleaner', { ang: 0, load: 500, d: { cap: 500 } }), null);
  assert.equal(UA.selectFrame(only(f => !(f.unit === 'scrap_truck' && f.state !== 'full')), 'gleaner', { ang: 0, load: 200, d: { cap: 500 } }), null); // half and empty both missing -> procedural
  assert.equal(UA.selectFrame(only(f => !(f.unit === 'scrap_truck' && f.state === 'half')), 'gleaner', { ang: 0, load: 200, d: { cap: 500 } }).frame.state, 'empty');
  // draw() outside a browser with nothing loaded never throws and reports fallback
  assert.equal(UA.draw({}, { type: 'survivor', side: 0, x: 0, y: 0, ang: 0 }), false);
  assert.equal(UA.draw({}, { type: 'survivor', x: 0, y: 0, ang: 0 }), false); // sidebar icon (no side) stays procedural
});
test('recolourPixels rebuilds the trim ramp exactly and leaves non-trim pixels alone', () => {
  const px = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255, 9, 9, 9, 255]);
  const mk = new Uint8ClampedArray([255, 255, 255, 255, 170, 170, 170, 255, 85, 85, 85, 255, 0, 0, 0, 0]);
  UA.recolourPixels(px, mk, UA.RAMPS.violet);
  assert.deepEqual([...px], [0xD2, 0xB0, 0xFF, 255, 0xB0, 0x7C, 0xFF, 255, 0x7A, 0x48, 0xD0, 255, 9, 9, 9, 255]);
  assert.deepEqual(UA.hexToRgb('#3A7BFF'), [0x3A, 0x7B, 0xFF]);
  assert.equal(UA.DEFAULT_TEAM[0], 'blue'); assert.equal(UA.DEFAULT_TEAM[1], 'violet');
  // manifest ramps agree with the ones in code
  const j = J('survivors-atlas.json').team_ramps; assert.deepEqual(j.blue, UA.RAMPS.blue); assert.deepEqual(j.red, UA.RAMPS.red);
  assert.deepEqual(J('horde-atlas.json').team_ramps.violet, UA.RAMPS.violet);
});
test('baked colour frames are indexed per team (used only when the recolour readback is impossible)', () => {
  assert.deepEqual([...SUR.baked.keys()].sort(), ['blue', 'red']); assert.deepEqual([...HOR.baked.keys()].sort(), ['red', 'violet']);
  assert.equal(SUR.bakedImage, 'survivors-atlas.png');
  const s = UA.selectFrame(SUR, 'ark', { ang: 0, tang: Math.PI }, SUR.baked.get('red'));
  assert.equal(s.frame.team, 'red'); assert.equal(s.turret.team, 'red'); assert.equal(s.turret.facing, 180);
  const w = UA.selectFrame(HOR, 'zombie', { ang: Math.PI }, HOR.baked.get('violet')); assert.equal(w.frame.team, 'violet'); assert.equal(w.mirror, true);
});
