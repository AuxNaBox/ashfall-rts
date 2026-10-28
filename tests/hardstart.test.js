// 1d §8 steering (conditional, Hard lost the HQ by 12:00 on >= 7/10): Hard AI starts on 2,000; everything else unchanged.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');
test('AI start Credits: Easy 2500, Normal 2500, Hard 2000; player 2000 on all; Hard inc stays 1.35', () => {
  const want = { easy: 2500, normal: 2500, hard: 2000 };
  for (const d of Object.keys(want)) {
    const { RTS } = load(); RTS.newGame(d);
    assert.deepStrictEqual([RTS.G.credits[0], RTS.G.credits[1]], [2000, want[d]], d);
  }
  const { RTS } = load(); RTS.newGame('hard'); assert.strictEqual(RTS.G.diff.inc, 1.35);
});
