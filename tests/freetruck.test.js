// Loop 4 addendum 1d (free harvester, bigger loads) + Job F (user decision via the Director, Oct 28: BARRACKS_NEEDS_YARD = false,
// HQ / Hive turret range 6). Tests 6-9 of addendum §5. Test 5 (600 at the HQ in 12 s) is A5 in tests/opening-arena.js.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { load } = require('./harness.js');
const MAP = n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'assets', 'maps', n + '.json'), 'utf8'));
const game = (map, seed = 1) => { const L = load(); L.seed(seed); L.RTS.newGame('normal', map ? { map: MAP(map) } : undefined); return { RTS: L.RTS, G: L.RTS.G }; };
const run = (RTS, s) => { for (let i = 0; i < Math.round(s * 30); i++) RTS.step(1 / 30); };

test('6 start state: exactly 1 harvester per side, Credits 2,000 / 2,500, working the field by 0:05 and gathering by 0:10 (every map)', () => {
  for (const m of [null, 'crossroads', 'fallen-city', 'ash-ring']) {
    const { RTS, G } = game(m);
    assert.deepEqual(G.credits, [2000, 2500], `${m} credits`);
    for (const side of [0, 1]) {
      const all = G.units.filter(u => u.side === side);
      assert.equal(all.length, 1, `${m} side ${side}: only the harvester`);
      assert.equal(all[0].type, side ? 'reaper' : 'gleaner'); assert.equal(all[0].d.cap, 600);
    }
    const first = {}; let at5 = null;
    for (let i = 0; i < 300; i++) {
      RTS.step(1 / 30);
      for (const u of G.units) if (u.d.harv && u.hs === 'gather' && first[u.side] === undefined) first[u.side] = G.time;
      if (at5 === null && G.time >= 5) at5 = G.units.filter(u => u.d.harv).map(u => ({ side: u.side, hs: u.hs, tile: u.htile }));
    }
    for (const h of at5) assert.ok((h.hs === 'toField' || h.hs === 'gather') && h.tile >= 0, `${m} side ${h.side} working a Salvage tile by 0:05 (${h.hs})`);
    for (const side of [0, 1]) assert.ok(first[side] !== undefined && first[side] <= 10, `${m} side ${side} gathering by 0:10 (${first[side]})`);
  }
});

test('7 Barracks requirement: off by default (HQ / Hive only); with BARRACKS_NEEDS_YARD on it needs a living yard, existing Barracks keep working', () => {
  const { RTS, G } = game();
  assert.equal(RTS.BARRACKS_NEEDS_YARD, false);
  assert.deepEqual(RTS.BDEF.barracks.req, ['hq']);
  assert.ok(RTS.prereqOk(0, 'barracks') && RTS.prereqOk(1, 'barracks'), 'queueable at 0:00 with only the HQ / Hive');
  try {
    RTS.setBarracksNeedsYard(true);
    for (const side of [0, 1]) {
      assert.equal(RTS.prereqOk(side, 'barracks'), false, `side ${side}: no yard, no Barracks`);
      assert.equal(RTS.queueItem(side, 'barracks'), false);
      assert.equal(RTS.missingReq(side, 'barracks'), side ? 'Grinder Pit' : 'Scrap Yard', 'sidebar: Needs Scrap Yard / Needs Grinder Pit');
    }
    const hq = G.blds.find(b => b.side === 0 && b.type === 'hq');
    const yard = RTS.makeBld('refinery', 0, hq.tx + 6, hq.ty - 4);
    assert.ok(RTS.prereqOk(0, 'barracks'), 'available once a yard exists');
    const bar = RTS.makeBld('barracks', 0, hq.tx + 6, hq.ty + 4); RTS.makeBld('power', 0, hq.tx - 4, hq.ty - 4);
    yard.hp = 0; RTS.kill(yard); run(RTS, 0.2);
    assert.equal(RTS.prereqOk(0, 'barracks'), false, 'yard dead: new Barracks need a yard again');
    assert.ok(RTS.prereqOk(0, 'survivor'), 'the existing Barracks still trains');
    G.credits[0] = 2000; assert.ok(RTS.queueItem(0, 'survivor')); const n0 = G.units.filter(u => u.type === 'survivor').length; run(RTS, 15);
    assert.ok(G.units.filter(u => u.type === 'survivor').length > n0, 'a Rifleman came out of the existing Barracks');
    assert.ok(!bar.dead);
  } finally { RTS.setBarracksNeedsYard(false); }
  assert.deepEqual(RTS.BDEF.barracks.req, ['hq']);
});

