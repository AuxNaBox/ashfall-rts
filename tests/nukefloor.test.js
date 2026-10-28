// 1d §9 ruling 3: AI_FIRST_NUKE_MIN. The AI's first Hell Silo launch waits for the floor (Easy 15:00, Normal 13:00, Hard none);
// the Silo still charges early and holds while charged; only the first launch is floored.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');
function withSilo(diff, time) {
  const L = load(); L.seed(1); const { RTS } = L; RTS.newGame(diff); const G = RTS.G;
  const pb = G.blds.find(b => b.side === 0 && b.type === 'hq'), hive = G.blds.find(b => b.side === 1 && b.type === 'hq');
  const silo = RTS.makeBld('silo', 1, hive.tx + 4, hive.ty + 4); silo.charge = 200; G.time = time;
  return { RTS, G, silo, pb };
}
const tick = (RTS, G) => { G.ai.t = 0; RTS.updAI(0.5); };
test('constant: Easy 15:00, Normal 13:00, Hard null', () => {
  const { RTS } = load(); assert.strictEqual(JSON.stringify(RTS.AI_FIRST_NUKE_MIN), JSON.stringify({ easy: 900, normal: 780, hard: null }));
});
test('Normal: a charged Silo holds before 13:00 and fires at 13:00; Easy holds until 15:00', () => {
  for (const [d, floor] of [['normal', 780], ['easy', 900]]) {
    const { RTS, G, silo } = withSilo(d, 600);
    tick(RTS, G); assert.strictEqual(G.missiles.length, 0, d + ' held at 10:00'); assert.strictEqual(silo.charge, 200, d + ' still charged');
    assert.strictEqual(silo.chargedAt, 600, d + ' charged time logged');
    G.time = floor - 0.5; tick(RTS, G); assert.strictEqual(G.missiles.length, 0, d + ' held just before the floor');
    G.time = floor; tick(RTS, G); assert.strictEqual(G.missiles.length, 1, d + ' fires at the floor');
    assert.strictEqual(G.ai.nukeN, 1); assert.deepStrictEqual([...G.ai.nukeLog], [floor]); assert.strictEqual(silo.charge, 0);
  }
});
test('Hard: no floor, a charged Silo fires at once', () => {
  const { RTS, G } = withSilo('hard', 400); tick(RTS, G); assert.strictEqual(G.missiles.length, 1); assert.strictEqual(G.ai.nukeN, 1);
});
test('only the first launch is floored', () => {
  const { RTS, G, silo } = withSilo('normal', 300); G.ai.nukeN = 1;   // a first launch already happened
  tick(RTS, G); assert.strictEqual(G.missiles.length, 1, 'second launch is not held'); assert.strictEqual(silo.charge, 0);
});
