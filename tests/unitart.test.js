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
test('cargo state: empty below 50% of cap, full at/above; non-cargo units idle', () => {
  const d = { cap: 500 };
  assert.equal(UA.selectFrame(SUR, 'gleaner', { ang: 0, load: 0, d }).frame.state, 'empty');
  assert.equal(UA.selectFrame(SUR, 'gleaner', { ang: 0, load: 249, d }).frame.state, 'empty');
  assert.equal(UA.selectFrame(SUR, 'gleaner', { ang: 0, load: 250, d }).frame.state, 'full');
  assert.equal(UA.selectFrame(HOR, 'reaper', { ang: 0, load: 500, d }).frame.state, 'full');
  assert.equal(UA.selectFrame(HOR, 'reaper', { ang: Math.PI, load: 10, d }).frame.state, 'empty');
  assert.equal(UA.selectFrame(SUR, 'survivor', { ang: 0, load: 500 }).frame.state, 'idle');
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
  // draw() outside a browser with nothing loaded never throws and reports fallback
  assert.equal(UA.draw({}, { type: 'survivor', side: 0, x: 0, y: 0, ang: 0 }), false);
  assert.equal(UA.draw({}, { type: 'survivor', x: 0, y: 0, ang: 0 }), false); // sidebar icon (no side) stays procedural
});
test('recolourPixels rebuilds the trim ramp exactly and leaves non-trim pixels alone', () => {
  const px = new Uint8ClampedArray([1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255, 9, 9, 9, 255]);
  const mk = new Uint8ClampedArray([255, 255, 255, 255, 170, 170, 170, 255, 85, 85, 85, 255, 0, 0, 0, 0]);
  UA.recolourPixels(px, mk, UA.RAMPS.violet);
  assert.deepEqual([...px], [0xC4, 0x9B, 0xFF, 255, 0x9A, 0x5C, 0xFF, 255, 0x5A, 0x2F, 0xA0, 255, 9, 9, 9, 255]);
  assert.deepEqual(UA.hexToRgb('#3A7BFF'), [0x3A, 0x7B, 0xFF]);
  assert.equal(UA.DEFAULT_TEAM[0], 'blue'); assert.equal(UA.DEFAULT_TEAM[1], 'violet');
  // manifest ramps agree with the ones in code
  const j = J('survivors-atlas.json').team_ramps; assert.deepEqual(j.blue, UA.RAMPS.blue); assert.deepEqual(j.red, UA.RAMPS.red);
  assert.deepEqual(J('horde-atlas.json').team_ramps.violet, UA.RAMPS.violet);
});
