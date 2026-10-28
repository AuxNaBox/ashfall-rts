// Dev seeding fix: the sim RNG (RTS.seed / ?seed=N / openingSim opts.seed) gives the same game as the harness's seeded Math.random,
// and render-only Math.random draws (shake, ash, smoke overlays) can't move the sim.
'use strict';
const test = require('node:test'), assert = require('node:assert');
const { load } = require('./harness.js');
const snap = G => JSON.stringify({ t: G.time.toFixed(2), cr: G.credits.map(Math.round), u: G.units.map(u => [u.type, u.side, Math.round(u.x), Math.round(u.y), Math.round(u.hp)]), b: G.blds.map(b => [b.type, b.side, b.tx, b.ty]) });
const play = (RTS, s) => { RTS.newGame('normal'); for (let i = 0; i < s * 30; i++) RTS.step(1 / 30); return snap(RTS.G); };

test('RTS.seed(N) reproduces the harness seed N, and is unaffected by stray Math.random draws', () => {
  const a = load(); a.seed(7); const ref = play(a.RTS, 90);
  const b = load(); b.seed(123); b.RTS.seed(7);
  const M = require('vm').runInContext('Math', b.ctx), orig = M.random; let k = 0; M.random = () => { k++; return orig(); };   // simulate render draws in between
  b.RTS.newGame('normal'); for (let i = 0; i < 90 * 30; i++) { M.random(); b.RTS.step(1 / 30); }
  assert.strictEqual(snap(b.RTS.G), ref); assert.ok(k > 0);
});

test('two runs with the same RTS.seed are identical; different seeds differ', () => {
  const r = s => { const L = load(); L.RTS.seed(s); return play(L.RTS, 60); };
  assert.strictEqual(r(3), r(3)); assert.notStrictEqual(r(3), r(4));
});
