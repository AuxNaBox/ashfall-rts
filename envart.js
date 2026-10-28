// envart.js: loader for Artie's environment art pass 1 (rts-loops/art/env/HANDOFF-env.md).
// Loads the three env atlases (tiles / props / fx) with crossOrigin = 'anonymous' (same as unitart.js) and builds the
// EnvTerrain runtime (env-terrain.js). Any failure -> state.mode = 'failed', ONE console warning, and game.js keeps the
// procedural ground. ?envart=off -> state.mode = 'off' (nothing is fetched).
// state.mode: 'idle' | 'loading' | 'ready' | 'failed' | 'off'
(function (root) {
  'use strict';
  const SETS = ['tiles', 'props', 'fx'];
  const S = { mode: 'idle', root: 'assets/env/', loadMs: null, error: null, warned: false, sets: {}, env: null };
  const listeners = [];
  function warnOnce(msg) { if (S.warned) return; S.warned = true; if (typeof console !== 'undefined') console.warn('[env art] ' + msg + ' - using procedural ground'); }
  function loadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => res(im); im.onerror = () => rej(new Error('failed to load ' + src)); im.src = src; }); }
  function loadJSON(src) { return fetch(src).then(r => { if (!r.ok) throw new Error('failed to load ' + src + ' (HTTP ' + r.status + ')'); return r.json(); }); }
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  function load(opts) {
    opts = opts || {};
    if (opts.base) S.root = opts.base;
    if (opts.off) { S.mode = 'off'; return Promise.resolve(null); }
    if (typeof EnvTerrain === 'undefined') { S.mode = 'failed'; S.error = 'env-terrain.js missing'; warnOnce(S.error); return Promise.resolve(null); }
    S.mode = 'loading'; const t0 = now();
    return Promise.all(SETS.map(k => {
      const base = S.root + 'env-' + k + '-atlas';
      return loadJSON(base + '.json').then(j => loadImg(S.root + (j.image || ('env-' + k + '-atlas.png'))).then(im => { S.sets[k] = 'ready'; return [j, im]; }))
        .catch(e => { S.sets[k] = 'failed'; throw e; });
    })).then(([tiles, props, fx]) => {
      S.env = EnvTerrain.create({ tiles, props, fx, makeCanvas: (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; } });
      S.loadMs = Math.round(now() - t0); S.mode = 'ready';
      for (const f of listeners.splice(0)) try { f(S.env); } catch (e) { console.error(e); }
      return S.env;
    }).catch(e => { S.mode = 'failed'; S.error = e.message; S.loadMs = Math.round(now() - t0); warnOnce(e.message); return null; });
  }
  function onReady(f) { if (S.mode === 'ready') f(S.env); else listeners.push(f); }
  root.EnvArt = { state: S, load, onReady, get env() { return S.mode === 'ready' ? S.env : null; } };
})(typeof window !== 'undefined' ? window : globalThis);
