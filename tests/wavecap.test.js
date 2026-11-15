// L5 §18 pass 7: Hard waves before 12:00 cap at 20 units (joiners included)
// and 2 Hellbrutes. Over-cap units stay home and count toward the next
// trigger. Caps lift at 12:00. Easy and Normal are unchanged.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');

const TILE = 32;

function boot(diff, time, waveN) {
  const L = load(); L.seed(1);
  const { RTS } = L;
  RTS.newGame(diff);
  const G = RTS.G;
  G.time = time;
  if (G.ai) { G.ai.t = 0; G.ai.nextWave = G.time; G.ai.waveN = waveN; G.ai.defT = 0; G.ai.lastWave = []; }
  // Keep starting army out of the idle pool so send sizes are exact.
  for (const u of G.units) {
    if (u.side === 1 && !(u.d && u.d.harv)) { u.order = 'attackmove'; u.path = null; u.target = G.blds.find(b => b.side === 0 && b.type === 'hq') || u; }
    else { u.path = null; u.target = null; u.order = 'idle'; }
  }
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  return { RTS, G, hive };
}

function idleAt(hive, RTS, type, n, ox, oy) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const u = RTS.makeUnit(type, 1, hive.x + (ox + (i % 5) * 0.6) * TILE, hive.y + (oy + Math.floor(i / 5) * 0.6) * TILE);
    u.target = null; u.order = 'idle'; u.path = null;
    out.push(u);
  }
  return out;
}

function sentOf(G) { return (G.ai.lastWave || []).slice(); }

test('WAVE_CAP_PRE_FLOOR is 20, WAVE_BRUTE_CAP_PRE_FLOOR is 2, WAVE_CAP_FLOOR_S is 720', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.WAVE_CAP_PRE_FLOOR, 20);
  assert.strictEqual(RTS.Loop5.D.WAVE_BRUTE_CAP_PRE_FLOOR, 2);
  assert.strictEqual(RTS.Loop5.D.WAVE_CAP_FLOOR_S, 720);
});

test('waveCapsPreFloorActive is Hard only, and only before 12:00', () => {
  const h = boot('hard', 719, 3);
  assert.strictEqual(h.RTS.waveCapsPreFloorActive(), true, 'Hard at 11:59 is capped');
  h.G.time = 720;
  assert.strictEqual(h.RTS.waveCapsPreFloorActive(), false, 'Hard at 12:00 is uncapped');
  const n = boot('normal', 600, 3);
  assert.strictEqual(n.RTS.waveCapsPreFloorActive(), false, 'Normal is never capped');
  const e = boot('easy', 600, 3);
  assert.strictEqual(e.RTS.waveCapsPreFloorActive(), false, 'Easy is never capped');
});

test('a Hard wave before 12:00 takes at most 2 Hellbrutes; the rest stay home', () => {
  const { RTS, G, hive } = boot('hard', 600, 3);
  const z = idleAt(hive, RTS, 'zombie', 14, 0, 1);
  const br = idleAt(hive, RTS, 'brute', 3, 4, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 launches');
  const sent = sentOf(G);
  assert.ok(sent.length <= 20, 'unit cap holds');
  assert.strictEqual(sent.filter(u => u.type === 'brute').length, 2, 'only 2 Hellbrutes leave');
  const heldBr = br.filter(u => !sent.includes(u));
  assert.strictEqual(heldBr.length, 1, 'the 3rd Hellbrute stays home');
  assert.ok(heldBr.every(u => u.order !== 'attackmove'), 'the held Hellbrute is not issued a wave move');
  const log = (G.ai.waveLog || [])[0];
  assert.ok(log);
  assert.strictEqual(log.heldBrute, 1);
});

test('a Hard wave before 12:00 takes at most 20 units; the rest stay home', () => {
  // waveN=5 is wave 6: need = min(26, 8+10) = 18, slice keep + need+4 = 22, then cap to 20.
  const { RTS, G, hive } = boot('hard', 600, 5);
  const z = idleAt(hive, RTS, 'zombie', 40, 0, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 6, 'wave 6 launches');
  const sent = sentOf(G);
  assert.strictEqual(sent.length, 20, 'launch size is capped at 20');
  const held = z.filter(u => !sent.includes(u));
  assert.ok(held.length >= 20, 'the over-cap units stay out of lastWave');
  assert.ok(held.every(u => u.order !== 'attackmove'), 'held units are not issued a wave move');
  const log = (G.ai.waveLog || [])[0];
  assert.ok(log.heldUnit >= 2, 'at least the two sliced units over 20 are logged as held');
});

test('units held by the caps stay idle and count toward the next trigger', () => {
  const { RTS, G, hive } = boot('hard', 600, 5);
  const z = idleAt(hive, RTS, 'zombie', 40, 0, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 6);
  const first = sentOf(G);
  const held = z.filter(u => !first.includes(u));
  assert.ok(held.length >= 20);
  assert.ok(held.every(u => !u.target && u.order !== 'attackmove' && u.order !== 'attack'));
  // Force the next wave immediately. Wave 7 needs 20 idle; the held units supply them.
  G.ai.nextWave = G.time;
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 7, 'the held units meet the next 20-idle trigger');
  const second = sentOf(G);
  assert.ok(second.every(u => held.includes(u)), 'the next wave is drawn from the units that stayed home');
  assert.ok(second.length <= 20);
});

