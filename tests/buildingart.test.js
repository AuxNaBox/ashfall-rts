// node --test tests/  (unitart.js building art v1: rts-loops/art/buildings/HANDOFF-buildings.md)
// manifest parsing, BDEF type -> building id, footprints vs game.js, anchor/shadow/pad/top maths, state selection, fallback
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const UA = require('../unitart.js');
const { load } = require('./harness.js');
const DIR = path.join(__dirname, '..', 'assets', 'buildings');
const J = f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const RAW = { survivors: J('survivors-buildings-atlas.json'), horde: J('horde-buildings-atlas.json') };
const MAN = { survivors: UA.parseBuildingManifest(RAW.survivors), horde: UA.parseBuildingManifest(RAW.horde) };
const pngSize = f => { const b = fs.readFileSync(path.join(DIR, f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const { RTS } = load(); const BDEF = RTS.BDEF;
const TYPES = ['hq', 'power', 'refinery', 'depot', 'barracks', 'turret', 'factory', 'silo'];
const B = (type, extra) => Object.assign({ type, side: 0, tx: 10, ty: 20, w: BDEF[type] ? BDEF[type].w : 1, h: BDEF[type] ? BDEF[type].h : 1, hp: 100, maxhp: 100, charge: 0, tang: 0, target: null }, extra || {});
const D = Math.PI / 180;

test('building atlases: 84 frames (42 neutral), 1024x512 PNGs, every file present, no -v1 backups shipped', () => {
  for (const [fac, m] of Object.entries(RAW)) {
    assert.equal(m.frames.length, 84, fac); assert.equal(m.neutral.frames.length, 42, fac);
    assert.deepEqual(m.size, [1024, 512]);
    assert.deepEqual(pngSize(m.image), m.size); assert.deepEqual(pngSize(m.trim_mask.image), m.trim_mask.size);
    assert.deepEqual(pngSize(m.neutral.image), m.neutral.size); assert.deepEqual(pngSize(m.neutral.trim_image), m.neutral.size);
    for (const f of m.neutral.frames.concat(m.frames)) { const [x, y, w, h] = f.rect; assert.ok(x + w <= 1024 && y + h <= 512, f.name); }
  }
  assert.deepEqual(fs.readdirSync(DIR).filter(f => /-v1\./.test(f)), []);
  assert.deepEqual(MAN.horde.ramps.violet, { light: '#D2B0FF', base: '#B07CFF', dark: '#7A48D0' });
  assert.equal(MAN.survivors.defaultTeam, 'blue'); assert.equal(MAN.horde.defaultTeam, 'violet');
  assert.deepEqual([...MAN.survivors.baked.keys()].sort(), ['blue', 'red']); assert.deepEqual([...MAN.horde.baked.keys()].sort(), ['red', 'violet']);
});

test('parseBuildingManifest: indexes base/top/pad by code type; rejects bad manifests; skips malformed frames', () => {
  for (const m of Object.values(MAN)) {
    assert.equal(m.index.size, 42);
    for (const t of TYPES) for (const s of t === 'silo' ? ['closed', 'open', 'damaged', 'construct'] : ['idle', 'damaged', 'construct']) assert.ok(m.index.get(UA.bkey(t, 'base', s)), t + ' ' + s);
    for (let k = 0; k < 16; k++) assert.ok(m.index.get(UA.bkey('turret', 'top', 'idle', k * 22.5)), 'top ' + k);
    assert.ok(m.index.get(UA.bkey('refinery', 'pad', 'idle')));
  }
  assert.throws(() => UA.parseBuildingManifest({}), /no neutral.frames/);
  assert.throws(() => UA.parseBuildingManifest({ neutral: { frames: [{ name: 'x' }] } }), /no usable frames/);
  const one = UA.parseBuildingManifest({ neutral: { frames: [{ code_type: 'hq', part: 'base', state: 'idle', rect: [0, 0, 96, 96], anchor: [48, 96], footprint: [3, 3], footprint_origin: [0, 0] }, { code_type: 'hq', part: 'base', state: 'damaged', rect: [0, 0, 1] }] } });
  assert.equal(one.index.size, 1);
});

test('BDEF type -> building id per faction (HANDOFF §3), and every manifest footprint matches game.js BDEF', () => {
  const want = { hq: ['hq', 'hive'], power: ['power_plant', 'power_plant'], refinery: ['scrap_yard', 'grinder_pit'], depot: ['depot', 'depot'], barracks: ['barracks', 'spawning_pit'], factory: ['factory', 'factory'], turret: ['turret', 'bone_spire'], silo: ['nuke_silo', 'hell_silo'] };
  assert.deepEqual(Object.keys(UA.BLD_MAP).sort(), Object.keys(BDEF).sort());
  for (const [t, [s, h]] of Object.entries(want)) {
    assert.equal(UA.BLD_MAP[t].survivors, s); assert.equal(UA.BLD_MAP[t].horde, h);
    assert.equal(UA.selectBuilding(MAN.survivors, B(t)).base.building, s); assert.equal(UA.selectBuilding(MAN.horde, B(t, { side: 1 })).base.building, h);
  }
  let checked = 0;
  for (const [fac, m] of Object.entries(RAW)) for (const f of m.neutral.frames.concat(m.frames)) if (f.part === 'base') {
    assert.deepEqual(f.footprint, [BDEF[f.code_type].w, BDEF[f.code_type].h], fac + ' ' + f.name); checked++;
  }
  assert.equal(checked, 2 * 3 * 25);   // per faction 25 neutral base frames + 2 baked teams
});

test('anchor maths: anchor = footprint bottom-centre, body drawn at tx*32 - footprint_origin, building rises above the footprint', () => {
  for (const m of Object.values(MAN)) for (const f of m.index.values()) if (f.part === 'base') {
    const [fw, fh] = f.footprint, tx = 7, ty = 11;
    assert.deepEqual(UA.anchorPos(f, tx, ty), [tx * 32 + fw * 16, (ty + fh) * 32], f.name);
    const [ox, oy] = UA.bodyPos(f, tx, ty); assert.ok(Number.isInteger(ox) && Number.isInteger(oy));
    assert.equal(oy + f.rect[3], (ty + fh) * 32, f.name + ' bottom row sits on the footprint bottom');
    assert.equal(UA.sortKey({ tx, ty, h: fh }), (ty + fh) * 32);
  }
  const hq = MAN.survivors.index.get(UA.bkey('hq', 'base', 'idle'));
  assert.deepEqual(UA.bodyPos(hq, 10, 20), [320, 620]);          // 116 px tall on a 96 px footprint: rises 20 px above it
});

test('shadow: Survivors footprint rect, Horde ellipse; 30% black, +3,+3 from the footprint centre, footprint inset 2 px', () => {
  for (const [fac, m] of Object.entries(MAN)) for (const t of TYPES) {
    const f = m.index.get(UA.bkey(t, 'base', t === 'silo' ? 'closed' : 'idle')), g = UA.shadowGeom(f, 10, 20), [fw, fh] = f.footprint;
    assert.equal(g.shape, fac === 'survivors' ? 'rect' : 'ellipse'); assert.equal(g.alpha, 0.3);
    assert.equal(g.cx, 320 + fw * 16 + 3); assert.equal(g.cy, 640 + fh * 16 + 3); assert.equal(g.w, fw * 32 - 4); assert.equal(g.h, fh * 32 - 4);
  }
});

test('dock pad: manifest tile [1,2] = game.js padTile(b) (tx+1, ty+h); 1-tile frame centred on the pad tile', () => {
  for (const [fac, m] of Object.entries(MAN)) {
    const base = m.index.get(UA.bkey('refinery', 'base', 'idle')), pad = m.index.get(UA.bkey('refinery', 'pad', 'idle'));
    assert.deepEqual(base.dock_pad.tile, [1, 2]); assert.deepEqual(pad.footprint, [1, 1]);
    assert.deepEqual(UA.padTileOf(base, 10, 20), [11, 22]);
    const [x, y] = UA.padPos(pad, 11, 22); assert.ok(Math.abs(x + pad.anchor[0] - (11 * 32 + 16)) <= 0.5 && Math.abs(y + pad.anchor[1] - (22 * 32 + 16)) <= 0.5, fac);
    assert.ok(pad.rect[2] <= 32 && pad.rect[3] <= 32);
  }
  // the real game: every starting refinery's pad (open ground) is exactly the manifest's tile [1,2] = (tx+1, ty+h)
  RTS.newGame('normal'); let n = 0;
  for (const b of RTS.G.blds) if (b.type === 'refinery') {
    const base = MAN[b.side ? 'horde' : 'survivors'].index.get(UA.bkey('refinery', 'base', 'idle')), d = RTS.dockPoint(b);
    assert.deepEqual([Math.floor(d.x / 32), Math.floor(d.y / 32)], UA.padTileOf(base, b.tx, b.ty)); n++;
  }
  assert.ok(n >= 1);
});

test('turret / bone spire tops: 16 headings, aimed at the real target (b.tang), idle default south, pivot at turret_mount', () => {
  for (const m of Object.values(MAN)) {
    for (let k = 0; k < 16; k++) { const s = UA.selectBuilding(m, B('turret', { tang: k * 22.5 * D, target: {} })); assert.equal(s.heading, k * 22.5); assert.equal(s.top.facing, k * 22.5); }
    assert.equal(UA.selectBuilding(m, B('turret', { tang: 100 * D, target: {} })).heading, 90); assert.equal(UA.selectBuilding(m, B('turret', { tang: 102 * D, target: {} })).heading, 112.5);
    assert.equal(UA.selectBuilding(m, B('turret')).heading, UA.IDLE_TOP_HEADING);                      // never aimed
    assert.equal(UA.selectBuilding(m, B('turret', { tang: -135 * D })).heading, 225);                   // target died: keeps its last aim
    const s = UA.selectBuilding(m, B('turret', { tang: 0, target: {} })); assert.equal(s.heading, 0);   // aiming due east at a live target
    const [ox, oy] = UA.bodyPos(s.base, 4, 5), [x, y] = UA.topPos(s.base, s.top, ox, oy);
    assert.ok(Math.abs(x + s.top.anchor[0] - (ox + s.base.turret_mount[0])) <= 0.5 && Math.abs(y + s.top.anchor[1] - (oy + s.base.turret_mount[1])) <= 0.5);
    for (const b of ['hq', 'power', 'refinery', 'depot', 'barracks', 'factory', 'silo']) assert.equal(UA.selectBuilding(m, B(b)).top, null);
  }
  // the Bone Spire tusk reaches ~21 px from the pivot at E/W: wider than the 32 px tile, so tops are never clipped to the footprint
  const e = MAN.horde.index.get(UA.bkey('turret', 'top', 'idle', 180)); assert.ok(e.anchor[0] >= 20, 'tusk extent ' + e.anchor[0]);
});

test('state selection: damaged below 50% hp (HANDOFF suggestion), silo closed/open (charged or launching), open wins over damaged', () => {
  assert.equal(UA.DAMAGED_BELOW, 0.5);
  for (const m of Object.values(MAN)) {
    assert.equal(UA.selectBuilding(m, B('hq', { hp: 50 })).state, 'idle');
    assert.equal(UA.selectBuilding(m, B('hq', { hp: 49.9 })).state, 'damaged');
    assert.equal(UA.selectBuilding(m, B('hq', { hp: 49.9 })).base.state, 'damaged');
    const o = { nukeCharge: 200 };
    assert.equal(UA.selectBuilding(m, B('silo', { charge: 199.9 }), o).state, 'closed');
    assert.equal(UA.selectBuilding(m, B('silo', { charge: 200 }), o).state, 'open');
    assert.equal(UA.selectBuilding(m, B('silo', { charge: 0 }), Object.assign({ launching: true }, o)).state, 'open');
    assert.equal(UA.selectBuilding(m, B('silo', { charge: 10, hp: 10 }), o).state, 'damaged');
    assert.equal(UA.selectBuilding(m, B('silo', { charge: 200, hp: 10 }), o).state, 'open');
  }
  const s = B('silo', { x: 100, y: 200, side: 1 });
  assert.equal(UA.launching(s, [{ side: 1, sx: 100, sy: 180, t: 0.5 }]), true);
  assert.equal(UA.launching(s, [{ side: 1, sx: 100, sy: 180, t: UA.LAUNCH_OPEN_S }]), false);
  assert.equal(UA.launching(s, [{ side: 0, sx: 100, sy: 180, t: 0.5 }]), false);
  assert.equal(UA.launching(s, [{ side: 1, sx: 300, sy: 180, t: 0.5 }]), false);
});

test('construction: scaffold + idle/closed frame revealed bottom-up round(rh*p) rows, no top until built; ghost = construct frame', () => {
  for (const m of Object.values(MAN)) for (const t of TYPES) {
    const s = UA.selectBuilding(m, B(t, { hp: 1 }), { p: 0.4, nukeCharge: 200 });
    assert.equal(s.state, 'construct'); assert.equal(s.construct.state, 'construct'); assert.equal(s.base.state, t === 'silo' ? 'closed' : 'idle');
    assert.equal(s.p, 0.4); assert.equal(s.construct.rect[3], s.base.rect[3], t + ' scaffold same height as the building');
    const g = UA.selectBuilding(m, B(t), { ghost: true }); assert.equal(g.state, 'ghost'); assert.equal(g.p, 0); assert.ok(g.construct);
    assert.equal(UA.selectBuilding(m, B(t), { p: 1 }).construct, null); assert.equal(UA.selectBuilding(m, B(t), { p: 7 }).p, 1);
  }
  assert.equal(UA.revealRows(116, 0), 0); assert.equal(UA.revealRows(116, 0.5), 58); assert.equal(UA.revealRows(116, 0.333), 39); assert.equal(UA.revealRows(116, 1), 116); assert.equal(UA.revealRows(116, 2), 116);
});

test('fallback: unknown type / missing frames -> null (procedural); damaged/open fall back to the intact frame', () => {
  const m = MAN.survivors;
  assert.equal(UA.selectBuilding(m, B('wall')), null); assert.equal(UA.selectBuilding(null, B('hq')), null);
  const drop = pred => { const index = new Map([...m.index].filter(([k]) => !pred(k))); return Object.assign({}, m, { index }); };
  assert.equal(UA.selectBuilding(drop(k => k === 'hq|base|idle'), B('hq')), null);
  assert.equal(UA.selectBuilding(drop(k => k === 'hq|base|damaged'), B('hq', { hp: 1 })).base.state, 'idle');
  assert.equal(UA.selectBuilding(drop(k => k === 'silo|base|open'), B('silo', { charge: 200 }), { nukeCharge: 200 }).base.state, 'closed');
  assert.equal(UA.selectBuilding(drop(k => k === 'turret|top|idle|90.0'), B('turret')), null);   // never a turret without its head
  assert.equal(UA.selectBuilding(drop(k => k.startsWith('refinery|pad')), B('refinery')), null);
  assert.equal(UA.selectBuilding(drop(k => k.endsWith('construct')), B('hq'), { ghost: true }), null);
  assert.equal(UA.selectBuilding(drop(k => k.endsWith('construct')), B('hq'), { p: 0.5 }).construct, null);   // reveal without scaffold
  // baked per-team index (tainted-canvas path) selects the same frames
  for (const [team, idx] of m.baked) { const s = UA.selectBuilding(m, B('turret', { tang: 0.3 }), {}, idx); assert.equal(s.base.team, team); assert.equal(s.top.team, team); }
});

test('game.js: placed buildings record bornT for the reveal; the harness (no UnitArt) still runs', () => {
  RTS.newGame('normal'); const G = RTS.G;
  for (const b of G.blds) assert.equal(b.bornT, -1e9, 'starting bases are already built');
  G.time = 12.5; const b = RTS.makeBld('depot', 0, G.blds[0].tx + 6, G.blds[0].ty + 6); assert.equal(b.bornT, 12.5);
  RTS.step(1 / 30);
});
