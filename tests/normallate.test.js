// L5 §18 pass N (N1): on Normal from 12:00, a wave launches once home idle
// weight is at least 0.6× the trigger. If it is still short 45 s after the
// timer, it launches at min weight 6; below 6 it waits. Leftovers from a
// wiped wave within 15 tiles of the Hive join the next wave. Inactive
// before 12:00 and on Easy and Hard.
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
  if (G.ai) {
    G.ai.t = 0;
    G.ai.nextWave = G.time;
    G.ai.waveN = waveN;
    G.ai.defT = 0;
    G.ai.lastWave = [];
    G.ai.waveDueAt = null;
  }
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

test('N1 constants: frac 0.6, fallback 45 s, min weight 6, regroup 15 tiles, from 12:00', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.Loop5.D.NORMAL_LATE_LAUNCH_FRAC, 0.6);
  assert.strictEqual(RTS.Loop5.D.NORMAL_LATE_LAUNCH_MAX_S, 45);
  assert.strictEqual(RTS.Loop5.D.NORMAL_LATE_LAUNCH_MIN_W, 6);
  assert.strictEqual(RTS.Loop5.D.NORMAL_REGROUP_TILES, 15);
  assert.strictEqual(RTS.Loop5.D.NORMAL_LATE_FROM_S, 720);
});

test('normalLateActive is Normal only, and only from 12:00', () => {
  const nEarly = boot('normal', 719, 4);
  assert.strictEqual(nEarly.RTS.normalLateActive(), false, 'Normal at 11:59 is classic');
  nEarly.G.time = 720;
  assert.strictEqual(nEarly.RTS.normalLateActive(), true, 'Normal at 12:00 is late cadence');
  const h = boot('hard', 720, 4);
  assert.strictEqual(h.RTS.normalLateActive(), false, 'Hard at 12:00 is not late cadence');
  const e = boot('easy', 720, 4);
  assert.strictEqual(e.RTS.normalLateActive(), false, 'Easy at 12:00 is not late cadence');
});

test('after 12:00 on Normal, 9 idle Zombies launch (0.6× of need 14); 8 do not', () => {
  // Wave 5 need is min(26, 6+8) = 14; 0.6×14 = 8.4.
  const yes = boot('normal', 720, 4);
  idleAt(yes.hive, yes.RTS, 'zombie', 9, 0, 1);
  yes.RTS.updAI(0.5);
  assert.strictEqual(yes.G.ai.waveN, 5, '9 weight (>= 8.4) launches wave 5');
  const log = (yes.G.ai.waveLog || [])[0];
  assert.ok(log);
  assert.strictEqual(log.need, 14);
  assert.strictEqual(log.homeW, 9);
  assert.strictEqual(log.late, true);
  assert.ok(log.delay < 1, 'launches on the due tick');

  const no = boot('normal', 720, 4);
  idleAt(no.hive, no.RTS, 'zombie', 8, 0, 1);
  no.RTS.updAI(0.5);
  assert.strictEqual(no.G.ai.waveN, 4, '8 weight (< 8.4) does not launch yet');
  assert.strictEqual(no.G.ai.nextWave, 720, 'the due time is not bumped by 10 s while waiting');
  assert.strictEqual(no.G.ai.waveDueAt, 720);
});

test('if still short 45 s after the timer, launch at home weight 7 (>= 6)', () => {
  const { RTS, G, hive } = boot('normal', 720, 4);
  const z = idleAt(hive, RTS, 'zombie', 7, 0, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, '7 is below 8.4, so it waits');
  assert.strictEqual(G.ai.waveDueAt, 720);
  G.time = 720 + 45;
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 5, 'at +45 s, weight 7 (>= 6) launches');
  const log = (G.ai.waveLog || [])[0];
  assert.ok(log);
  assert.ok(Math.abs(log.delay - 45) < 1, 'delay is the 45 s fallback');
  assert.strictEqual(log.homeW, 7);
  assert.ok(z.every(u => (G.ai.lastWave || []).includes(u)));
});

test('at +45 s, weight 5 still waits; it launches once weight reaches 6', () => {
  const { RTS, G, hive } = boot('normal', 720, 4);
  idleAt(hive, RTS, 'zombie', 5, 0, 1);
  RTS.updAI(0.5);
  G.time = 720 + 45;
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, 'weight 5 is below the min of 6, even after 45 s');
  assert.strictEqual(G.ai.nextWave, 720, 'due time is held while waiting for min weight');
  idleAt(hive, RTS, 'zombie', 1, 2, 1);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 5, 'the sixth Zombie meets the min weight and launches');
  const log = (G.ai.waveLog || [])[0];
  assert.strictEqual(log.homeW, 6);
  assert.ok(log.delay >= 45);
});

test('leftovers from a wiped wave within 15 tiles of the Hive join the next wave; units past 15 do not', () => {
  const { RTS, G, hive } = boot('normal', 720, 4);
  const home = idleAt(hive, RTS, 'zombie', 9, 0, 1);
  const near = [];
  for (let i = 0; i < 3; i++) {
    const u = RTS.makeUnit('zombie', 1, hive.x, hive.y + (10 + i * 0.4) * TILE);
    u.order = 'attackmove'; u.path = null; u.target = G.blds.find(b => b.side === 0 && b.type === 'hq');
    near.push(u);
  }
  const far = RTS.makeUnit('zombie', 1, hive.x, hive.y + 16.5 * TILE);
  far.order = 'attackmove'; far.path = null; far.target = G.blds.find(b => b.side === 0 && b.type === 'hq');
  G.ai.lastWave = near.concat([far]);
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 5);
  const sent = G.ai.lastWave || [];
  assert.ok(home.every(u => sent.includes(u)), 'the home idle body leaves');
  assert.ok(near.every(u => sent.includes(u)), 'leftovers within 15 tiles join');
  assert.ok(!sent.includes(far), 'a leftover past 15 tiles stays out');
});

test('the 0.6× launch and leftover join are inactive before 12:00 on Normal', () => {
  const { RTS, G, hive } = boot('normal', 719, 4);
  idleAt(hive, RTS, 'zombie', 9, 0, 1);
  const near = RTS.makeUnit('zombie', 1, hive.x, hive.y + 10 * TILE);
  near.order = 'attackmove'; near.path = null; near.target = G.blds.find(b => b.side === 0 && b.type === 'hq');
  G.ai.lastWave = [near];
  RTS.updAI(0.5);
  assert.strictEqual(G.ai.waveN, 4, '9 idle is below the classic need of 14, so nothing launches at 11:59');
  assert.deepStrictEqual(G.ai.lastWave, [near], 'leftovers do not get a wave order before 12:00');
  assert.strictEqual(near.order, 'attackmove');
});

test('the 0.6× launch is inactive on Easy and Hard at 12:00', () => {
  for (const diff of ['easy', 'hard']) {
    const { RTS, G, hive } = boot(diff, 720, 4);
    idleAt(hive, RTS, 'zombie', 9, 0, 1);
    RTS.updAI(0.5);
    assert.strictEqual(G.ai.waveN, 4, `${diff} at 12:00 still needs a full classic trigger, so 9 idle does not launch`);
  }
});