// greedy scripted player: Power Plant at 0:00, then a Scrap Yard (if needed) and the Barracks the moment they are legal and affordable
function fastestBarracks(needsYard, seed) {
  const { RTS, G } = game(null, seed);
  RTS.setBarracksNeedsYard(needsYard);
  try {
    const hq = G.blds.find(b => b.side === 0 && b.type === 'hq');
    const place = () => { const q = G.queues[0].structure; if (!q.ready) return; const d = RTS.BDEF[q.ready];
      for (let r = 4; r < 14; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue; const tx = hq.tx + 1 + dx - (d.w >> 1), ty = hq.ty + 1 + dy - (d.h >> 1); if (RTS.canPlace(0, q.ready, tx, ty, 1) && RTS.placeBld(0, q.ready, tx, ty)) return; } };
    const want = needsYard ? ['power', 'refinery', 'barracks'] : ['barracks', 'power'];
    for (let i = 0; i < 180 * 30; i++) {
      RTS.step(1 / 30); place();
      const q = G.queues[0].structure;
      if (want.length && !q.list.length && !q.ready && RTS.prereqOk(0, want[0]) && G.credits[0] >= RTS.BDEF[want[0]].cost && RTS.queueItem(0, want[0])) want.shift();
      const b = G.blds.find(b => b.side === 0 && b.type === 'barracks'); if (b) return G.time;
    }
    return null;
  } finally { RTS.setBarracksNeedsYard(false); }
}
test('8 fastest legal Barracks: with BARRACKS_NEEDS_YARD on a greedy player cannot place one before 0:50 (lever check; it ships off)', () => {
  const on = [1, 2, 3].map(s => fastestBarracks(true, s)), off = [1, 2, 3].map(s => fastestBarracks(false, s));
  console.log(`# fastest Barracks: lever on ${on.map(t => t.toFixed(1)).join(' / ')} s; lever off (shipping) ${off.map(t => t.toFixed(1)).join(' / ')} s`);
  for (const t of on) assert.ok(t !== null && t >= 50, `lever on: ${t}`);
  for (const t of off) assert.ok(t !== null && t < 20, `lever off: Barracks right away (${t})`);
});

test('9 cargo: a full load is 600, a death drop is 300, pips 5 at 600 and 3 at 300', () => {
  const { RTS, G } = game();
  const S = RTS.Salvage;
  assert.equal(RTS.UDEF.gleaner.cap, 600); assert.equal(RTS.UDEF.reaper.cap, 600);
  assert.equal(S.pipsOf(600, 600), 5); assert.equal(S.pipsOf(300, 600), 3);
  // a real trip: the free Truck fills to exactly 600 and stops gathering
  const u = G.units.find(u => u.side === 0 && u.d.harv); let max = 0;
  for (let i = 0; i < 90 * 30 && u.hs !== 'toPlant' && u.hs !== 'queue' && u.hs !== 'unload'; i++) { RTS.step(1 / 30); max = Math.max(max, u.load); }
  assert.equal(max, 600, 'full load');
  // death drop: half of 600 onto the nearest field tile with room
  const res = RTS.res, field = RTS.SAL.field; let ti = -1;
  for (let i = 0; i < res.length && ti < 0; i++) if (field[i] >= 0 && res[i] <= 100 && !RTS.bgrid[i]) ti = i;
  assert.ok(ti >= 0); res[ti] = 0;
  const t = { load: 600, x: (ti % RTS.MW) * 32 + 16, y: ((ti / RTS.MW) | 0) * 32 + 16 };
  assert.equal(RTS.dropCargo(t), 300, 'death drop');
});
