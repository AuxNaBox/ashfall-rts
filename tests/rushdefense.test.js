// Addendum 1d §8 ruling 4 / §9 rulings 1-2: AI rush response (AI_RUSH_DEFENSE, Zombie queue only, no Eater pull; held waves launch when it ends),
// and ruling 1 (Normal wave 1 = 5 Zombies + 1 Imp).
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');
const run = (RTS, s) => { for (let i = 0; i < Math.round(s * 30); i++) RTS.step(1 / 30); };
function setup(diff, n, at = 30) {
  const L = load(); L.seed(1); const { RTS } = L; RTS.newGame(diff); const G = RTS.G;
  RTS.queueItem(1, 'barracks'); run(RTS, at);   // the AI has its Spawning Pit by now
  const hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  const units = []; for (let k = 0; k < n; k++) { const u = RTS.makeUnit('survivor', 0, hive.x - 6 * 32 + (k % 4) * 8, hive.y + 3 * 32 + (k >> 2) * 8); u.order = 'idle'; units.push(u); }
  return { RTS, G, hive, units };
}
test('constants: on, 3 units / 8 tiles / before 6:00, 1.5x, clear 10 tiles for 15 s (no Eater pull)', () => {
  const { RTS } = load();
  assert.strictEqual(RTS.AI_RUSH_DEFENSE, true);
  assert.deepStrictEqual({ ...RTS.RUSH }, { trigTiles: 8, trigCount: 3, before: 360, ratio: 1.5, clearTiles: 10, clearS: 15 });
});
test('3 enemy units within 8 tiles before 6:00 trigger it on Normal and Hard; 2 do not; Easy never', () => {
  for (const d of ['normal', 'hard']) {
    const a = setup(d, 3); a.RTS.G.ai.t = 0; a.RTS.updAI(0.5); assert.ok(a.G.ai.rush, d + ' 3 units');
    const b = setup(d, 2); b.RTS.updAI(0.5); b.G.ai.t = 0; b.RTS.updAI(0.5); assert.ok(!b.G.ai.rush, d + ' 2 units');
  }
  const e = setup('easy', 5); e.G.ai.t = 0; e.RTS.updAI(0.5); assert.ok(!e.G.ai.rush && !e.G.ai.rushLog, 'easy');
});
test('response: build order paused, Zombies queued toward 1.5x, Eaters near the Hive keep working (no pull), then resumes after 15 s clear', () => {
  const { RTS, G, hive, units } = setup('normal', 8);   // goal 12 (the AI already has about 6 with its wave-1 group)
  G.credits[1] = 5000;
  const eat = G.units.filter(u => u.side === 1 && u.d.harv && !u.dead);
  eat[0].x = hive.x - 2 * 32; eat[0].y = hive.y + 2 * 32;   // within 4 tiles, on the attackers' side
  const hs0 = eat[0].hs, order0 = eat[0].order;
  const sBefore = G.queues[1].structure.list.length, iBefore = G.queues[1].infantry.list.length;
  G.ai.t = 0; RTS.updAI(0.5);
  const R = G.ai.rush; assert.ok(R); assert.strictEqual(R.n, 8);
  const army = G.units.filter(u => u.side === 1 && !u.dead && !u.d.harv).length + G.queues[1].infantry.list.length;
  assert.ok(army >= 12 || G.queues[1].infantry.list.length === 5, `army + queued ${army} vs goal 12`);
  const added = G.queues[1].infantry.list.slice(iBefore); assert.ok(added.length > 0 && added.every(t => t === 'zombie'), 'new items are Zombies: ' + added);
  assert.strictEqual(G.queues[1].structure.list.length, sBefore, 'no new structure queued');
  assert.ok(!('pulled' in R)); assert.notStrictEqual(eat[0].hs, 'parked'); assert.strictEqual(eat[0].hs, hs0); assert.strictEqual(eat[0].order, order0);
  // clear: remove the attackers, 15 s later the rush ends
  for (const u of units) { u.dead = true; } G.units = G.units.filter(u => !u.dead);
  for (let k = 0; k < 28; k++) { G.time += 0.5; G.ai.t = 0; RTS.updAI(0.5); }
  assert.ok(G.ai.rush, 'still on at 14 s');
  for (let k = 0; k < 4; k++) { G.time += 0.5; G.ai.t = 0; RTS.updAI(0.5); }
  assert.ok(!G.ai.rush, 'off after 15 s clear'); assert.ok(G.ai.rushLog[0].t1 !== null);
  assert.notStrictEqual(eat[0].hs, 'parked');
});
test('a wave that comes due during the response is held, then launches on the AI tick the response ends', () => {
  const { RTS, G, hive, units } = setup('normal', 8);
  G.credits[1] = 0;   // nothing new gets queued; the wave uses the units placed below
  for (const [t, n] of [['zombie', 5], ['imp', 1]]) for (let k = 0; k < n; k++) { const u = RTS.makeUnit(t, 1, hive.x + 3 * 32 + k * 8, hive.y - 3 * 32); u.order = 'idle'; }
  G.ai.nextWave = G.time - 1;   // wave 1 is already due
  G.ai.t = 0; RTS.updAI(0.5); assert.ok(G.ai.rush); assert.strictEqual(G.ai.waveN, 0, 'held while the response is on');
  for (const u of units) u.dead = true; G.units = G.units.filter(u => !u.dead);
  let k = 0; while (G.ai.rush && k++ < 60) { assert.strictEqual(G.ai.waveN, 0, 'still held at +' + k * 0.5 + ' s'); G.time += 0.5; G.ai.t = 0; RTS.updAI(0.5); }
  assert.ok(!G.ai.rush, 'response ended');
  assert.strictEqual(G.ai.waveN, 1, 'wave 1 launched on the same tick');
  assert.strictEqual(G.ai.wave1At, G.ai.rushLog[0].t1);
});
test('no trigger at or after 6:00', () => {
  const { RTS, G } = setup('normal', 5); G.time = 360; G.ai.t = 0; RTS.updAI(0.5); assert.ok(!G.ai.rush);
});
test('Normal wave 1 is 5 Zombies + 1 Imp; Easy and Hard unchanged', () => {
  const { RTS } = load(); const J = o => JSON.stringify(o);
  RTS.newGame('normal'); assert.strictEqual(J(RTS.G.diff.wave1), J({ zombie: 5, imp: 1 }));
  RTS.newGame('easy'); assert.strictEqual(J(RTS.G.diff.wave1), J({ zombie: 3 }));
  RTS.newGame('hard'); assert.strictEqual(J(RTS.G.diff.wave1), J({ zombie: 5, imp: 1 }));
});
