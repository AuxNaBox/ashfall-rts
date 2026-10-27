// Loads the real game (salvage.js + combat.js + game.js) headless in a node vm with a no-op DOM,
// and seeds Math.random so every run is deterministic. Used by the combat matchup tests.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..');
const SRC = ['salvage.js', 'combat.js', 'game.js'].map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n;\n');

function stub() { // callable, chainable, numeric-0 object
  const f = function () { return p; };
  const p = new Proxy(f, {
    get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'length' ? 0 : k in t && k !== 'prototype' ? t[k] : (t[k] = stub()),
    set: (t, k, v) => { t[k] = v; return true; },
    apply: () => stub(),
    construct: () => stub(),
  });
  return p;
}
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

function load() {
  const els = {};
  const document = { getElementById: id => els[id] || (els[id] = stub()), querySelector: () => null, querySelectorAll: () => [], createElement: () => stub(), addEventListener() {}, body: stub() };
  const ctx = { document, console, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, performance: { now: () => 0 }, addEventListener() {}, confirm: () => true, innerWidth: 1400, innerHeight: 850 };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'ashfall-bundle.js' });
  const seed = s => { const r = mulberry32(s); vm.runInContext('Math', ctx).random = r; };
  return { RTS: ctx.RTS, seed, ctx };
}
module.exports = { load, mulberry32 };