test('far-idle joiners cannot push a Hard pre-12:00 wave past 20 units', () => {
  const { RTS, G, hive } = boot('hard', 600, 3);
  // 21 at the hive: keep 3, slice 18. Five far Zombies try to join; only 2 fit.
  const home = idleAt(hive, RTS, 'zombie', 21, 0, 1);
  const farZ = [];
  for (let i = 0; i < 5; i++) {
    const u = RTS.makeUnit('zombie', 1, hive.x, hive.y + 25 * TILE + i * 0.5 * TILE);
    u.target = null; u.order = 'idle'; u.path = null;
    farZ.push(u);
  }
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 launches');
  const sent = sentOf(G);
  assert.strictEqual(sent.length, 20, 'joiners fill the wave up to 20');
  assert.strictEqual(home.filter(u => sent.includes(u)).length, 18, 'the hive slice of 18 is the launch body');
  const joined = farZ.filter(u => sent.includes(u));
  const heldFar = farZ.filter(u => !sent.includes(u));
  assert.strictEqual(joined.length, 2);
  assert.strictEqual(heldFar.length, 3);
  assert.ok(heldFar.every(u => u.order !== 'attackmove'), 'rejected joiners stay put');
  const log = (G.ai.waveLog || [])[0];
  assert.strictEqual(log.n + (log.joiners || 0), 20);
  assert.ok((log.heldJoinUnit || 0) >= 3);
});

test('far-idle Hellbrutes cannot push a Hard pre-12:00 wave past 2', () => {
  const { RTS, G, hive } = boot('hard', 600, 3);
  // 3 keep zombies + 12 slice zombies + 2 slice Hellbrutes = 14 launched (need 14, keep 3, only 17 idle at the hive).
  idleAt(hive, RTS, 'zombie', 15, 0, 1);
  idleAt(hive, RTS, 'brute', 2, 4, 1);
  const farBr = [];
  for (let i = 0; i < 3; i++) {
    const u = RTS.makeUnit('brute', 1, hive.x + 4 * TILE, hive.y + 25 * TILE + i * TILE);
    u.target = null; u.order = 'idle'; u.path = null;
    farBr.push(u);
  }
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'wave 4 launches');
  const sent = sentOf(G);
  assert.strictEqual(sent.filter(u => u.type === 'brute').length, 2, 'the wave already has 2 Hellbrutes');
  assert.ok(sent.length < 20, 'there is still unit-cap room: ' + sent.length);
  assert.ok(farBr.every(u => !sent.includes(u)), 'far-idle Hellbrutes stay home once the brute cap is full');
  assert.ok(farBr.every(u => u.order !== 'attackmove'), 'rejected Hellbrutes are not issued a wave move');
  const log = (G.ai.waveLog || [])[0];
  assert.ok((log.heldJoinBrute || 0) >= 3);
});

test('Hard waves from 12:00 on have no caps', () => {
  const { RTS, G, hive } = boot('hard', 720, 5);
  assert.strictEqual(RTS.waveCapsPreFloorActive(), false);
  const z = idleAt(hive, RTS, 'zombie', 30, 0, 1);
  const br = idleAt(hive, RTS, 'brute', 3, 6, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 6, 'wave 6 launches at 12:00');
  const sent = sentOf(G);
  // need 18, keep 3, slice 22. All 22 leave, including all 3 Hellbrutes if they landed in the slice.
  assert.ok(sent.length > 20, 'the 20-unit cap does not apply at 12:00: sent ' + sent.length);
  const brSent = sent.filter(u => u.type === 'brute').length;
  assert.ok(brSent >= 3 || sent.length >= 22, 'the 2-Hellbrute cap does not apply at 12:00 (brutes=' + brSent + ', n=' + sent.length + ')');
  // With 30z+3br=33 idle, keep 3, slice 22. Creation order is 30z then 3br, so the slice is 22 zombies and 0 brutes.
  // Rebuild with brutes first in the slice: put them after the keep of 3 zombies.
  // The assertion above may fail on brutes. Make a dedicated arrangement:
});

test('Hard at 12:00 sends all 3 Hellbrutes in the slice', () => {
  const { RTS, G, hive } = boot('hard', 720, 3);
  // keep 3 (zombies first), then 14z + 3 brutes in the slice.
  idleAt(hive, RTS, 'zombie', 17, 0, 1);
  idleAt(hive, RTS, 'brute', 3, 5, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4);
  const sent = sentOf(G);
  assert.strictEqual(sent.filter(u => u.type === 'brute').length, 3, 'all 3 Hellbrutes leave at 12:00');
});

test('Normal and Easy waves are not capped before 12:00', () => {
  // Normal: minWave 6, waveN 6 -> need 18, slice 22.
  const n = boot('normal', 600, 6);
  idleAt(n.hive, n.RTS, 'zombie', 30, 0, 1);
  idleAt(n.hive, n.RTS, 'brute', 3, 6, 1);
  n.RTS.updAI(0.5);
  assert.strictEqual(n.G.ai.waveN, 7, 'Normal wave launches');
  const nSent = sentOf(n.G);
  assert.ok(nSent.length > 20, 'Normal is not held to 20: sent ' + nSent.length);

  // Easy: minWave 5, waveN 8 -> need 21, slice 25.
  const e = boot('easy', 600, 8);
  idleAt(e.hive, e.RTS, 'zombie', 30, 0, 1);
  idleAt(e.hive, e.RTS, 'brute', 3, 6, 1);
  e.RTS.updAI(0.5);
  assert.strictEqual(e.G.ai.waveN, 9, 'Easy wave launches');
  const eSent = sentOf(e.G);
  assert.ok(eSent.length > 20, 'Easy is not held to 20: sent ' + eSent.length);
});

test('capWavePreFloor is a no-op when the caps are inactive', () => {
  const { RTS, G, hive } = boot('normal', 600, 3);
  const list = idleAt(hive, RTS, 'brute', 5, 0, 1);
  const capped = RTS.capWavePreFloor(list);
  assert.strictEqual(capped.send.length, 5);
  assert.strictEqual(capped.heldBrute, 0);
  assert.strictEqual(capped.heldUnit, 0);
});
